# Sponsor / partner accounts — implementation plan

> Read this whole document before writing any code.
> All decisions in here are final unless a specific item is marked **[OPEN]**.

---

## 1. Design decision: reuse `Client` as the sponsor account type

Sponsors sign in, upload, and receive reminders through the same infrastructure as clients. A sponsor is a `Client` row with `sponsorForClientId` set to the parent case's id. This means:

- Invite links, single-use setup links, OTP sign-in, lockout, sessions, rate limits, audit log — all unchanged.
- A sponsor's email must be different from the main client's email (enforced by the `@unique` constraint on `Client.email`).
- Only one sponsor per case is supported for now. `createSponsor()` rejects a second invite while one is active (i.e. while a sponsor row with `sponsorForClientId = parentId` and `closedAt = null` exists).
- **All `ClientDocument` rows live on the main case.** Sponsors have no `ClientDocument` rows of their own. A sponsor uploads to the parent case's `ClientDocument` rows that are SPONSOR-assigned.
- `visibleCases()` in `lib/documents.ts` gains `sponsorForClientId: null`, making sponsor rows invisible to every staff query automatically. See §2.5 for the full safety audit.

---

## 2. Schema changes

### 2a. Prisma additions

Add these fields to the existing models. Do not delete or change anything.

**`ChecklistItem`** — route-level default assignment:
```prisma
assignedTo  String  @default("CLIENT")  // "CLIENT" | "SPONSOR"
```

**`ClientDocument`** — case-level override and cross-party file flag:
```prisma
assignedToOverride  String?  // null = use route default; "CLIENT" | "SPONSOR" to override
filesShared         Boolean  @default(false)  // caseworker: show prior party's files to new party
```

**`FileUpload`** — tracks which party uploaded each file:
```prisma
uploaderKind  String  @default("CLIENT")  // "CLIENT" | "SPONSOR"
```

**`Client`** — self-referential sponsor sub-accounts:
```prisma
sponsorForClientId  String?
sponsorForClient    Client?  @relation("SponsorOf",
                               fields:     [sponsorForClientId],
                               references: [id],
                               onDelete:   Cascade)
sponsorAccounts     Client[] @relation("SponsorOf")
sponsorLabel        String?  // e.g. "Partner" or "Sponsor" — shown in the portal header
visibleToClient     Boolean  @default(false)  // sponsor's documents shown read-only on the main client portal
```

`onDelete: Cascade` means hard-deleting a main case also deletes its sponsor row, and by the existing cascade chain, the sponsor's `Session`, `Invite`, and `SignInCode` rows. All `FileUpload` rows belong to the parent case's `ClientDocument` rows and are unaffected.

**`ActorType` enum** — new value for sponsor-initiated audit events:
```prisma
SPONSOR
```

### 2b. Migration SQL (`prisma/migrations/20261026_sponsor_accounts/migration.sql`)

```sql
-- ChecklistItem: route-level assignment default
ALTER TABLE "ChecklistItem"
  ADD COLUMN "assignedTo" TEXT NOT NULL DEFAULT 'CLIENT';

-- ClientDocument: per-case override and cross-party file flag
ALTER TABLE "ClientDocument"
  ADD COLUMN "assignedToOverride" TEXT,
  ADD COLUMN "filesShared" BOOLEAN NOT NULL DEFAULT false;

-- FileUpload: uploader provenance
ALTER TABLE "FileUpload"
  ADD COLUMN "uploaderKind" TEXT NOT NULL DEFAULT 'CLIENT';

-- Client: sponsor sub-accounts
ALTER TABLE "Client"
  ADD COLUMN "sponsorForClientId" TEXT,
  ADD COLUMN "sponsorLabel"        TEXT,
  ADD COLUMN "visibleToClient"     BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "Client"
  ADD CONSTRAINT "Client_sponsorForClientId_fkey"
  FOREIGN KEY ("sponsorForClientId") REFERENCES "Client"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "Client_sponsorForClientId_idx"
  ON "Client" ("sponsorForClientId");

-- ActorType enum
ALTER TYPE "ActorType" ADD VALUE IF NOT EXISTS 'SPONSOR';
```

