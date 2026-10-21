# Putting the portal online — DigitalOcean (London) + portal.uhalegal.com

About 1 hour the first time. Cost: **$12/month** (2 GB server). Backups go to OneDrive at no extra cost.

What you will have: one server in London running the portal, its database, the virus scanner (tuned for low
memory), HTTPS, and nightly encrypted backups to OneDrive. The portal is **built on your Mac** and copied over —
the server is too small to build it. Website and email at Hostinger are not touched.

Keep a **password manager** entry called "UHA portal server" and save into it everything marked 🔑 below.

---

## 1. DigitalOcean account

1. Sign up at **https://www.digitalocean.com** (card needed). Turn on two-factor sign-in under *My Account → Security*.
2. Create a **Project** called "UHA Legal portal" (environment: Production).

## 2. SSH key (lets your Mac log in to the server)

In Terminal on your Mac (choose a passphrase and keep it in the password manager 🔑):

```bash
ssh-keygen -t ed25519 -f ~/.ssh/uha_portal -C "uha-portal"
ssh-add --apple-use-keychain ~/.ssh/uha_portal
cat ~/.ssh/uha_portal.pub
```

Copy the line it prints. In DigitalOcean: *Settings → Security → SSH keys → Add SSH key*, paste, name it "Mac".

## 3. Create the server (droplet)

*Create → Droplets*:
- Region: **London (LON1)**
- Image: **Ubuntu 24.04 (LTS) x64**
- Size: **Basic → Regular → 2 GB RAM / 1 CPU / 50 GB** ($12/mo)
- Authentication: **SSH key** → tick "Mac"
- Enable **Monitoring** (free) — leave Backups off (the portal makes its own)
- Hostname: `uha-portal`

Copy the server's **IP address**. 🔑 Then add a shortcut on the Mac — append to `~/.ssh/config`:

```
Host uha-portal
  HostName SERVER_IP
  User root
  IdentityFile ~/.ssh/uha_portal
  IdentitiesOnly yes
  UseKeychain yes
  AddKeysToAgent yes
```

Test: `ssh uha-portal hostname` prints the server's name.

## 4. Point portal.uhalegal.com at the server (Hostinger)

hPanel → **Domains → uhalegal.com → DNS / Nameservers → DNS records → Add record**:
Type **A**, Name **portal**, Points to **the server IP**, TTL 3600 → **Add**.
Only this one record — do not change MX or other records (that would break email).

## 5. Prepare the server (once)

```bash
cd ~/Projects/visasteps
ssh uha-portal 'bash -s' < deploy/bootstrap.sh
```

Installs updates (and automatic security updates), a firewall that only allows SSH and the web, key-only SSH,
4 GB of swap memory, and Docker.

## 6. The backup key

Backups are encrypted on the server with your **public** key and saved to OneDrive. On your Mac:

```bash
brew install age
age-keygen -o ~/uha-portal-backup-key.txt
```

It prints `Public key: age1…` — that goes on the server. The **file** is the private key: save its contents
in the password manager 🔑, then delete the file. **Without it, backups cannot be opened — by anyone.**

## 7. Production settings on the server

Make three random secrets on your Mac (save each in the password manager 🔑):

```bash
for n in AUTH_SECRET POSTGRES_PASSWORD CRON_SECRET; do echo "$n=\"$(openssl rand -hex 32)\""; done
```

Then:

```bash
ssh uha-portal
nano /opt/visasteps/.env
```

Paste the contents of `deploy/production.env.example` and fill in every empty value: the three secrets,
`SMTP_PASS` (the portal@uhalegal.com mailbox password) and the `age1…` public key.
Save (Ctrl+O, Enter, Ctrl+X), then `chmod 600 /opt/visasteps/.env` and `exit`.
Save the whole file in the password manager too 🔑.

## 8. Deploy

On your Mac:

```bash
cd ~/Projects/visasteps && scripts/deploy.sh
```

It checks the code, builds the portal for the server on your Mac (first time ~10–15 minutes; Docker runs via
Colima), copies it over and starts everything. The virus scanner needs a few more minutes to load its database.
HTTPS starts automatically once the DNS record from step 4 is live.

## 9. First run: firm, admin, OneDrive, first backup

```bash
ssh uha-portal
cd /opt/visasteps
docker compose run --rm tools npm run init:production    # firm + all visa checklists (safe to re-run)
docker compose run --rm tools npm run admin:create       # your admin login (info@uhalegal.com)
docker compose run --rm tools npm run setup:onedrive     # P → client ID → sign in at microsoft.com/link
docker compose run --rm tools npm run email:test         # test email to portal@uhalegal.com
docker compose run --rm tools npx tsx scripts/backup.mts # first backup (check OneDrive → Apps → … → Backups)
docker compose restart app backup
```

Open **https://portal.uhalegal.com/staff**, sign in as the admin and set up the authenticator app.

## Email on DigitalOcean

DigitalOcean blocks outgoing mail ports on new accounts, so the live portal sends email **through the website**:
it signs each message and posts it to `https://www.uhalegal.com/api/portal-mail`, which sends it through Hostinger
as info@uhalegal.com (`src/app/api/portal-mail/route.ts` in the website repo, running in London).

- The shared secret is `EMAIL_RELAY_SECRET` on the server and `PORTAL_RELAY_SECRET` on Vercel (production). They must match.
- If the info@uhalegal.com password changes, run `scripts/update-website-mail-password.sh` on the Mac — this also
  keeps the website's contact form working.
- If DigitalOcean ever unblocks port 465, set `EMAIL_PROVIDER="smtp"` in the server `.env` and restart.

## 10. Monitoring (free)

**UptimeRobot** (https://uptimerobot.com): *Add New Monitor* → **Keyword**,
URL `https://portal.uhalegal.com/api/health`, keyword `"ok":true`, every 5 minutes, alert **info@uhalegal.com**.

The portal itself emails **info@uhalegal.com** (`ALERT_EMAIL`) about server errors, OneDrive needing a new
sign-in, files that could not be saved, the virus scanner being down, and failed or missing backups.

## Day to day

| Task | Command |
|---|---|
| Deploy a new version | `scripts/deploy.sh` (from the Mac) |
| See what is running | `ssh uha-portal 'cd /opt/visasteps && docker compose ps'` |
| Portal logs | `ssh uha-portal 'cd /opt/visasteps && docker compose logs --tail=200 app'` |
| Memory use | `ssh uha-portal 'free -h; docker stats --no-stream'` |
| Health | `https://portal.uhalegal.com/api/health` |
| OneDrive sign-in expired | `docker compose run --rm tools npm run setup:onedrive` (on the server) |
| Lost admin access | `docker compose run --rm tools npm run admin:create` (resets password and 2FA) |
| Update the standard checklists (after a code change) | `docker compose run --rm tools npm run checklists:sync` to preview, then add `-- --apply` |
| Restore a backup | `docs/backup-restore.md` |

Never run `npm run db:seed` on the server — it is for demo data and refuses to run there.
