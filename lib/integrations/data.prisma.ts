import type {
  Client as PrismaClient_,
  Conversation as PrismaConversation,
  Event as PrismaEvent,
  Lead as PrismaLead,
  Prisma
} from "@prisma/client";
import { prisma } from "@/lib/integrations/prisma";
import {
  ACTIVE_NO_SHOW_STATUSES,
  type ClaudeClassification,
  type Client,
  type ConversationMessage,
  type Event,
  type Lead,
  type LeadStatus
} from "@/lib/core/types";
import type { AppendMessageInput, LeadRepository } from "@/lib/integrations/data";

const FOUR_HOURS_MS = 4 * 60 * 60 * 1000;

function toDomainLead(row: PrismaLead): Lead {
  return {
    id: row.id,
    name: row.name,
    phone: row.phone,
    email: row.email,
    company: row.company,
    clientId: row.clientId,
    eventId: row.eventId,
    nativeSchedulingLink: row.nativeSchedulingLink,
    fdeOwnerSlackId: row.fdeOwnerSlackId,
    status: row.status as LeadStatus,
    scheduledMeetingTime: row.scheduledMeetingTime,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

function toDomainClient(row: PrismaClient_): Client {
  return { id: row.id, name: row.name };
}

function toDomainEvent(row: PrismaEvent): Event {
  return {
    id: row.id,
    name: row.name,
    startDate: row.startDate,
    endDate: row.endDate,
    clientId: row.clientId
  };
}

function toDomainMessage(row: PrismaConversation): ConversationMessage {
  return {
    id: row.id,
    leadId: row.leadId,
    direction: row.direction,
    text: row.text,
    timestamp: row.timestamp,
    claudeClassification:
      (row.claudeClassification as ClaudeClassification | null) ?? null
  };
}

export class PrismaLeadRepository implements LeadRepository {
  async getLead(id: string): Promise<Lead | null> {
    const row = await prisma.lead.findUnique({ where: { id } });
    return row ? toDomainLead(row) : null;
  }

  async getActiveLeadByPhone(phone: string): Promise<Lead | null> {
    const row = await prisma.lead.findFirst({
      where: {
        phone,
        status: { in: ACTIVE_NO_SHOW_STATUSES }
      },
      orderBy: { updatedAt: "desc" }
    });
    return row ? toDomainLead(row) : null;
  }

  async getConversationHistory(leadId: string): Promise<ConversationMessage[]> {
    const rows = await prisma.conversation.findMany({
      where: { leadId },
      orderBy: { timestamp: "asc" }
    });
    return rows.map(toDomainMessage);
  }

  async appendMessage(input: AppendMessageInput): Promise<ConversationMessage> {
    const row = await prisma.conversation.create({
      data: {
        leadId: input.leadId,
        direction: input.direction,
        text: input.text,
        timestamp: input.timestamp ?? new Date(),
        claudeClassification:
          (input.classification as Prisma.InputJsonValue | undefined) ?? undefined
      }
    });
    return toDomainMessage(row);
  }

  async updateLeadStatus(leadId: string, status: LeadStatus): Promise<void> {
    await prisma.lead.update({
      where: { id: leadId },
      data: { status }
    });
  }

  async updateScheduledMeetingTime(
    leadId: string,
    time: Date
  ): Promise<void> {
    await prisma.lead.update({
      where: { id: leadId },
      data: { scheduledMeetingTime: time }
    });
  }

  async getActiveNoShows(eventId?: string): Promise<Lead[]> {
    const rows = await prisma.lead.findMany({
      where: {
        status: { in: ACTIVE_NO_SHOW_STATUSES },
        ...(eventId ? { eventId } : {})
      },
      orderBy: { updatedAt: "desc" }
    });
    return rows.map(toDomainLead);
  }

  async getFdeOwner(leadId: string): Promise<string | null> {
    const row = await prisma.lead.findUnique({
      where: { id: leadId },
      select: { fdeOwnerSlackId: true }
    });
    return row?.fdeOwnerSlackId ?? null;
  }

  async getCurrentEvent(now: Date = new Date()): Promise<Event | null> {
    const active = await prisma.event.findFirst({
      where: { startDate: { lte: now }, endDate: { gte: now } },
      orderBy: { startDate: "desc" }
    });
    if (active) return toDomainEvent(active);
    const fallback = await prisma.event.findFirst({
      orderBy: { endDate: "desc" }
    });
    return fallback ? toDomainEvent(fallback) : null;
  }

  async getCurrentEventForClient(
    clientId: string,
    now: Date = new Date()
  ): Promise<Event | null> {
    const active = await prisma.event.findFirst({
      where: { clientId, startDate: { lte: now }, endDate: { gte: now } },
      orderBy: { startDate: "desc" }
    });
    if (active) return toDomainEvent(active);
    const fallback = await prisma.event.findFirst({
      where: { clientId },
      orderBy: { endDate: "desc" }
    });
    return fallback ? toDomainEvent(fallback) : null;
  }

  async getClient(id: string): Promise<Client | null> {
    const row = await prisma.client.findUnique({ where: { id } });
    return row ? toDomainClient(row) : null;
  }

  async listClients(): Promise<Client[]> {
    const rows = await prisma.client.findMany({ orderBy: { name: "asc" } });
    return rows.map(toDomainClient);
  }

  async getRecentlyEndedEvents(
    now: Date,
    lookbackHours: number
  ): Promise<Event[]> {
    const start = new Date(now.getTime() - lookbackHours * 60 * 60 * 1000);
    const rows = await prisma.event.findMany({
      where: { endDate: { gte: start, lte: now } },
      orderBy: { endDate: "desc" }
    });
    return rows.map(toDomainEvent);
  }

  async getLeadsForEvent(eventId: string): Promise<Lead[]> {
    const rows = await prisma.lead.findMany({
      where: { eventId },
      orderBy: [{ updatedAt: "desc" }]
    });
    return rows.map(toDomainLead);
  }

  async getMidConversationLeads(now: Date): Promise<Lead[]> {
    const cutoff = new Date(now.getTime() - FOUR_HOURS_MS);
    const candidates = await prisma.lead.findMany({
      where: { status: { in: ACTIVE_NO_SHOW_STATUSES } },
      include: {
        conversations: {
          orderBy: { timestamp: "desc" },
          take: 1
        }
      }
    });

    return candidates
      .filter((lead) => {
        const last = lead.conversations[0];
        return (
          last !== undefined &&
          last.direction === "inbound" &&
          last.timestamp >= cutoff
        );
      })
      .map(({ conversations: _conversations, ...lead }) => toDomainLead(lead));
  }
}
