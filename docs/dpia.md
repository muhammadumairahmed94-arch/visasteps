# Data Protection Impact Assessment

**Project:** UHA Legal client document portal (portal.uhalegal.com)  **Version:** 1.0  **Date:** 28 October 2026

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
  encrypted nightly database backups); Hostinger email (notifications); AI language model provider (see below).
- **Volume:** about 100 clients per year; documents per client ~10–20.
- **Retention:** 6 years after case closure (configurable per firm); see R7.
- **AI features (when `AI_PROVIDER` is not `"off"`):** three AI-powered features send document text to a language-model provider:
  - *Document analysis* — caseworker asks a question; the AI reads uploaded document text and returns a sourced answer (staff-only, never shown to clients).
  - *Document checks* — background job reads each uploaded document and flags expiry dates, names, and format issues (staff-only).
  - *Guidance check* — checks whether the documents on file satisfy an immigration rule (staff-only; caseworker reviews every result and can disagree).
  In all cases a qualified caseworker reviews the output and makes the decision; no action is taken solely by automated processing.
  The portal uses **AWS Bedrock in the `eu-west-2` (London) region** as the intended option; whether processing stays in the UK depends on the chosen model being available in eu-west-2 without a cross-region profile (see R17). Alternatively `AI_PROVIDER=anthropic` routes to Anthropic's own API [confirm data location and safeguard if used].
  The AI provider receives document text only; it does not receive client names, case references or contact details from the portal directly (those may appear in uploaded documents). AWS does not use customer data to train models (AWS DPA). Anthropic's zero-data-retention enterprise policy applies when using Anthropic API direct [confirm zero-retention endpoint is configured].
- **AI test cases:** admins may save a disagreed guidance-check result as an eval fixture. Before saving, the admin must manually replace all personal details with synthetic stand-ins and confirm they have done so; the portal applies automatic first-pass scrubbing (names, dates of birth, passport numbers, NI numbers, sort codes, account numbers, IBANs, postcodes, phone numbers). The resulting fixture is stored encrypted (AES-256-GCM) in the database, never on disk or in version control. These fixtures are used only to test and improve the AI pipeline and must never contain real personal data. The save action is admin-only, rate-limited, and audit-logged.

## 3. Consultation

[Record who was consulted: firm owner, caseworkers, a sample of clients (the 3-client pilot), IT/security reviewer.]

## 4. Necessity and proportionality

- Only documents on the visa checklist are requested; optional items are labelled optional.
- Mobile number optional; no SMS; no tracking or advertising cookies.
- Access limited by role (client → own case; caseworker → own clients; admin → firm).
- Lawful bases as set out in the privacy notice: contract, legal obligation and legitimate interests (Article 6(1)(b), (c), (f)); special category data under Article 9(2)(f) (legal claims and legal advice). Confirmed by Hamza Tahir.
- Clients are told what each document is for (one sentence per item) and given a privacy notice linked from the portal sign-in and account-creation pages.

## 5. Risks and measures

