#!/usr/bin/env bash
set -euo pipefail
SRC=/mnt/c/Users/n1sar/VDX
DEST=/root/vdx
rsync -a --exclude=node_modules --exclude=.next --exclude=.git --exclude=package-lock.json "$SRC/" "$DEST/"
cd "$DEST"
echo "=== typecheck ==="
npm run typecheck 2>&1 | tail -10
echo "=== tests ==="
npm test 2>&1 | tail -8
