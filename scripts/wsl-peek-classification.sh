#!/usr/bin/env bash
# Read the latest claude_classification on Alice Johnson's conversation,
# without echoing the env file.
set -euo pipefail

SRC=/mnt/c/Users/n1sar/VDX
ENV_SRC="$SRC/.env.vercel.production"
DEST=/root/vdx

if [ ! -f "$ENV_SRC" ]; then
  echo "ERROR: $ENV_SRC missing — run vercel env pull first"
  exit 1
fi

cp "$ENV_SRC" "$DEST/.env"
chmod 600 "$DEST/.env"

cd "$DEST"

node --input-type=module -e "
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });
const alice = await prisma.lead.findFirst({ where: { name: 'Alice Johnson' } });
const messages = await prisma.conversation.findMany({
  where: { leadId: alice.id },
  orderBy: { timestamp: 'asc' }
});
for (const m of messages) {
  console.log(JSON.stringify({
    direction: m.direction,
    text: m.text,
    classification: m.claudeClassification
  }, null, 2));
}
console.log('---');
console.log(JSON.stringify({ status: alice.status, scheduledMeetingTime: alice.scheduledMeetingTime }));
await prisma.\$disconnect();
"

rm -f "$DEST/.env"