| # | Risk | Likelihood / impact (before) | Measures in place | Residual |
|---|---|---|---|---|
| R1 | Account takeover of a client | Possible / High | Hashed passwords, lockout, rate limits, single-use emailed links, sessions revoked on password change | Low |
| R2 | Account takeover of a caseworker (access to many clients) | Possible / Severe | Password **and** authenticator app (2FA), recovery codes, lockout, admin can revoke access instantly | Low |
| R3 | A client seeing another client's documents | Possible / Severe | Every query scoped to the client; automated test proves isolation | Low |
| R4 | Malicious upload (malware) | Possible / High | Content-type check, ClamAV scan of every file, refuse if scanner down | Low |
| R5 | Server breach | Unlikely / Severe | Firewall, key-only SSH, automatic security updates, documents not kept on the server (only encrypted, briefly, while waiting for OneDrive), secrets encrypted | Low–Medium |
| R6 | **Documents stored in Microsoft 365 *Personal* OneDrive** | Possible / High | Access limited to an app folder; owner's Microsoft account protected by a strong password and 2FA (confirmed 29 October 2026); files tied to one personal account; licence is for personal use; **data location not guaranteed UK** | **Medium–High — owner accepted for now (18 Oct 2026). Recommended: move to Microsoft 365 Business (UK) before scale; the portal already supports it.** |
| R7 | Keeping data longer than needed | Likely / Medium | Automatic retention-based deletion: 6 years after a case closes (configurable per firm), a daily job warns admins by email (30 days before) and deletes the case: all DB records, sessions, AI data, and the OneDrive folder (including `_Old versions`). Only a minimal audit entry (case ref, date, "deleted under retention policy") is kept. Admins can extend, delete early, or place a legal hold from Admin → Deletion. Backups roll off on their own within 30 days. Open cases are never deleted automatically. | **Resolved** |
| R8 | Email mis-delivery or interception | Possible / Medium | Emails contain links, not documents; redo and caseworker-reply emails contain no case details or note text — only a prompt and a portal link; links single use and time-limited; reminders list document names only | Low |
| R9 | Loss of data (deletion, ransomware) | Unlikely / High | Nightly encrypted backups (30 days, in OneDrive — same account as the documents, so keep an occasional offline copy), OneDrive version history, `_Old versions` never deleted, restore procedure documented | Low (once restore tested) |
| R10 | Third-party data (partners/sponsors) without their knowledge | Likely / Medium | Partner/sponsor accounts: partner receives a direct invite email and is shown a privacy notice at account creation; acceptance is recorded in the audit log. Where a partner uploads documents that name a further third party (e.g. employer payslips), the client is advised to share the notice with that party. | Low |
| R11 | Inline scripts allowed by the browser security policy | Unlikely / Medium | No user-written HTML rendered; React escaping; other headers strict | Low (accepted) |
| R12 | Staff misuse | Unlikely / High | Role-based access; audit log of views, opens and changes, visible per client | Low |
| R13 | Message content intercepted or read by wrong party | Possible / High | Messages encrypted at rest (AES-256-GCM, key not in the database); only the client, their assigned caseworker and the firm's admins can access the thread; email notifications contain no message text; rate-limited sends; messages deleted when the case is deleted | Low |
| R14 | Partner/sponsor account isolation — partner sees too much, or main client sees partner uploads prematurely | Possible / Medium | Partners see only SPONSOR-assigned documents; main client only sees partner documents when a caseworker explicitly enables cross-party visibility (visibleToClient flag); uploaded files are filtered by uploaderKind in both portals; sponsor account is cascade-deleted when the main case is deleted | Low |
| R15 | **AI guidance check returns wrong verdict** — caseworker misses a problem because the AI said the requirement was met | Possible / High | Verdict is advisory only; caseworker reviews every result and must actively confirm or disagree; "UNCLEAR" verdict prompts manual review; caseworker's disagree action is audit-logged; features can be disabled firm-wide (`AI_PROVIDER=off`) | Medium (human review required) |
| R16 | **Prompt injection** — a malicious document uploaded by a client manipulates the AI model's output | Possible / Medium | Document text is sent as quoted data, not instructions; model outputs are structured JSON validated by the portal before use; injected instructions cannot change portal database state; findings are reviewed by a caseworker before acting | Low–Medium |
| R17 | **Personal data sent to AI provider outside the UK** — if the chosen AI provider routes processing outside the UK | Possible / High | If Bedrock is used, confirm the chosen model is processed in eu-west-2 only (not via a cross-region inference profile); Anthropic API direct requires a confirmed zero-retention endpoint and an Article 46 safeguard; `AI_PROVIDER=off` disables all AI features entirely [confirm which provider is used on live server and document the transfer basis] | **Open (confirm before go-live)** |
| R18 | **Over-reliance** — caseworkers defer to the AI without applying professional judgement | Possible / High | UI labels verdicts as "AI suggestion — you must verify"; caseworker must click "Agree" or "Disagree" explicitly; disagreement is recorded and visible to admins; training material for caseworkers to treat AI as a first-pass tool only [to be produced before go-live] | Medium (training required) |

## 6. Actions before launch

- [x] Retention periods set (R7): 6 years after case closure (configurable). Automatic deletion with 30-day admin warning email, early-delete, extend, and legal-hold controls. Privacy notice updated.
- [x] Microsoft 365 Personal kept (R6), accepted as a residual risk. Required safeguards: 2FA and a strong unique password on the Microsoft account, owner-only access, encrypted nightly backups. 2FA confirmed switched on (29 October 2026).
- [x] Privacy notice published at /privacy and linked from the portal sign-in, create-account, reset-password, partner consent, and staff sign-in pages.
- [x] Partner/sponsor information — R10 resolved by direct-invite design with in-portal privacy notice. R14 added and mitigated.
- [x] ICO registration confirmed: Uha Legal Limited, ZC187130 (registered 1 July 2026, renew by 30 June 2027).
- [x] Article 9 condition confirmed: 9(2)(f) legal claims and legal advice (Hamza Tahir).
- [ ] Test a backup restore (R9).
- [ ] Independent security test (see docs/security-review.md).
- [ ] Pilot with 3 real clients and record feedback (section 3).
- [ ] **AI features (R15–R18):** confirm which provider (`bedrock` or `anthropic`) will be used on the live server and document the legal basis for the transfer if outside the UK (R17). Add the AI provider to the processor list in section 2 above.
- [ ] **AI go-live gate:** `AI_PROVIDER` must remain `off` at initial go-live. Before enabling a live AI provider: (a) close R17 — confirm which provider is chosen and that processing stays in the UK, or document the Article 46 transfer basis; (b) run `AI_PROVIDER=<chosen-provider> npm run ai:eval` against the live provider and confirm 0 false MET (requirement wrongly passed) and 0 missed NOT_MET (requirement wrongly passed when it was not met); (c) produce the caseworker briefing required by R18. Do not set `AI_PROVIDER` to a live value until all three conditions are met.
- [ ] Produce a short caseworker briefing on how to use AI features without over-relying on them (R18).
- [ ] If `AI_PROVIDER=off` at launch, note when and how it will be enabled and what DPIA update will be needed.

## 7. Sign-off

| Item | Name / role | Date | Decision |
|---|---|---|---|
| Measures approved | Hamza Tahir, Director | 28 October 2026 | Approved |
| Residual risks accepted (incl. R6) | Hamza Tahir, Director | 28 October 2026 | Accepted, incl. staying on Microsoft 365 Personal (R6) |
| Data-protection advice | Hamza Tahir (lawyer; data protection contact) | 28 October 2026 | Lawful bases and Article 9(2)(f) condition confirmed |
| Review date | Hamza Tahir, Director | Before AI is switched on, and at least every 12 months | — |
