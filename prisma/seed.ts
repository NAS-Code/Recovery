import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, LeadStatus, MessageDirection } from "@prisma/client";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

async function main() {
  await prisma.conversation.deleteMany();
  await prisma.lead.deleteMany();
  await prisma.event.deleteMany();
  await prisma.client.deleteMany();

  const [client, otherClient] = await Promise.all([
    prisma.client.create({ data: { name: "Acme Corp" } }),
    prisma.client.create({ data: { name: "Globex Industries" } })
  ]);

  const now = new Date();
  const startDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const endDate = new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000);

  const event = await prisma.event.create({
    data: {
      name: "SaaStr Annual 2026",
      startDate,
      endDate,
      clientId: client.id
    }
  });

  const meetingAt = new Date(now.getTime() - 30 * 60 * 1000);

  const leads = await Promise.all([
    prisma.lead.create({
      data: {
        name: "Alice Johnson",
        phone: "+15555550101",
        email: "alice@target.example",
        company: "Target Industries",
        clientId: client.id,
        eventId: event.id,
        nativeSchedulingLink: "https://cal.example/acme/alice",
        fdeOwnerSlackId: "U01ABCDEF",
        status: LeadStatus.scheduled,
        scheduledMeetingTime: new Date(now.getTime() + 60 * 60 * 1000)
      }
    }),
    prisma.lead.create({
      data: {
        name: "Bob Martinez",
        phone: "+15555550102",
        email: "bob@globex.example",
        company: "Globex",
        clientId: client.id,
        eventId: event.id,
        nativeSchedulingLink: "https://cal.example/acme/bob",
        fdeOwnerSlackId: "U01ABCDEF",
        status: LeadStatus.no_show,
        scheduledMeetingTime: meetingAt
      }
    }),
    prisma.lead.create({
      data: {
        name: "Carol Singh",
        phone: "+15555550103",
        email: "carol@initech.example",
        company: "Initech",
        clientId: client.id,
        eventId: event.id,
        fdeOwnerSlackId: "U01ABCDEF",
        status: LeadStatus.in_reschedule_convo,
        scheduledMeetingTime: meetingAt
      }
    }),
    prisma.lead.create({
      data: {
        name: "Dan Patel",
        phone: "+15555550104",
        email: "dan@hooli.example",
        company: "Hooli",
        clientId: client.id,
        eventId: event.id,
        fdeOwnerSlackId: "U01ABCDEF",
        status: LeadStatus.confirmed_reschedule,
        scheduledMeetingTime: meetingAt
      }
    }),
    prisma.lead.create({
      data: {
        name: "Eve Nakamura",
        phone: "+15555550105",
        company: "Pied Piper",
        clientId: client.id,
        eventId: event.id,
        fdeOwnerSlackId: "U01ABCDEF",
        status: LeadStatus.uncategorized,
        scheduledMeetingTime: meetingAt
      }
    })
  ]);

  await prisma.conversation.createMany({
    data: [
      {
        leadId: leads[1].id,
        direction: MessageDirection.outbound,
        text: "Hi Bob, this is Acme — sorry we missed you at our 2pm. Want to grab another slot? https://cal.example/acme/bob"
      },
      {
        leadId: leads[2].id,
        direction: MessageDirection.outbound,
        text: "Hi Carol, sorry we missed you. Are you still around the venue today?"
      },
      {
        leadId: leads[2].id,
        direction: MessageDirection.inbound,
        text: "Yeah I got pulled into another meeting, can we try later?"
      },
      {
        leadId: leads[3].id,
        direction: MessageDirection.outbound,
        text: "Hi Dan, sorry we missed you. How about 4pm at the booth?"
      },
      {
        leadId: leads[3].id,
        direction: MessageDirection.inbound,
        text: "4pm works, see you then."
      }
    ]
  });

  const otherEvent = await prisma.event.create({
    data: {
      name: "DevSummit 2026",
      startDate,
      endDate,
      clientId: otherClient.id
    }
  });

  await prisma.lead.create({
    data: {
      name: "Frank Reynolds",
      phone: "+15555550201",
      email: "frank@paddys.example",
      company: "Paddy's Pub",
      clientId: otherClient.id,
      eventId: otherEvent.id,
      fdeOwnerSlackId: "U02ABCDEF",
      status: LeadStatus.scheduled,
      scheduledMeetingTime: new Date(now.getTime() + 90 * 60 * 1000)
    }
  });

  console.log(
    `Seeded clients=${client.id},${otherClient.id} events=${event.id},${otherEvent.id} leads=${leads.length + 1}`
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
