# UHA Legal Client Portal (VisaSteps)

Client document portal for an immigration firm. See `../SPEC.md` for the full spec.
**Status: Phase 5 (ready to deploy)** — Docker setup, backups, monitoring, security review and legal drafts done. AI guidance check, document analysis, requirements library and eval harness added. Earlier phases: reminders, admin screen, HEIC conversion, virus scanning and browser tests. Files save to the owner's OneDrive (Microsoft 365 Personal); real email; caseworker 2FA; rate limits; audit log.

## Run it

Needs Node 20+ and PostgreSQL 16 (`brew install postgresql@16 && brew services start postgresql@16`).

```bash
cp .env.example .env        # then fill in AUTH_SECRET and SEED_STAFF_PASSWORD
createdb visasteps
npm install
npx prisma migrate dev      # creates tables
npm run db:seed             # demo firm, caseworker, Amina Khan — prints an invite link
npm run dev                 # http://localhost:3000
```

`npm run db:seed` wipes the database and Amina's folder and starts the demo again.

## Try it

| Who | Where | How |
|---|---|---|
| Admin | http://localhost:3000/staff | `info@uhalegal.com` + `SEED_ADMIN_PASSWORD` from `.env` (sets up 2FA on first sign-in) |
| Caseworker | http://localhost:3000/staff | `caseworker@uhalegal.example` + `SEED_STAFF_PASSWORD` from `.env` |
| Client (Amina, has an account) | http://localhost:3000 | `amina.khan@example.com` + `SEED_CLIENT_PASSWORD` from `.env` |
| New client (invited, no account yet) | the "create your account" link the seed prints | Choose a name and password |

How clients get in: the caseworker enters the client's email → the client gets an email with a
"Create your account" link (7 days, single use) → they add their name, optional mobile and a password.
After that they sign in with email + password. "Forgot your password?" emails a 1-hour reset link.
10 wrong passwords lock the account for 15 minutes. Emails print in the `npm run dev` terminal.

Uploaded files land in `./local-storage/Clients/{Surname}_{Firstname}_{CaseRef}/{Folder}/`, renamed
`{Surname}_{DocumentType}[_n]_{YYYY-MM-DD}.pdf`. Redone files move to `_Old versions/`.

## Layout

- `app/` — pages (`/`, `/i/[token]`, `/staff`) and API routes under `app/api`
- `components/` — `ClientPortal`, `ClientSignIn`, `StaffPortal`, shared `ui`
- `lib/adapters/` — SMS, email, storage. `*_PROVIDER=fake` logs / writes locally
- `lib/documents.ts` — upload, review and the scoped read models
- `lib/checklists/` — seed checklist data (routes and items live in the database)
- `prisma/` — schema, migrations, seed

## Checks

```bash
npm test                           # unit tests (545, incl. PII scrub, PDF, Microsoft Graph, HEIC, virus)
npm run typecheck
npm run lint
npm run test:e2e                   # Playwright browser tests (desktop + phone at 375 / 360 px)
AI_PROVIDER=fake npm run ai:eval   # AI eval harness against synthetic fixtures
```

## Phase 2: security and email

**Email.** Set `EMAIL_PROVIDER="smtp"` and the `SMTP_*` / `EMAIL_FROM` values in `.env` (a Hostinger
mailbox, same as uhalegal.com). Restart `npm run dev`. With `EMAIL_PROVIDER="fake"` emails print in the terminal.
If sending fails, the caseworker sees a warning and can use "Send invite again".

**Caseworker 2FA.** Every caseworker signs in with password + a 6-digit code from Microsoft or Google
Authenticator. The first sign-in shows a QR code to scan, then 8 single-use recovery codes (shown once).
A password alone gives no access. 10 wrong passwords/codes lock the account for 15 minutes.

**Rate limits** (stored in the `RateLimit` table, see `lib/ratelimit.ts`): client sign-in 20 / 15 min per
connection; password reset 3 / hour per email; emailed links 30 / 15 min; caseworker sign-in 30 / 15 min per
connection; uploads 60 / hour per client; new clients 50 / hour per caseworker.

**Audit log.** Every sign-in (and failed attempt), sign-out, view, upload, file opened, approval, redo,
invite and password reset is written to `AuditLog`. Caseworkers see a plain-English "Activity" list on
each client's Client tab.

**Text messages** are off (`SMS_PROVIDER="off"`), by choice. Twilio can be added later behind the same adapter.

## Phase 3: SharePoint (Microsoft 365)

Follow **docs/onedrive-setup.md** (Microsoft side, ~20 min), then `npm run setup:onedrive`. Until then files save
to `./local-storage` exactly as they will in SharePoint.

- `lib/adapters/graph.ts` — Microsoft Graph: folders, uploads (chunked above 4 MB), moves, downloads, throttling retries.
- `lib/storage-queue.ts` — if Microsoft is unreachable the file waits encrypted in `upload-queue/` and is retried
  (1, 2, 4 … 60 min, 8 tries). Caseworkers see the status per file, a **Retry now** button and **Open in SharePoint**.
- Try the queue locally: set `STORAGE_FAKE_OUTAGE="1"`, restart, upload, then remove it and press **Retry now**.
- `npm run onedrive:check` re-tests the connection; `npm run onedrive:folders` creates folders for existing clients.

## Phase 4: reminders, admin, file handling, tests

