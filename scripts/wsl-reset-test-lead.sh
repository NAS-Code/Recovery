#!/usr/bin/env bash
# Reset a seeded lead back to status=scheduled with no conversation history,
# so the SMS flow can be tested from the top. Operates against whatever DB
# .env.vercel.production points at.
set -euo pipefail

SRC=/mnt/c/Users/n1sar/VDX
ENV_SRC="$SRC/.env.vercel.production"
DEST=/root/vdx
LEAD_NAME="${1:-Alice Johnson}"

if [ ! -f "$ENV_SRC" ]; then
  echo "ERROR: $ENV_SRC missing — run 'vercel env pull .env.vercel.production --environment=production' first"
  exit 1
fi

cp "$ENV_SRC" "$DEST/.env"
chmod 600 "$DEST/.env"

export LEAD_NAME

cd "$DEST"

node --input-type=module -e "
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });
const lead = await prisma.lead.findFirst({ where: { name: process.env.LEAD_NAME } });
if (!lead) { console.error('lead_not_found'); process.exit(1); }
const deleted = await prisma.conversation.deleteMany({ where: { leadId: lead.id } });
const future = new Date(Date.now() + 60 * 60 * 1000);
const updated = await prisma.lead.update({
  where: { id: lead.id },
  data: { status: 'scheduled', scheduledMeetingTime: future }
});
console.log(JSON.stringify({
  id: updated.id,
  name: updated.name,
  status: updated.status,
  scheduledMeetingTime: updated.scheduledMeetingTime,
  conversationsDeleted: deleted.count
}, null, 2));
await prisma.\$disconnect();
"

rm -f "$DEST/.env"
