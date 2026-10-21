# Launch checklist — before the first real client

Work down the list; tick each item. Detail is in the linked documents.

## Server (docs/deploy.md)
- [ ] DigitalOcean account with 2FA; droplet in **London**; monitoring on
- [ ] DNS: `portal` A record at Hostinger → server IP; https://portal.uhalegal.com loads with a padlock
- [ ] `/opt/visasteps/.env` filled in, `chmod 600`, saved in the password manager
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

## Legal and data protection
- [ ] Privacy notice reviewed by a lawyer and published (docs/privacy-notice-DRAFT.md) — link added to the portal
- [ ] DPIA completed and signed (docs/dpia-DRAFT.md), including the Microsoft 365 Personal decision (risk R6)
- [ ] Retention periods decided
- [ ] ICO registration confirmed

## Pilot with 3 real clients
- [ ] Caseworkers added from Admin → Team; each has signed in with 2FA
- [ ] Invite 3 friendly clients (ideally one on an iPhone, one on Android, one on a computer)
- [ ] Each creates an account and uploads every document **without help** — note where they hesitated
- [ ] Files appear in OneDrive → Apps → UHA Legal Client Portal → Clients, correctly named, within a minute
- [ ] Approve one document and ask for one redo per client; clients receive the emails
- [ ] Fix any wording or flow problems found, then open to all clients
