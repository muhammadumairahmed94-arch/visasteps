# Security review — UHA Legal client portal

Reviewed: 18 October 2026, before first deployment. Scope: the whole codebase in this folder.
Reviewer: Claude (AI assistant). **An independent human review or penetration test is still recommended before
real client data is stored** (see "Before launch" at the end).

## Summary

No critical or high issues remain in the portal's own code. One medium bug was found and fixed during the
review (download names with non-English letters). Two accepted risks are recorded below: the
Content-Security-Policy allows inline scripts, and the Microsoft 365 Personal storage choice.

## What was checked

| Area | How it is protected | Result |
|---|---|---|
| Client sign-in | Email + password (bcrypt, cost 12). Generic error messages. Lock for 15 min after 10 wrong passwords. Rate limit 20 tries / 15 min per connection. | OK |
| Caseworker sign-in | Password + authenticator code (TOTP). A password alone gives only a 10-minute "half" session that opens nothing. Codes cannot be reused. 8 single-use recovery codes, stored hashed. Lock after 10 misses. | OK |
| Sessions | Random 256-bit tokens, only their hash stored. Cookies `HttpOnly`, `Secure` (live), `SameSite=Lax`. Old session ended on sign-in (no fixation). Password change signs out other devices. Removed staff lose access immediately. | OK |
| Emailed links | Random 256-bit, hashed, single use, expire (create account 7 days, reset 1 hour, staff 7 days). `Referrer-Policy: no-referrer` so links do not leak. | OK |
| Who can see what | Every query is limited to the firm; clients only to their own case; caseworkers to their own clients; admins to the firm. Tested end to end (browser test 3: a client cannot upload to, read or open another client's documents; client sessions get 401 on all staff routes). | OK |
| Forged requests (CSRF) | Every non-GET API request must come from the portal's own origin; cookies are `SameSite=Lax`. Scheduled-task endpoints need a secret bearer token. | OK |
| Uploads | Size limit 20 MB per file; real type checked from file content (not the name); only PDF/JPG/PNG/HEIC accepted; images converted to PDF; every file virus-scanned by ClamAV before saving — if the scanner is down, uploads are refused. | OK |
| Stored files | Saved only in the firm's OneDrive app folder. If Microsoft is unreachable, kept **encrypted** (AES-256-GCM) on the server until saved, then deleted. Never overwritten; redone files kept in `_Old versions`. | OK |
| Secrets at rest | 2FA secrets and the OneDrive sign-in are encrypted with `AUTH_SECRET` (AES-256-GCM). Passwords hashed (bcrypt). Server secrets live only in the server's `.env`. | OK |
| Web page attacks (XSS) | React escapes all text. The only raw HTML is the 2FA QR code, generated on the server. Emails escape all text. | OK (see accepted risk 1) |
| Security headers | HSTS (2 years), `X-Frame-Options: DENY`, `frame-ancestors 'none'`, `nosniff`, `no-referrer`, restrictive Permissions-Policy. API responses: `default-src 'none'`. | OK |
| Rate limiting | Database-backed (works across servers): sign-in, password reset, emailed links, uploads, new clients. | OK |
| Audit trail | Sign-ins (and failures), sign-outs, views, uploads, files opened, approvals, redos, invites, resets, admin changes, reminders, backups. Caseworkers see an Activity list per client. | OK |
| Email | Real mail never sent to reserved test domains. Alerts contain no client documents or personal details. | OK |
| Server | Only ports 80/443 (and SSH) open; HTTPS certificate automatic (Caddy); database and virus scanner not reachable from the internet; automatic security updates (deploy guide). | OK |

## Fixed during this review

- **Downloads with non-English surnames crashed (medium).** Stored names start with the client's surname, which may
  be in any script. The download header now carries an ASCII fallback plus the UTF-8 name. Covered by a test.

## Accepted risks (owner's decision)

1. **Content-Security-Policy allows inline scripts.** A nonce-based policy was built and tested but blocked the
   portal's own scripts (Next.js "Cache Components" pre-renders part of each page without the nonce). Mitigation:
   no user-written HTML is ever rendered; React escapes content. Revisit when Next.js supports nonces with
   Cache Components, or by turning Cache Components off.
2. **Microsoft 365 Personal for client documents.** Licensed for personal use; data location not guaranteed UK;
   files tied to one person's account. Chosen by the owner for now; recorded in the DPIA. Switching to
   Microsoft 365 Business (SharePoint) is already built — one setup command.

## Dependencies (`npm audit`)

8 "high" advisories, all in **developer/build tools only** (ESLint config → `braces`/`micromatch`; Prisma CLI
config loader → `deepmerge-ts`). Each is a denial-of-service on crafted input to that tool. None of these packages
are in the live portal image (the runner image contains only the traced server files). Fixes need major upgrades
(Prisma 7, a different ESLint config) — schedule after launch and re-run `npm audit`.

## Before launch

- [ ] Independent review or penetration test by a person (recommended for a law firm holding passports).
- [ ] Re-run `npm audit` and `npm run test:e2e` on the final version.
- [ ] Confirm `AUTH_SECRET`, `POSTGRES_PASSWORD`, `CRON_SECRET` on the server are long random values and stored in a password manager.
- [ ] Change the Hostinger mailbox password that appeared in a chat transcript; revoke the Hostinger API token shared earlier.
