# Backups and restore

## What is backed up, where

| Data | Where it lives | Backup |
|---|---|---|
| Database (clients, cases, statuses, notes, accounts, audit log) | Server (Postgres) | **Nightly 02:30 UK**, encrypted on the server with the owner's public `age` key, saved to **OneDrive → Apps → UHA Legal Client Portal → Backups**. Kept 30 days. |
| Client documents | OneDrive → Apps → UHA Legal Client Portal → Clients | OneDrive's own version history and recycle bin. Not copied by the portal. |
| Files waiting to reach OneDrive | Server, encrypted (`appdata` volume) | Not backed up — they exist for minutes; an alert is sent if they get stuck. |
| Server settings (`/opt/visasteps/.env`) | Server | **Owner's password manager** (deploy guide step 7). |

If a backup fails, or none succeeds for 26 hours, an alert goes to `ALERT_EMAIL`, and `/api/health` shows
`"backup": "late"`. Backups and documents share one OneDrive account, so also keep an occasional backup file
somewhere else (e.g. download one a month to an encrypted USB drive).

## OneDrive recycle bin

OneDrive keeps deleted items in its recycle bin for a period before removing them permanently. Check the recycle bin settings for the Microsoft account to confirm how long items are kept — files deleted under the retention policy may still be recoverable from the recycle bin for some time after deletion. Backups roll off within 30 days.

## Run one now

```bash
ssh uha-portal 'cd /opt/visasteps && docker compose run --rm tools npx tsx scripts/backup.mts'
```

## Restore (test this once before launch, and every 6 months)

You need the private key from the password manager.

```bash
# 1. Download a backup: OneDrive (web) → Apps → UHA Legal Client Portal → Backups → visasteps_DATE.dump.age → Download
brew install age postgresql@16

# 2. Decrypt with the private key (paste it into a file first; delete that file afterwards)
age -d -i ~/uha-portal-backup-key.txt ~/Downloads/visasteps_DATE.dump.age > visasteps.dump

# 3a. Test restore on your Mac (safe — a separate database)
createdb visasteps_restore_test && pg_restore --no-owner -d visasteps_restore_test visasteps.dump
psql -d visasteps_restore_test -c 'select count(*) from "Client";'

# 3b. Real restore on the server (stops the portal; only when the live database is lost or damaged)
scp visasteps.dump uha-portal:/tmp/
ssh uha-portal
cd /opt/visasteps && docker compose stop app backup
docker compose exec -T db psql -U visasteps -d postgres -c 'DROP DATABASE visasteps;' -c 'CREATE DATABASE visasteps OWNER visasteps;'
docker compose exec -T db pg_restore --no-owner -U visasteps -d visasteps < /tmp/visasteps.dump
rm /tmp/visasteps.dump && docker compose start app backup
```

Then delete the decrypted `visasteps.dump` from your Mac.

## Rebuilding the whole server

New droplet (deploy guide steps 3, 5) → put the saved `.env` back → `scripts/deploy.sh` → restore the database
(3b) → update the DNS A record if the IP changed. The OneDrive sign-in is inside the database, so it comes back
with the restore. Documents and older backups stay in OneDrive.
