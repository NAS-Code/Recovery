#!/usr/bin/env bash
# Switch Alice Johnson's event to Consensus 2026 (Miami), reset her to
# scheduled status, and clear conversation history for a fresh test run.
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

// 1. Find Alice
const alice = await prisma.lead.findFirst({ where: { name: 'Alice Johnson' } });
if (!alice) { console.error('Alice not found'); process.exit(1); }

// 2. Update her event to Consensus 2026 (Miami, May 4–8 2026)
const updatedEvent = await prisma.event.update({
  where: { id: alice.eventId },
  data: {
    name: 'Consensus 2026',
    startDate: new Date('2026-05-04T00:00:00Z'),
    endDate:   new Date('2026-05-08T23:59:59Z'),
    timezone:  'America/New_York'
  }
});
console.log('Event updated:', {
  id: updatedEvent.id,
  name: updatedEvent.name,
  startDate: updatedEvent.startDate.toISOString().slice(0,10),
  endDate: updatedEvent.endDate.toISOString().slice(0,10),
  timezone: updatedEvent.timezone
});

// 3. Clear conversation history
const deleted = await prisma.conversation.deleteMany({ where: { leadId: alice.id } });
console.log('Conversations deleted:', deleted.count);

// 4. Reset Alice to scheduled with a meeting time ~1 hour from now
const meetingTime = new Date(Date.now() + 60 * 60 * 1000);
const updated = await prisma.lead.update({
  where: { id: alice.id },
  data: {
    status: 'scheduled',
    scheduledMeetingTime: meetingTime,
    fdeOwnerSlackId: 'U0AK6M6CJ7J'
  }
});
console.log('Lead reset:', {
  id: updated.id,
  name: updated.name,
  status: updated.status,
  scheduledMeetingTime: updated.scheduledMeetingTime.toISOString()
});

console.log('\\nReady to test! Go to /dashboard and click Mark no-show.');
await prisma.\$disconnect();
"

rm -f "$DEST/.env"