---

## 2.5. Sponsor safety audit — every `db.client` query and every `/api/client/*` route

### `visibleCases()` as the primary defence

`visibleCases(u)` in `lib/documents.ts` becomes:

```typescript
export const visibleCases = (u: User) =>
  u.role === "ADMIN"
    ? { firmId: u.firmId, sponsorForClientId: null }
    : { firmId: u.firmId, caseworkerId: u.id, sponsorForClientId: null };
```

This single change propagates to `staffCaseList`, `staffCaseView`, `reviewDocument`, `respondToMissing`, `staffReadFile`, and any future query that uses `visibleCases(u)` as a `where` clause. Sponsor rows become invisible to all staff data access automatically.

### Other `db.client` queries that must explicitly exclude sponsors

| Location | Query | Treatment |
|---|---|---|
| `lib/reminders.ts` — missing docs | `db.client.findMany(...)` | Add `sponsorForClientId: null` explicitly (system job, no `visibleCases` wrapper) |
| `lib/reminders.ts` — redo docs | `db.clientDocument.findMany(...)` | No change needed; `ClientDocument` rows belong to the main case |
| `lib/accounts.ts` — `checkLogin` | `db.client.findUnique({ where: { email } })` | No filter — sponsors must be able to sign in |
| `lib/accounts.ts` — `redeemOtpCode` | Same | No filter — same reason |
| `lib/accounts.ts` — `findLink` | `db.invite.findUnique(...)` | No filter — invite tokens work for sponsors |
| `scripts/onedrive-folders.ts` (and any other script that iterates clients) | `db.client.findMany(...)` | Add `sponsorForClientId: null` |

### `/api/client/*` route treatment

| Route | Sponsor session behaviour |
|---|---|
| `POST /api/auth/client/signin` | Allowed — sponsors sign in here |
| `POST /api/auth/client/verify` | Allowed |
| `POST /api/auth/client/signout` | Allowed |
| `GET /api/client/portal` | Detected: if `client.sponsorForClientId !== null`, call `sponsorPortalView`. Otherwise `clientPortalView`. |
| `POST /api/client/upload/[id]/start` | Sponsor auth check added (see §6) |
| `POST /api/client/upload/[id]/chunk` | Sponsor auth check added |
| `POST /api/client/upload/[id]/complete` | Sponsor auth check added |
| `POST /api/client/documents/[id]/missing` | **Works for sponsors** — sponsor can flag their own (SPONSOR-assigned) documents. Auth check extended the same way as uploads: verify `doc.clientId === sponsor.sponsorForClientId` and `resolvedOwner === "SPONSOR"`. |
| `GET /api/client/messages` | **Refuse sponsor sessions — 403** |
| `POST /api/client/messages` | **Refuse sponsor sessions — 403** |
| `POST /api/client/messages/read` | **Refuse sponsor sessions — 403** |

The messages routes check at the top of the handler:

```typescript
if (session.client.sponsorForClientId) throw new UserError("Not available.");
// handler() turns UserError into a 400; for a cleaner 403 the route can return NextResponse.json({error:…},{status:403}) directly
```

### Staff request for a sponsor's id as a case

`staffCaseView(u, sponsorClientId)` returns `null` (because `visibleCases` now includes `sponsorForClientId: null`). The route handler turns `null` into 404. This is verified by e2e test #14 (see §13).

---

## 3. Resolved-assignment logic (`lib/sponsor.ts` — new file)

All code that needs to decide "who owns this document right now?" calls `resolvedOwner()`. It is a pure function with no DB access.

```
resolvedOwner(doc, sponsorActive):
  effective = doc.assignedToOverride ?? doc.checklistItem.assignedTo
  if effective === "SPONSOR" and not sponsorActive → return "CLIENT"
  return effective
```

