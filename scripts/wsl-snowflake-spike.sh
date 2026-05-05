#!/usr/bin/env bash
set -euo pipefail
SRC=/mnt/c/Users/n1sar/VDX
DEST=/root/vdx
rsync -a --exclude=node_modules --exclude=.next --exclude=.git --exclude='.env*' --exclude=package-lock.json "$SRC/" "$DEST/"
cd "$DEST"
echo "=== installing snowflake-sdk in WSL node_modules ==="
npm install --silent --no-fund --no-audit snowflake-sdk 2>&1 | tail -3
echo ""
echo "=== running spike ==="
node scripts/snowflake-spike.mjs
