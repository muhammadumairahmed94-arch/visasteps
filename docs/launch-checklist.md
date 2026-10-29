# Launch checklist — before the first real client

Work down the list; tick each item. Detail is in the linked documents.

## Server (docs/deploy.md)
- [ ] DigitalOcean account with 2FA; droplet in **London**; monitoring on
- [ ] DNS: `portal` A record at Hostinger → server IP; https://portal.uhalegal.com loads with a padlock
- [ ] `/opt/visasteps/.env` created from `deploy/production.env.example`, `chmod 600`, saved in the password manager

### `.env` variables — fill in before `docker compose up`

`DATABASE_URL` is built automatically by Docker Compose from `POSTGRES_PASSWORD` — do not set it manually.

| Variable | What to set | Safe default? |
|---|---|---|
| `DOMAIN` | `portal.uhalegal.com` (used by Caddy for HTTPS) | No — required |
| `APP_URL` | `https://portal.uhalegal.com` (used in every emailed link) | No — required |
| `AUTH_SECRET` | `openssl rand -hex 32` — **never change after go-live** | No — required |
| `POSTGRES_PASSWORD` | Strong random value; Docker builds `DATABASE_URL` from it | No — required |
| `CRON_SECRET` | `openssl rand -hex 32` — bearer token for scheduled endpoints | No — required |
| `ALERT_EMAIL` | e.g. `info@uhalegal.com` — where server-error emails go | No — required |
| `BACKUP_AGE_RECIPIENT` | Public key from `age-keygen` (`age1…`); private key in password manager only | No — required |
| `GRAPH_CLIENT_ID` | From the Microsoft App registration; set by `npm run setup:onedrive` | No — required |
| `EMAIL_PROVIDER` | `relay` (default for DigitalOcean — uses the website relay); `smtp` if port 465 is unblocked | Defaults `fake` — must set |
| `EMAIL_RELAY_SECRET` | Must match `PORTAL_RELAY_SECRET` on Vercel (relay mode only) | No — required if `relay` |
| `SMTP_PASS` | Hostinger mailbox password (SMTP mode only) | No — required if `smtp` |
| `EMAIL_FROM` | e.g. `UHA Legal <portal@uhalegal.com>` (SMTP mode only) | No — required if `smtp` |
| `EMAIL_REPLY_TO` | e.g. `info@uhalegal.com` — optional reply-to shown to clients | No default — set if wanted |
| `SMS_PROVIDER` | `off` — text messages are disabled | Defaults `off` ✓ |
| `STORAGE_PROVIDER` | `onedrive` — set automatically by `npm run setup:onedrive` | Defaults `fake` — must set |
| `VIRUS_SCAN` | `clamav` — Docker starts the scanner | Defaults `clamav` ✓ |
| `AI_PROVIDER` | `off` — leave off until DPIA R17 is resolved (see AI features below) | Defaults `off` ✓ |
| `AWS_ACCESS_KEY_ID` | IAM key with only `bedrock:InvokeModel` permission (Bedrock only; DigitalOcean has no instance role) | No — required if `bedrock` |
| `AWS_SECRET_ACCESS_KEY` | Matching IAM secret (Bedrock only) | No — required if `bedrock` |
| `AI_MODEL_ID` | e.g. `anthropic.claude-sonnet-4-5-20251001-v1:0` (Bedrock) or `claude-sonnet-4-6` (Anthropic) | No — required if AI on |
| `ANTHROPIC_API_KEY` | Anthropic API key with zero-data-retention endpoint (Anthropic only) | No — required if `anthropic` |

Variables with safe production defaults not listed above: `SMTP_HOST` (smtp.hostinger.com), `SMTP_PORT` (465), `SMTP_USER` (portal@uhalegal.com), `AWS_BEDROCK_REGION` (eu-west-2), `CLAMAV_HOST` (127.0.0.1), `CLAMAV_PORT` (3310).

- [ ] `init:production`, `admin:create`, `setup:onedrive`, `email:test` all done
- [ ] Admin signs in at /staff and sets up the authenticator app; recovery codes saved
- [ ] https://portal.uhalegal.com/api/health shows `"ok":true` with database, virusScanner, oneDrive all `ok`

## Backups and monitoring (docs/backup-restore.md)
- [ ] First backup visible in OneDrive → Apps → UHA Legal Client Portal → Backups (run one by hand after deploying)
- [ ] **Test restore** on the Mac succeeds (counts match)
- [ ] Private backup key stored in the password manager — and only there
- [ ] UptimeRobot keyword monitor on /api/health → info@uhalegal.com
- [ ] `ALERT_EMAIL` set; a test alert received (e.g. stop the scanner briefly: `docker compose stop clamav`, try an upload, then `docker compose start clamav`)