`sponsorActive` is derived once per portal render:
```
sponsorActive = client.sponsorAccounts.some(s => s.closedAt === null)
```

Cancelling a sponsor sets `sponsor.closedAt = now()`. The next portal load computes `sponsorActive = false`, and every SPONSOR-assigned doc silently falls back to the client. The REDO → NEED rule is also applied at cancellation time (see §4).

### File visibility helper

```
visibleFiles(files, viewerKind, filesShared):
  active = files.filter(f => f.supersededAt === null)
  if filesShared → return active
  return active.filter(f => f.uploaderKind === viewerKind)
```

---

## 4. Status carry-over on ownership change

The REDO → NEED rule applies whenever a document's effective owner changes for **any** reason:

1. Caseworker sets `ClientDocument.assignedToOverride`.
2. Admin changes `ChecklistItem.assignedTo` (route-wide) — each affected `ClientDocument` that has no `assignedToOverride` must be checked and updated.
3. Sponsor is cancelled (`sponsor.closedAt` set) — every SPONSOR-assigned doc on the case whose current status is REDO is reset to NEED at cancellation time.

| Status before ownership change | Status after |
|---|---|
| **NEED** | NEED — new owner starts fresh |
| **SENT** | SENT ("Checking") — prior upload still under review |
| **OK** | OK ("Done") — approved stays approved |
| **REDO** | **NEED** — note, redoSince, redoRemindedAt all cleared |

The change handler (in whichever function triggers the ownership change) does:

```
if doc.status === "REDO":
  update ClientDocument: status = NEED, note = null, redoSince = null, redoRemindedAt = null
```

The portal view returns `doc.status` directly — no separate viewer-status function is needed.

Files shown on the portal are filtered by `uploaderKind` (or `filesShared`). If the new owner has no files of their own but the status is SENT, the portal renders "Checking" — the review is in progress on the prior party's upload. The new owner does not need to upload.

**REDO directed at the new owner**: the caseworker uses the existing "please redo" action after the reassignment. The REDO email goes to whoever is the resolved owner at that moment (see §8).

---

## 5. Visibility rules (full table)

| Viewer | Which documents shown | Files visible | Can upload |
|---|---|---|---|
| **Main client** | `resolvedOwner === "CLIENT"` | `uploaderKind === "CLIENT"` or `filesShared` | only when `resolvedOwner === "CLIENT"` |
| **Main client** (`visibleToClient = true`) | also SPONSOR-assigned docs shown read-only | same file filter | never for SPONSOR docs |
| **Sponsor** | `resolvedOwner === "SPONSOR"` | `uploaderKind === "SPONSOR"` or `filesShared` | only when `resolvedOwner === "SPONSOR"` |
| **Staff** | all docs for the case | all files | n/a |

Additional notes:
- "SPONSOR-assigned docs shown read-only" means the client can see the status and any files, but the upload and redo controls are not rendered. **Caseworker notes (the REDO note field) are not shown** in this read-only view — they were written to the sponsor and do not concern the main client.
- `filesShared` is per `ClientDocument`, toggled by the caseworker. It is independent of `visibleToClient`.

---

## 6. Sponsor portal access

### What the sponsor portal shows

The sponsor signs in via the same `/api/auth/client/*` endpoints and is identified by `client.sponsorForClientId !== null`. The portal handler detects this and sets `isSponsor: true` in the response. The frontend renders `<SponsorPortal>` instead of `<ClientPortal>`.

`<SponsorPortal>`:
- Shows a privacy-notice banner on the first visit (set a session flag, clear it on sign-out).
- Lists only SPONSOR-assigned documents, using the same `ScanFlow`/`DocDetail` components.
- No messages tab.
- No visa timeline or case-stage display.
- Header shows the firm name and the sponsor label (e.g. "Partner portal — UHA Legal").

