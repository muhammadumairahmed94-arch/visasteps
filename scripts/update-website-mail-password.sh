#!/bin/bash
# Fix the website's (and portal relay's) Hostinger login on Vercel.
# Asks for the info@uhalegal.com password (hidden), checks it with Hostinger, then stores it on Vercel and redeploys.
set -euo pipefail
SITE=/Users/muhammadumairahmed/Documents/uhalegal-com
USER_ADDR="info@uhalegal.com"
cd "$(dirname "$0")/.."

read -r -s -p "Current password for $USER_ADDR (hidden): " PASS; echo
[ -n "$PASS" ] || { echo "Nothing entered. Nothing changed."; exit 1; }

echo "Checking with Hostinger…"
SMTP_PASS_CHECK="$PASS" node -e '
const nodemailer = require("nodemailer");
nodemailer.createTransport({ host: "smtp.hostinger.com", port: 465, secure: true, auth: { user: "info@uhalegal.com", pass: process.env.SMTP_PASS_CHECK } })
  .verify().then(() => console.log("  ✓ Hostinger accepted the password"), (e) => { console.error("  ✗ Hostinger refused it: " + e.message + "\nNothing changed. Check the password in hPanel → Emails → info@uhalegal.com."); process.exit(1); });'

cd "$SITE"
echo "Saving to Vercel…"
vercel env rm SMTP_USER production -y >/dev/null 2>&1 || true
printf '%s' "$USER_ADDR" | vercel env add SMTP_USER production >/dev/null
vercel env rm SMTP_PASS production -y >/dev/null 2>&1 || true
printf '%s' "$PASS" | vercel env add SMTP_PASS production --sensitive >/dev/null
unset PASS
echo "  ✓ Saved"
echo "Redeploying the website (about a minute)…"
vercel deploy --prod --yes >/dev/null
echo "Done. The contact form and portal emails now use the new password."
