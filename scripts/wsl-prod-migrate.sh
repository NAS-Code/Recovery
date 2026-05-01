#!/usr/bin/env bash
# Apply migrations + seed to the production Neon database without exposing
# the connection string. The .env file is copied directly from the
# Vercel-pulled env file to /root/vdx/.env, and the script reads from there.
set -euo pipefail

SRC=/mnt/c/Users/n1sar/VDX
DEST=/root/vdx
ENV_SRC="$SRC/.env.vercel.production"

if [ ! -f "$ENV_SRC" ]; then
  echo "ERROR: $ENV_SRC missing — run 'vercel env pull .env.vercel.production --environment=production' first"
  exit 1
fi

echo "=== sync sources (no .env, no node_modules) ==="
rsync -a --exclude=node_modules --exclude=.next --exclude=.git --exclude='.env*' --exclude=package-lock.json "$SRC/" "$DEST/"

echo "=== install neon env into /root/vdx/.env ==="
cp "$ENV_SRC" "$DEST/.env"
chmod 600 "$DEST/.env"

cd "$DEST"

echo "=== prisma generate (using neon driver adapter) ==="
npx prisma generate 2>&1 | tail -3

echo "=== apply migrations to neon ==="
npx prisma migrate deploy 2>&1 | tail -10

echo "=== seed neon ==="
npm run db:seed 2>&1 | tail -3

echo "=== verify seeded data ==="
node --input-type=module -e "
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });
const counts = {
  clients: await prisma.client.count(),
  events: await prisma.event.count(),
  leads: await prisma.lead.count(),
  conversations: await prisma.conversation.count()
};
console.log(JSON.stringify(counts));
await prisma.\$disconnect();
"

echo "=== ALL GREEN ==="