`sponsorPortalView(sponsorId)` in `lib/documents.ts`:
1. Load the sponsor `Client` row; verify `sponsorForClientId !== null` — else throw `UserError`.
2. Load the **parent** `Client` and its documents, including `checklistItem` and `files`.
3. `sponsorActive = true` (trivially; the sponsor is signed in).
4. Filter docs to those where `resolvedOwner(doc, true) === "SPONSOR"` and `!shown` exclusion does not apply.
5. Apply `visibleFiles(files, "SPONSOR", doc.filesShared)` per document.
6. Return the same shape as `clientPortalView`.
7. Call `auditView(...)` (not `audit`) for `sponsor.view`: `{ actorType: "SPONSOR", actorId: sponsor.id, action: "sponsor.view", targetId: parentClientId }`.

### Upload authorisation for sponsors

All sponsor uploads go through the chunked upload routes (`/api/client/upload/[id]/start`, `/chunk`, `/complete`). There is no separate single-file upload route.

The upload session is created with the sponsor's `clientId` as the actor. On `start`:

```
uploaderClient = load Client where id = session.clientId
if uploaderClient.sponsorForClientId is not null:
  parentId = uploaderClient.sponsorForClientId
  doc = load ClientDocument where id = docId and clientId = parentId   → else 403
  resolvedOwner(doc, sponsorActive=true) must be "SPONSOR"             → else 403
  uploaderKind = "SPONSOR"
  caseFolder derived from parent client
  audit: actorType = "SPONSOR", actorId = uploaderClient.id
else:
  doc = load ClientDocument where id = docId and clientId = session.clientId → else 403
  sponsorActive = client.sponsorAccounts.some(s => !s.closedAt)
  resolvedOwner(doc, sponsorActive) must be "CLIENT"                         → else 403
  uploaderKind = "CLIENT"
  audit: actorType = "CLIENT", actorId = uploaderClient.id
```

The `UploadSession` row is created against the **sponsor's `clientId`** (for the session and rate-limit scope) but the `docId` points to the parent case's `ClientDocument`. This is safe because the auth check above already verified the parent relationship.

### "I can't find this document" flow

`reportMissing()` in `lib/documents.ts` is extended with the same dual-auth check: if the requesting client is a sponsor, verify `doc.clientId === sponsor.sponsorForClientId` and `resolvedOwner === "SPONSOR"`. Audit `actorType: "SPONSOR"`.

### Messages

The messages GET, POST, and read-mark routes return 403 for any session where `client.sponsorForClientId !== null` (see §2.5).

---

## 7. Invite, cancel, and sign-in for sponsors

**Caseworker identity rule:** Any operation that needs the caseworker for a sponsor (looking up their email, sending notifications) uses `sponsorForClient.caseworker`, not the sponsor row's own `caseworkerId`. This ensures that if the parent case is reassigned to a different caseworker, the sponsor's communications follow automatically.

### First invite

The caseworker fills in an email address and a label in the staff portal. `POST /api/staff/cases/[id]/sponsor`:

1. Check that no active sponsor row (`closedAt = null`) already exists for this case.
2. Check that the email is not already used by another `Client` row (main or sponsor) in the firm. If it is, return a clear message: *"That email address is already in use. Check that you have the right address, or contact us if you need help."*
3. Call `createSponsor(parentClientId, { email, label }, caseworker)` in `lib/cases.ts`:
   - Creates a `Client` row: `sponsorForClientId = parentClientId`, `firmId = parent.firmId`, `caseworkerId = parent.caseworkerId`, `routeId = parent.routeId`, `caseRef = "{parentCaseRef}-SP"`, `sponsorLabel = label`.
   - **Does not create any `ClientDocument` rows.** All documents live on the parent case.
   - Applies rate limit `hit("sponsorInvite", parentClientId)`.
4. Call `sendSponsorInvite(sponsorClient, parentClient, firm)` in `lib/accounts.ts`:
   - Uses existing `createLink(sponsorClient.id, "SETUP")` for the token (7-day, single-use).
   - Subject: `{firm.name}: invitation to upload your documents`.
   - Body: `{firm.name} has asked you to upload some documents to help with {parentClient.firstName} {parentClient.lastName}'s UK visa application. This link is valid for 7 days and can be used once.`
   - Action button: "Create account".