**Reminders** (`lib/reminders.ts`, run every 15 min by the server, or hourly via `GET /api/jobs/reminders` with
`Authorization: Bearer <CRON_SECRET>`): missing documents every 3 days (max 5); "please re-upload" once after 2 days;
only 9am–7pm UK time. Caseworkers can pause per client (Client tab). Clients without an account get a fresh invite.

**Admin screen** (Clients → "Admin", admins only): add caseworkers (they get a "set your password" email, then set up
2FA), resend password links, reset lost-phone 2FA, change roles, remove people (their clients move to someone else;
history kept). Firm name, phone, WhatsApp. Checklist editor per visa route: add routes (empty or copied), add/edit/
reorder/remove documents. Removed documents stay for clients who already sent them.
First admin on a live server: `npm run admin:create`.

**Files.** iPhone HEIC photos convert to PDF. Every upload is virus-scanned by ClamAV (`VIRUS_SCAN="clamav"`); if the
scanner is down, uploads are refused rather than let through. Local scanner: `brew services start clamav` (port 3310).

**Tests.** `npm test` (545 unit tests, incl. PII scrubbing, Microsoft Graph, EICAR virus, HEIC) and
`npm run test:e2e` — Playwright drives a real browser through: invite → account → upload → approve; upload → redo →
re-upload (old file in `_Old versions`); a client cannot reach another client's documents; admin adds a caseworker
and a checklist document; phone-sized screens (375 px iPhone and 360 px Android) for every client-facing screen;
accessibility checks (inputs labelled, buttons named, keyboard tab navigation). E2E uses its own database
(`visasteps_test`), folders and file-based email.

Real email is never sent to reserved test domains (`example.com`, `.example`, `.test`, `.invalid`).

## Phase 5: AI features

AI is off by default (`AI_PROVIDER="off"`) and toggled per firm by an admin. Set `AI_PROVIDER` in `.env` to enable.

**AI guidance check** (`components/GuidanceCheckTab.tsx`, `app/api/staff/cases/[id]/guidance-check/`) —
caseworkers click "Run guidance check" on a client case; the portal compares the uploaded documents against the
approved immigration requirements and returns a per-requirement verdict (MET / NOT_MET / UNCLEAR). Caseworkers
review each item and confirm or disagree. Results are stored encrypted (AES-256-GCM).

**Document checks** (`app/api/staff/cases/[id]/doc-checks/`, `app/api/jobs/doc-checks/`) — background job (cron
or admin button) reads each uploaded document and flags expiry dates, holder names and format issues. Staff-only.

**Document analysis / Q&A** (`components/AnalyseTab.tsx`, `app/api/staff/cases/[id]/analysis/`) — caseworker
asks a question in plain English; the portal reads the uploaded documents and returns a grounded answer with page
citations. Staff-only. Requires `aiEnabled=true` on the firm.

**Requirements library** (`components/RequirementsTab.tsx`, `app/api/admin/requirements/`) — admin uploads
guidance PDFs, and an AI run extracts individual requirements (what is checked, evidence needed, citation). Admins
approve, reject or edit each requirement before it is used for guidance checks.

**Eval harness** (`scripts/eval-guidance.mts`, `evals/`) — `npm run ai:eval` runs the guidance-check pipeline
against a set of test fixtures and reports pass/fail. Synthetic fixtures live in `evals/*.json`. Real-case fixtures
saved by admins are stored encrypted in the database (`EvalFixture` table) and are never committed to git.

**Save as test case** — admin clicks "Save as test case" on any disagreed guidance-check result. The portal scrubs
PII automatically then shows an editor for final review; the admin ticks "I have removed all real personal details"
before saving. Stored AES-256-GCM encrypted, audit-logged, admin-only, rate-limited.

**Settings:**

| Variable | Values | Notes |
|---|---|---|
| `AI_PROVIDER` | `off` \| `fake` \| `bedrock` \| `anthropic` | Default `off`. Use `fake` in dev / CI |
| `AI_MODEL_ID` | e.g. `anthropic.claude-sonnet-4-5-20251001-v1:0` | Bedrock model ID |
| `AWS_BEDROCK_REGION` | `eu-west-2` | Keep London for UK data residency |
| `ANTHROPIC_API_KEY` | key | Direct Anthropic API only |

## Phase 5: going live

Everything for the live server is in this folder; nothing has been deployed yet.

- **`docs/deploy.md`** — step by step: DigitalOcean (London), DNS at Hostinger, server setup, first run, monitoring.
- `docker-compose.yml` + `Dockerfile` + `deploy/` — portal, Postgres, ClamAV, Caddy (automatic HTTPS), nightly
  encrypted backups to OneDrive. `scripts/deploy.sh` builds on the Mac, copies and starts it. `npm run init:production` sets up the firm.
- `/api/health` for the uptime monitor; alert emails to `ALERT_EMAIL` (errors, OneDrive, scanner, backups).
- `docs/backup-restore.md`, `docs/security-review.md`, `docs/launch-checklist.md`.
- **Legal docs:** `docs/privacy-notice.md` (published at /privacy; AI section saved separately in `docs/privacy-notice-ai-section.md`), `docs/dpia.md` (signed 28 Oct 2026; AI risks R15–R18 gated on R17).

Dry-run of the full Docker setup on this Mac: `brew install colima docker docker-compose`, `colima start --memory 6`.
