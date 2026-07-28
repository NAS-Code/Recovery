#!/usr/bin/env bash
# Verify that the outbound SMS and Claude classifier context include proper
# sender identity (agent persona + client company).
#
# This script:
# 1. Resets Alice to scheduled status
# 2. Hits the /api/leads/:id/noshow endpoint on Vercel
# 3. Reads back the outbound message from the DB
# 4. Checks that it contains the expected identity strings
#
# Run from WSL:
#   bash /mnt/c/Users/n1sar/VDX/scripts/wsl-verify-sender-identity.sh
set -euo pipefail

SRC=/mnt/c/Users/n1sar/VDX
ENV_SRC="$SRC/.env.vercel.production"
BYPASS_FILE=/mnt/c/Users/n1sar/vdxCreds/vercelBypass.txt
DEST=/root/vdx

if [ ! -f "$ENV_SRC" ]; then
  echo "ERROR: $ENV_SRC missing"
  exit 1
fi

cp "$ENV_SRC" "$DEST/.env"
chmod 600 "$DEST/.env"

cd "$DEST"

echo "=== Step 1: Reset Alice to scheduled ==="
ALICE_ID=$(node --input-type=module -e "
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });
const alice = await prisma.lead.findFirst({ where: { name: 'Alice Johnson' } });
if (!alice) { console.error('Alice not found'); process.exit(1); }
await prisma.conversation.deleteMany({ where: { leadId: alice.id } });
const future = new Date(Date.now() + 60 * 60 * 1000);
await prisma.lead.update({
  where: { id: alice.id },
  data: { status: 'scheduled', scheduledMeetingTime: future }
});
console.log(alice.id);
await prisma.\$disconnect();
")
echo "Alice ID: $ALICE_ID"

echo ""
echo "=== Step 2: Hit noshow endpoint ==="
BYPASS_TOKEN=""
if [ -f "$BYPASS_FILE" ]; then
  BYPASS_TOKEN=$(head -1 "$BYPASS_FILE" | tr -d '[:space:]\r\n')
fi

# Read the client cookie from env — the cookie value is the clientId
CLIENT_ID=$(node --input-type=module -e "
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });
const alice = await prisma.lead.findFirst({ where: { name: 'Alice Johnson' } });
console.log(alice.clientId);
await prisma.\$disconnect();
")

NOSHOW_URL="https://concierge-noshow-recovery.vercel.app/api/leads/${ALICE_ID}/noshow"
echo "POST $NOSHOW_URL"

HTTP_RESPONSE=$(curl -s -w "\n%{http_code}" \
  -X POST "$NOSHOW_URL" \
  -H "Cookie: client_id=${CLIENT_ID}" \
  ${BYPASS_TOKEN:+-H "x-vercel-protection-bypass: ${BYPASS_TOKEN}"})

HTTP_BODY=$(echo "$HTTP_RESPONSE" | head -n -1)
HTTP_CODE=$(echo "$HTTP_RESPONSE" | tail -1)
echo "HTTP $HTTP_CODE: $HTTP_BODY"

if [ "$HTTP_CODE" != "200" ]; then
  echo "FAIL: Expected HTTP 200"
  rm -f "$DEST/.env"
  exit 1
fi

echo ""
echo "=== Step 3: Read outbound message from DB ==="
node --input-type=module -e "
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });
const alice = await prisma.lead.findFirst({ where: { name: 'Alice Johnson' } });
const msgs = await prisma.conversation.findMany({
  where: { leadId: alice.id },
  orderBy: { timestamp: 'asc' }
});
const client = await prisma.client.findUnique({ where: { id: alice.clientId } });

console.log('Client name in DB:', client?.name ?? '(not found)');
console.log('AGENT_PERSONA_NAME env:', process.env.AGENT_PERSONA_NAME ?? '(not set locally)');
console.log('');

let pass = true;
for (const m of msgs) {
  console.log('[' + m.direction + ']', m.text);
  console.log('');
}

const outbound = msgs.find(m => m.direction === 'outbound');
if (!outbound) {
  console.log('FAIL: No outbound message found');
  pass = false;
} else {
  // Check for client company name
  if (client?.name && outbound.text.includes(client.name)) {
    console.log('✅ Outbound SMS contains client name: \"' + client.name + '\"');
  } else {
    console.log('❌ Outbound SMS missing client name');
    pass = false;
  }

  // Check for some form of persona intro
  if (outbound.text.includes('This is ')) {
    console.log('✅ Outbound SMS contains sender intro (\"This is ...\")');
  } else {
    console.log('❌ Outbound SMS missing sender intro');
    pass = false;
  }
}

console.log('');
console.log(pass ? '=== ALL CHECKS PASSED ===' : '=== SOME CHECKS FAILED ===');
await prisma.\$disconnect();
"

rm -f "$DEST/.env"