5. Audit `{ actorType: "USER", actorId: caseworker.id, action: "sponsor.invite", targetId: parentClientId }`.

### Re-invite after cancel (or if the link has expired)

When a sponsor row already exists (even if `closedAt` is set), re-inviting reactivates the **existing row** rather than creating a new one:

1. Clear `sponsor.closedAt` (set to `null`).
2. Call `createLink(sponsor.id, "SETUP")` — this invalidates any prior unused link.
3. Send the invite email as above.
4. Audit `sponsor.invite` again (same action name; the audit log is the history).

If the caseworker types a **different email address** when re-inviting, update `sponsor.email` (after confirming the new address is not already taken). This covers the case where the sponsor's email was wrong the first time.

### Cancelling a sponsor

`DELETE /api/staff/cases/[id]/sponsor`:

1. Set `sponsor.closedAt = now()`.
2. Apply the REDO → NEED rule to every SPONSOR-assigned doc on the parent case that is currently in REDO status (see §4).
3. Do not delete the sponsor row or its sessions/invites (data kept for audit; hard delete cascades from the parent case if that is ever hard-deleted).
4. Audit `sponsor.cancel` with `targetId = parentClientId`.

### Closing the main case auto-cancels the sponsor

When a caseworker closes a case, the close-case handler first calls the cancel logic above for any active sponsor before setting `client.closedAt`.

### Sponsor sign-in flow

Sponsors sign in via the same portal URL (`/`) using the same form as clients. They can use either their **password** (if they have set one via the setup link) **or** an **emailed one-time code** — these are two separate options, not a two-step sequence. The existing `checkLogin` / `redeemOtpCode` / `createSignInCode` functions work without modification. No new auth routes are needed.

The portal handler detects `sponsorForClientId !== null` in the returned session and renders `<SponsorPortal>`.

### Privacy-notice consent at account creation

The sponsor's account-creation page (`/i/:token`) shows a "Before you continue" screen with the privacy notice for partners/sponsors. The account is not created until the sponsor clicks "I understand and agree". This is recorded as `{ action: "sponsor.privacyConsent", targetId: sponsorId }` in the audit log.

---

## 8. Reminders

The current `sendDueReminders` queries the database for clients that have NEED documents. With sponsor assignment, three problems arise:

1. Sponsor accounts must be excluded from the existing client reminder loop.
2. NEED documents assigned to a sponsor must trigger a reminder to the sponsor, not the main client.
3. Which documents are "client-assigned NEED" vs "sponsor-assigned NEED" depends on `resolvedOwner()`, which cannot be expressed as a single Prisma `where` clause.

### Revised approach: fetch-then-filter

**Missing-documents reminders (client side):**
1. Fetch all open, unpaused, non-sponsor clients: add `sponsorForClientId: null` to the existing query.
2. Include `sponsorAccounts: { where: { closedAt: null } }` and the full document list with `checklistItem`.
3. In application code, derive `sponsorActive = c.sponsorAccounts.length > 0`.
4. Filter documents to those where `resolvedOwner(doc, sponsorActive) === "CLIENT"` and `status === "NEED"` and `checklistItem.required` and `checklistItem.archivedAt === null` and `missingAt === null`.
5. If any such documents exist and the reminder cadence is due, send the existing-style reminder email to `c.email`.

**Missing-documents reminders (sponsor side):**
1. Fetch sponsor `Client` rows: `sponsorForClientId: { not: null }, closedAt: null, remindersPaused: false, reminderCount: { lt: MAX_MISSING }`.
2. Include the parent case's documents (`sponsorForClient: { include: { documents: { include: { checklistItem: true } } } }`).
3. For each sponsor, filter parent docs to `resolvedOwner(doc, true) === "SPONSOR"` and `status === "NEED"` and `checklistItem.required` and `checklistItem.archivedAt === null` and `missingAt === null`.
4. Check the sponsor row's `lastReminderAt` / `createdAt` cadence (same `MISSING_EVERY_DAYS` / `MAX_MISSING` constants).
5. Send a reminder to `sponsor.email` pointing to `${appUrl()}/`.
6. Audit `{ actorType: "SYSTEM", action: "sponsor.reminder" or "sponsor.reminder.failed", targetId: sponsorId }`.

