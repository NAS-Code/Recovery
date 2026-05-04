#!/usr/bin/env bash
# Apply the manually-authored migration to Neon and patch existing events
# with realistic timezones.
set -euo pipefail

SRC=/mnt/c/Users/n1sar/VDX
ENV_SRC="$SRC/.env.vercel.production"
DEST=/root/vdx

if [ ! -f "$ENV_SRC" ]; then
  echo "ERROR: $ENV_SRC missing"
  exit 1
fi

rsync -a --exclude=node_modules --exclude=.next --exclude=.git --exclude='.env*' --exclude=package-lock.json "$SRC/" "$DEST/"

cp "$ENV_SRC" "$DEST/.env"
chmod 600 "$DEST/.env"

cd "$DEST"

echo "=== prisma migrate deploy → Neon ==="
npx prisma migrate deploy 2>&1 | tail -10

echo ""
echo "=== prisma generate (refresh client types post-schema change) ==="
npx prisma generate 2>&1 | tail -3

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
