#!/usr/bin/env bash
# Generate the new migration locally, then apply to Neon and patch existing
# event rows to use realistic timezones. Reads prod env from
# .env.vercel.production without echoing.
set -euo pipefail

SRC=/mnt/c/Users/n1sar/VDX
ENV_SRC="$SRC/.env.vercel.production"
DEST=/root/vdx

if [ ! -f "$ENV_SRC" ]; then
  echo "ERROR: $ENV_SRC missing"
  exit 1
fi

echo "=== sync sources ==="
rsync -a --exclude=node_modules --exclude=.next --exclude=.git --exclude='.env*' --exclude=package-lock.json "$SRC/" "$DEST/"

cd "$DEST"

echo "=== prisma migrate dev (generates migration against local WSL Postgres) ==="
service postgresql status >/dev/null 2>&1 || service postgresql start >/dev/null
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/noshow_recovery" \
  npx prisma migrate dev --name add_event_timezone --skip-seed 2>&1 | tail -10

echo ""
echo "=== copy generated migration back to repo ==="
rsync -a --delete "$DEST/prisma/migrations/" "$SRC/prisma/migrations/"

echo ""
echo "=== install neon env, apply migration to Neon ==="
cp "$ENV_SRC" "$DEST/.env"
chmod 600 "$DEST/.env"

npx prisma migrate deploy 2>&1 | tail -10

echo ""
echo "=== patch existing events with realistic timezones ==="
node --input-type=module -e "
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });
const updates = [
  { name: 'SaaStr Annual 2026', tz: 'America/Los_Angeles' },
  { name: 'DevSummit 2026', tz: 'America/New_York' }
];
for (const u of updates) {
  const r = await prisma.event.updateMany({
    where: { name: u.name },
    data: { timezone: u.tz }
  });
  console.log(JSON.stringify({ event: u.name, timezone: u.tz, updated: r.count }));
}
await prisma.\$disconnect();
"

rm -f "$DEST/.env"
echo "=== DONE ==="
