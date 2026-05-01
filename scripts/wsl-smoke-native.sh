#!/usr/bin/env bash
set -euo pipefail

SRC=/mnt/c/Users/n1sar/VDX
DEST=/root/vdx

echo "=== copying source to native fs (excluding node_modules) ==="
rm -rf "$DEST"
mkdir -p "$DEST"
rsync -a --exclude=node_modules --exclude=.next --exclude=.git --exclude=package-lock.json "$SRC/" "$DEST/"

cd "$DEST"

echo "=== npm install (native fs) ==="
time npm install --silent --no-fund --no-audit 2>&1 | tail -3

echo "=== prisma generate ==="
npx prisma generate 2>&1 | tail -3

echo "=== prisma db push ==="
npx prisma db push --skip-generate --accept-data-loss 2>&1 | tail -3

echo "=== seed ==="
npm run db:seed 2>&1 | tail -3

echo "=== tests ==="
time npm test 2>&1 | tail -10

echo "=== typecheck ==="
time npm run typecheck 2>&1 | tail -5

echo "=== ALL GREEN ==="
