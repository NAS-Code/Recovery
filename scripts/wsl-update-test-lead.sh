#!/usr/bin/env bash
# Update one of the seeded leads to point at the user's real phone for SMS
# round-trip testing. Reads phone from testPhone.txt, env from
# .env.vercel.production. Neither is echoed.
set -euo pipefail

SRC=/mnt/c/Users/n1sar/VDX
ENV_SRC="$SRC/.env.vercel.production"
PHONE_FILE=/mnt/c/Users/n1sar/vdxCreds/testPhone.txt
DEST=/root/vdx
LEAD_NAME="${1:-Alice Johnson}"

if [ ! -f "$ENV_SRC" ]; then
  echo "ERROR: $ENV_SRC missing"
  exit 1
fi
if [ ! -f "$PHONE_FILE" ]; then
  echo "ERROR: $PHONE_FILE missing"
  exit 1
fi

cp "$ENV_SRC" "$DEST/.env"
chmod 600 "$DEST/.env"

export PHONE_TO_SET=$(head -1 "$PHONE_FILE" | tr -d '[:space:]\r\n')
export LEAD_NAME

cd "$DEST"

node --input-type=module -e "
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });
const lead = await prisma.lead.findFirst({ where: { name: process.env.LEAD_NAME } });
if (!lead) { console.error('lead_not_found'); process.exit(1); }
const updated = await prisma.lead.update({
  where: { id: lead.id },
  data: { phone: process.env.PHONE_TO_SET }
});
console.log(JSON.stringify({ id: updated.id, name: updated.name, status: updated.status, phoneUpdated: true }));
await prisma.\$disconnect();
"

# Wipe traces of the env file in /root/vdx (keep windows-side for cleanup elsewhere)
rm -f "$DEST/.env"