**REDO reminders:**
When `ClientDocument.status === "REDO"`, the REDO email (sent immediately by `reviewDocument`) must go to whoever is the resolved owner at that moment. At reminder time (2 days later), the same: load the doc, load the parent client and sponsor accounts, compute `resolvedOwner`. Send to `sponsor.email` if SPONSOR, else `client.email`. Audit `sponsor.reminder.redo` or `client.reminder.redo` accordingly.

### `reminderSummary()` (shown in staff portal)

Extend to accept a second argument — the count of sponsor-assigned NEED documents — and return a sponsor-specific summary line alongside the client one.

---

## 9. Case close / delete

### Closing a case

The close-case handler:
1. Finds any active sponsor (`closedAt = null`).
2. If one exists: applies the REDO → NEED rule to all SPONSOR-assigned REDO docs, sets `sponsor.closedAt = now()`, audits `sponsor.cancel`.
3. Sets `client.closedAt = now()`.

The main client cannot sign in (existing check). The sponsor is blocked at the same time (its own `closedAt` is now set).

### Hard deletion (cascade)

Hard-deleting a `Client` row cascades to its sponsor row (via the new `onDelete: Cascade` constraint), which cascades to the sponsor's `Session`, `Invite`, `SignInCode`, and `UploadSession` rows. All `FileUpload` rows belong to the parent case's `ClientDocument` rows, so they are unaffected.

Sponsors have no `ClientDocument` rows. There is nothing else to cascade.

---

## 10. Document reassignment in the staff portal

### Route-level (admin only — checklist editor)

Admin toggles `ChecklistItem.assignedTo` between "CLIENT" and "SPONSOR" in the route editor. This is route-wide. For every case on this route, any `ClientDocument` that has no `assignedToOverride` changes its effective owner. The handler must apply the REDO → NEED rule (§4) to each affected document where the effective owner changes and the current status is REDO.

Audit action: `checklist.assignedTo.CLIENT` or `checklist.assignedTo.SPONSOR` (encodes the new value in the action name, since `AuditLog` has no `detail` column).

### Case-level override (caseworker — case document screen)

Caseworker selects "Client", "Sponsor", or "Route default" in a dropdown per document. Writes `ClientDocument.assignedToOverride`.

On change:
1. Compute the old resolved owner and the new resolved owner.
2. If they differ and the doc's status is REDO: apply the REDO → NEED rule.
3. Audit using the new owner value in the action name: `document.reassign.CLIENT` or `document.reassign.SPONSOR` or `document.reassign.DEFAULT`.

API: `PATCH /api/staff/documents/[id]/assign` — body `{ assignedTo: "CLIENT" | "SPONSOR" | null }` (next to the existing review route; Next.js does not allow `[id]` twice in one path).

### `filesShared` toggle (caseworker)

Same endpoint (`PATCH /api/staff/documents/[id]/assign`), body `{ filesShared: boolean }`. Audit action: `document.filesShared.on` or `document.filesShared.off`.

### `visibleToClient` toggle (caseworker)

`PATCH /api/staff/cases/[id]/sponsor` — body `{ visibleToClient: boolean }`. Audit action: `sponsor.visibleToClient.on` or `sponsor.visibleToClient.off`.

### Audit actors in `clientActivity`

`AuditLog` rows with `actorType = "SPONSOR"` are displayed in the client activity feed as **"Partner/Sponsor"** (the label already stored on the sponsor row can be used if available, falling back to "Partner/Sponsor").

---

## 11. Complete file change map

