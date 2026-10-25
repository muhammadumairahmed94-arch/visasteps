# ⚠️ DRAFT — Data Protection Impact Assessment (DPIA) — needs review and sign-off ⚠️

> Prepared by an AI assistant from the portal's design. The firm's data-protection lead and a lawyer must review,
> complete the **[bracketed]** items, decide on the risks, and sign section 7 before real client data is stored.

**Project:** UHA Legal client document portal (portal.uhalegal.com)  **Version:** 0.1  **Date:** [ ]

## 1. Why a DPIA is needed

Large volumes of identity documents (passports), financial records and some **special category data**
(health — TB certificates; possibly religion — marriage certificates), relating to clients **and third parties**
(partners/sponsors, employers), processed using new technology. This meets ICO screening criteria.

## 2. Description of the processing

- **Purpose:** collect, organise and review documents for UK visa applications (spouse route first).
- **Data subjects:** clients; their partners/sponsors; employers named in documents; UHA Legal staff.
- **Flow:** caseworker invites client by email → client creates an account → uploads photos/PDFs → file checked
  (type, size, virus scan), converted to PDF, renamed, saved to the firm's OneDrive → caseworker approves or asks
  for a redo → reminders by email. Client and caseworker can exchange text messages inside the portal. Every action
  recorded in an audit log.
- **Systems:** DigitalOcean server in London (portal, database, virus scanner); Microsoft OneDrive (documents and
  encrypted nightly database backups); Hostinger email (notifications).
- **Volume:** [expected clients per year ___ ; documents per client ~10–20].
- **Retention:** [to be set — see section 6, risk R7].

## 3. Consultation

[Record who was consulted: firm owner, caseworkers, a sample of clients (the 3-client pilot), IT/security reviewer.]

## 4. Necessity and proportionality

- Only documents on the visa checklist are requested; optional items are labelled optional.
- Mobile number optional; no SMS; no tracking or advertising cookies.
- Access limited by role (client → own case; caseworker → own clients; admin → firm).
- [Lawful bases — see privacy notice draft; confirm Article 9 condition for special category data.]
- Clients are told what each document is for (one sentence per item) and given a privacy notice [link to be added
  to the portal sign-in and account-creation pages once approved].

## 5. Risks and measures

| # | Risk | Likelihood / impact (before) | Measures in place | Residual |
|---|---|---|---|---|
| R1 | Account takeover of a client | Possible / High | Hashed passwords, lockout, rate limits, single-use emailed links, sessions revoked on password change | Low |
| R2 | Account takeover of a caseworker (access to many clients) | Possible / Severe | Password **and** authenticator app (2FA), recovery codes, lockout, admin can revoke access instantly | Low |
| R3 | A client seeing another client's documents | Possible / Severe | Every query scoped to the client; automated test proves isolation | Low |
| R4 | Malicious upload (malware) | Possible / High | Content-type check, ClamAV scan of every file, refuse if scanner down | Low |
| R5 | Server breach | Unlikely / Severe | Firewall, key-only SSH, automatic security updates, documents not kept on the server (only encrypted, briefly, while waiting for OneDrive), secrets encrypted | Low–Medium |
| R6 | **Documents stored in Microsoft 365 *Personal* OneDrive** | Possible / High | Access limited to an app folder; owner's Microsoft account protected by a strong password and 2FA [confirm]; files tied to one personal account; licence is for personal use; **data location not guaranteed UK** | **Medium–High — owner accepted for now (18 Oct 2026). Recommended: move to Microsoft 365 Business (UK) before scale; the portal already supports it.** |
| R7 | Keeping data longer than needed | Likely / Medium | [No automatic deletion yet. Decide retention period; add a "close case / delete" process] | **Open** |
| R8 | Email mis-delivery or interception | Possible / Medium | Emails contain links, not documents; redo and caseworker-reply emails contain no case details or note text — only a prompt and a portal link; links single use and time-limited; reminders list document names only | Low |
| R9 | Loss of data (deletion, ransomware) | Unlikely / High | Nightly encrypted backups (30 days, in OneDrive — same account as the documents, so keep an occasional offline copy), OneDrive version history, `_Old versions` never deleted, restore procedure documented | Low (once restore tested) |
| R10 | Third-party data (partners/sponsors) without their knowledge | Likely / Medium | Partner/sponsor accounts: partner receives a direct invite email and is shown a privacy notice at account creation; acceptance is recorded in the audit log. Where a partner uploads documents that name a further third party (e.g. employer payslips), the client is advised to share the notice with that party. | Low |
| R11 | Inline scripts allowed by the browser security policy | Unlikely / Medium | No user-written HTML rendered; React escaping; other headers strict | Low (accepted) |
| R12 | Staff misuse | Unlikely / High | Role-based access; audit log of views, opens and changes, visible per client | Low |
| R13 | Message content intercepted or read by wrong party | Possible / High | Messages encrypted at rest (AES-256-GCM, key not in the database); only the client, their assigned caseworker and the firm's admins can access the thread; email notifications contain no message text; rate-limited sends; messages deleted when the case is deleted | Low |
| R14 | Partner/sponsor account isolation — partner sees too much, or main client sees partner uploads prematurely | Possible / Medium | Partners see only SPONSOR-assigned documents; main client only sees partner documents when a caseworker explicitly enables cross-party visibility (visibleToClient flag); uploaded files are filtered by uploaderKind in both portals; sponsor account is cascade-deleted when the main case is deleted | Low |

## 6. Actions before launch

- [ ] Decide retention periods (R7) and how accounts/files are closed or deleted.
- [ ] Decide on Microsoft 365 Personal vs Business (R6); if staying Personal, secure the Microsoft account with 2FA.
- [ ] Approve and publish the privacy notice (now includes partner/sponsor section); link it in the portal.
- [x] Partner/sponsor information — R10 resolved by direct-invite design with in-portal privacy notice. R14 added and mitigated.
- [ ] Confirm ICO registration and Article 9 condition.
- [ ] Test a backup restore (R9).
- [ ] Independent security test (see docs/security-review.md).
- [ ] Pilot with 3 real clients and record feedback (section 3).

## 7. Sign-off

| Item | Name / role | Date | Decision |
|---|---|---|---|
| Measures approved | | | |
| Residual risks accepted (incl. R6) | | | |
| Data-protection advice | | | |
| Review date | | | |
