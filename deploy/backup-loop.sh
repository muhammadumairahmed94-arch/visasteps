#!/bin/sh
# Backup service: sleeps (using almost no memory) until 02:30 UK time, runs one backup, repeats.
# A failed run is retried once 30 minutes later; failures are recorded and emailed by scripts/backup.mts.
set -u
echo "Backup service started: nightly at 02:30 UK time"
while true; do
  wait=$(node deploy/next-backup-seconds.js)
  echo "Next backup in $((wait / 60)) minutes"
  sleep "$wait"
  npx tsx scripts/backup.mts || { sleep 1800; npx tsx scripts/backup.mts; }
done