| File | Change |
|---|---|
| `prisma/schema.prisma` | Add 7 fields + 1 enum value (see §2a) |
| `prisma/migrations/20261026_sponsor_accounts/migration.sql` | New migration (see §2b) |
| **`lib/sponsor.ts`** | **New.** `resolvedOwner(doc, sponsorActive)`, `visibleFiles(files, viewerKind, filesShared)`. Pure functions, no DB. |
| `lib/cases.ts` | Add `createSponsor(parentClientId, { email, label }, caseworker)`. No `ClientDocument` creation. |
| `lib/accounts.ts` | Add `sendSponsorInvite(sponsorClient, parentClient, firm)` (uses existing `createLink`). |
| `lib/documents.ts` | `visibleCases`: add `sponsorForClientId: null`. `staffCaseList`: inherits via `visibleCases`. `staffCaseView`: inherits; add sponsor sub-account to return value. `clientPortalView`: compute `sponsorActive`, filter by `resolvedOwner`, apply `visibleFiles`; for `visibleToClient` docs, suppress REDO note. New `sponsorPortalView(sponsorId)`. `uploadDocument`: sponsor auth path + `uploaderKind`. `reportMissing`: sponsor auth path. |
| `lib/reminders.ts` | Add `sponsorForClientId: null` to client query. New sponsor reminder loop. REDO reminder routing (see §8). |
| **`app/api/staff/cases/[id]/sponsor/route.ts`** | **New.** `POST` (invite / re-invite), `DELETE` (cancel), `PATCH` (visibleToClient). |
| **`app/api/staff/documents/[id]/assign/route.ts`** | **New.** `PATCH` (assignedToOverride, filesShared). Next to the existing review route. |
| `app/api/staff/cases/[id]/route.ts` | Expose `assignedTo` on each `ChecklistItem`; allow admin to change it. Include sponsor data in case view. |
| `app/api/client/portal/route.ts` | Detect sponsor session → call `sponsorPortalView`. |
| `app/api/client/upload/start/route.ts`, `upload/[sid]/chunk/route.ts`, `upload/[sid]/complete/route.ts` | Sponsor auth check added (see §6). Routes kept exactly as-is; only auth logic extended. |
| `app/api/client/messages/route.ts` | Refuse sponsor sessions (403). |
| `app/api/client/messages/read/route.ts` | Refuse sponsor sessions (403). |
| `app/api/client/documents/[id]/missing/route.ts` | Sponsor auth check added (see §6). |
| `app/api/auth/client/setup/route.ts` | Privacy-notice consent screen for sponsors; audit `sponsor.privacyConsent`. |
| `scripts/onedrive-folders.ts` (and any script that iterates all clients) | Add `sponsorForClientId: null`. |
| **`components/SponsorPortal.tsx`** | **New.** Privacy-notice banner; SPONSOR-assigned doc list; no messages or timeline. |
| `components/ClientPortal.tsx` | Detect `isSponsor` → render `<SponsorPortal>`. |
| `components/StaffPortal.tsx` | Case view: sponsor card (invite form, status, cancel, visibleToClient). Per-doc: assignment dropdown, filesShared toggle. Route editor: assignedTo toggle per checklist item. |
| `docs/dpia.md` | R10 → resolved. Add R14 (see §12). |
| `docs/privacy-notice.md` | Add "If you are a partner or sponsor" section (see §12). |
| `tests/sponsor.test.ts` | **New.** Unit tests for `lib/sponsor.ts` pure functions. |
| `tests/cases.test.ts` | `createSponsor` unit tests. |
| `tests/documents.test.ts` | `uploadDocument` and `reportMissing` sponsor-path tests. |
| `e2e/journeys.spec.ts` | New `sponsor access rules` describe block (see §13). |

---

## 12. Privacy document changes

### `docs/dpia.md`

**R10** — replace the "Medium — action needed" entry:

