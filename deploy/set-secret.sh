#!/bin/bash
# Set one setting in /opt/visasteps/.env without it appearing on screen or in shell history.
#   ssh -t uha-portal /opt/visasteps/deploy/set-secret.sh BREVO_API_KEY
set -euo pipefail
NAME="${1:?usage: set-secret.sh NAME}"
ENV=/opt/visasteps/.env
read -r -s -p "Value for $NAME (hidden): " VALUE; echo
[ -n "$VALUE" ] || { echo "Nothing entered. Unchanged."; exit 1; }
TMP=$(mktemp) && chmod 600 "$TMP"
grep -v "^${NAME}=" "$ENV" > "$TMP" || true
printf '%s="%s"\n' "$NAME" "$VALUE" >> "$TMP"
mv "$TMP" "$ENV" && chmod 600 "$ENV"
echo "Saved $NAME (${#VALUE} characters)."