## Security (docs/security-review.md)
- [ ] Change the Hostinger mailbox password that appeared in a chat transcript; re-run `setup:email` with the new one
- [ ] Revoke the Hostinger API token shared earlier
- [ ] Microsoft account (info@uhalegal.com) has a strong password and two-step verification
- [ ] Independent review / penetration test (recommended)
- [ ] `npm audit`, `npm test`, `npm run test:e2e` pass on the version being deployed

## AI features
- [ ] Decide which AI provider to use (`bedrock`, `anthropic`, or leave `off`); set `AI_PROVIDER` in `/opt/visasteps/.env`
- [ ] If `bedrock`: set `AWS_BEDROCK_REGION=eu-west-2`, `AI_MODEL_ID`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`; confirm the IAM user has only `bedrock:InvokeModel` permission on the chosen model; confirm the model is processed in eu-west-2 only (not via a cross-region inference profile — see DPIA R17)
- [ ] If `anthropic`: set `ANTHROPIC_API_KEY`; confirm zero-data-retention endpoint is configured; document Article 46 transfer safeguard in DPIA
- [ ] DPIA R17 resolved and signed off for whichever provider is chosen
- [ ] Run `AI_PROVIDER=<chosen-provider> npm run ai:eval` against the **live provider** and confirm 0 false MET and 0 missed NOT_MET — this is a go-live gate; do not enable AI until it passes
- [ ] Run a manual end-to-end AI test: upload a test PDF, run a guidance check, verify the caseworker review flow
- [ ] Admin firm settings → "AI features" is disabled by default — enable deliberately once caseworkers are briefed
- [ ] Brief caseworkers: AI verdicts are suggestions, not decisions; always review the source documents

## Legal and data protection
- [x] Privacy notice published at /privacy (docs/privacy-notice.md) and linked from sign-in, create-account, reset-password, sponsor consent, and staff sign-in pages
- [x] DPIA completed and signed (docs/dpia.md); R6 accepted, R7 resolved; AI features gated on R17 (see AI features below)
- [ ] Retention periods decided
- [x] ICO registration confirmed: ZC187130, expires 30 June 2027 (renew before then)

## Hand tests — do these on the live server before opening to clients

### Sign-in and account
- [ ] **Sign-in code (OTP):** click "Email me a sign-in code" on the portal home page; receive the email; enter the code; land on the portal; code cannot be reused
- [ ] **Keep me signed in — on:** tick the checkbox on sign-in; close the browser; reopen; still signed in (cookie persists)
- [ ] **Keep me signed in — off:** sign in without the checkbox; close the browser; reopen; redirected to sign-in (session cookie gone)

### Upload
- [ ] **Camera scan on a real phone (iPhone and Android):** tap the scan / camera button; take a photo; quality badge appears if resolution is too low; tap "Send anyway" or retake; file arrives in OneDrive
- [ ] **Multi-page scan:** scan 2 separate pages in one upload session; confirm both appear as a single PDF; caseworker sees "2 pages" in the file viewer
- [ ] **"I can't find this document":** client clicks the flag on a document; caseworker sees the flag in the client view; caseworker replies with a note; client receives the email notification and can see the caseworker's reply

### Messaging
- [ ] **Messages both ways:** client sends a message; caseworker sees the unread count badge; caseworker replies; client sees the reply and the badge clears; email notification contains no message text — only a portal link

### Case and timeline
- [ ] **Case stage timeline:** caseworker advances the stage to "Lawyer checking"; client opens the Visa tab and sees the correct stage highlighted; stage labels are readable at 375 px width (check on a real phone)

### Partner / sponsor
- [ ] **Sponsor invite and isolation:** caseworker invites a sponsor; sponsor creates an account; sponsor sees only the SPONSOR-assigned documents — no access to the main client's other documents; main client cannot see sponsor uploads until the caseworker explicitly enables cross-party visibility

### Reminders
- [ ] **Reminders time gate:** confirm no reminder email is sent before 09:00 or after 19:00 UK time; trigger a reminder manually (seed a "missing document" case, wait or advance the clock) and check the delivery time

### Admin
- [ ] **Guidance upload:** admin uploads a PDF guidance source via Admin → Guidance; marks it reviewed; caseworker can view it but cannot upload, review or supersede (gets 403); superseded source is hidden from caseworkers

### Backups
- [ ] **Full restore to test database:** follow docs/backup-restore.md step by step; restore the latest backup to `visasteps_test`; count of clients, documents and audit entries matches the live database; admin can sign in on the restored copy

## Pilot with 3 real clients
- [ ] Caseworkers added from Admin → Team; each has signed in with 2FA
- [ ] Invite 3 friendly clients (ideally one on an iPhone, one on Android, one on a computer)
- [ ] Each creates an account and uploads every document **without help** — note where they hesitated
- [ ] Files appear in OneDrive → Apps → UHA Legal Client Portal → Clients, correctly named, within a minute
- [ ] Approve one document and ask for one redo per client; clients receive the emails
- [ ] Fix any wording or flow problems found, then open to all clients
