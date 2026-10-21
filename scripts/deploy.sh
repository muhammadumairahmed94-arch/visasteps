#!/bin/bash
# Build the portal on this Mac and start it on the server. Usage: scripts/deploy.sh [uha-portal]
# The server (2 GB) is too small to build, so images are built here for Intel/AMD, copied over, and started.
# Never copies local settings or files: the server keeps its own /opt/visasteps/.env.
set -euo pipefail
TARGET="${1:-uha-portal}"
cd "$(dirname "$0")/.."

echo "== Checks"
npx tsc --noEmit
npm test --silent

echo "== Docker on this Mac"
colima status >/dev/null 2>&1 || colima start --cpu 4 --memory 6 --disk 40

echo "== Building images for the server (Intel/AMD) — first time ~10 minutes"
docker buildx build --platform linux/amd64 --target runner -t visasteps-app:latest --load .
docker buildx build --platform linux/amd64 --target tools -t visasteps-tools:latest --load .

echo "== Copying images to $TARGET"
docker save visasteps-app:latest visasteps-tools:latest | gzip -1 | ssh "$TARGET" 'gunzip | docker load'

echo "== Copying configuration"
rsync -az docker-compose.yml "$TARGET:/opt/visasteps/"
rsync -az --delete deploy/ "$TARGET:/opt/visasteps/deploy/"

echo "== Starting"
ssh "$TARGET" 'cd /opt/visasteps && test -f .env || { echo "Missing /opt/visasteps/.env — see docs/deploy.md"; exit 1; } && docker compose up -d --no-build --remove-orphans && docker image prune -f >/dev/null && docker compose ps'
sleep 8
echo "== Health"
ssh "$TARGET" 'cd /opt/visasteps && docker compose exec -T app node -e "fetch(\"http://localhost:3000/api/health\").then(r=>r.text()).then(console.log)"' || true