> Partners and sponsors receive their own invitation email. They create a separate account and read a privacy notice before it is created. They see only the documents assigned to them and cannot see the main client's documents unless the caseworker specifically enables a read-only view. Files do not cross between parties unless the caseworker explicitly enables it, which is audit-logged. **Residual: Low.**

Remove the action `[ ] Partner/sponsor information (R10)` from §6 and replace with `[x] Resolved — sponsor accounts implemented`.

**R14** — add new row to the risk table:

| R14 | Sponsor sees main client's documents, or vice versa | Possible / High | `resolvedOwner()` gates every read and upload; `visibleToClient` and `filesShared` are opt-in, caseworker-only, and audit-logged; `visibleCases()` excludes sponsor rows from all staff queries; automated e2e tests prove isolation | Low |

### `docs/privacy-notice.md`

Add after the "What the portal collects" table:

> **If you are a partner or sponsor**
>
> If your partner's or relative's UK visa application is managed by UHA Legal, you may receive a separate
> invitation to upload your own documents (for example, your passport or payslips). You will create your own
> account, protected by a password or a one-time code sent to your email. Before creating your account you will
> be asked to read and agree to this notice.
>
> You will see only the documents assigned to you. You will not see the main applicant's documents unless UHA
> Legal specifically enables that for you. The same rights described below (access, correction, deletion, etc.)
> apply to you. We use your information only to support the visa application.

Update the "Data subjects" line in §2 of the DPIA: "clients; their partners/sponsors (who have their own accounts and read a privacy notice before account creation); employers named in documents; UHA Legal staff."

---

## 13. End-to-end test list

All tests in `test.describe.serial("sponsor access rules")` in `e2e/journeys.spec.ts`.

**Setup:** seed must have a "Spouse" route with 3 CLIENT items and 2 SPONSOR items (set via `ChecklistItem.assignedTo`). Caseworker creates a test case before the block runs.

| # | Test name | What it verifies |
|---|---|---|
| 1 | sponsor sees only SPONSOR items | Sponsor signs in; counts visible documents; CLIENT items are absent |
| 2 | sponsor portal 403 on CLIENT doc upload | Chunked upload `start` for a CLIENT-assigned doc returns 403 |
| 3 | sponsor portal 403 on CLIENT doc "missing" | `POST /api/client/documents/[id]/missing` for a CLIENT-assigned doc returns 403 |
| 4 | client cannot see sponsor docs by default | Client signs in; counts visible documents; SPONSOR items absent |
| 5 | client sees sponsor docs read-only, no redo note | Caseworker enables `visibleToClient` and sends a REDO on the sponsor's doc; client sees the doc as REDO but with no note text |
| 6 | client upload 403 on SPONSOR doc | Chunked upload `start` for a SPONSOR-assigned doc returns 403 |
| 7 | no-sponsor fallback: client sees all items after cancel | Caseworker cancels sponsor; client immediately sees all 5 items and can start a chunked upload on the formerly-SPONSOR items |
| 8 | case-level override: caseworker moves SPONSOR → CLIENT | Client sees the reassigned item; sponsor no longer sees it |
| 9 | case-level override: caseworker moves CLIENT → SPONSOR | Sponsor sees the reassigned item; client loses it |
| 10 | REDO clears on reassign | Client has a REDO doc (with note). Caseworker reassigns to sponsor. Sponsor sees NEED with no note. Client no longer sees it. |
| 11 | files do not cross parties by default | Sponsor uploads item A; caseworker reassigns to client; client sees SENT but no files |
| 12 | filesShared reveals prior files | Caseworker enables `filesShared` on item A; client sees the sponsor's upload |
| 13 | sponsor not in case list | Staff case list does not include the sponsor row |
| 14 | staff 404 for sponsor id as a case | `GET /api/staff/cases/{sponsorClientId}` returns 404 |

All tests also run at 375 px viewport (phone-sized), as required by CLAUDE.md.

---

## 14. [OPEN] items / deferred decisions

None. Everything in this document is fully specified. If implementation reveals an unexpected constraint, raise it before changing direction.
