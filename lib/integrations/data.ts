import type {
  ClaudeClassification,
  Client,
  ConversationMessage,
  Event,
  Lead,
  LeadStatus,
  MessageDirection,
  MessageType
} from "@/lib/core/types";
import { PrismaLeadRepository } from "@/lib/integrations/data.prisma";

export interface AppendMessageInput {
  leadId: string;
  direction: MessageDirection;
  text: string;
  classification?: ClaudeClassification | null;
  timestamp?: Date;
  messageType?: MessageType | null;
}

/**
 * Input shape for caching a Vendelux Snowflake lead into Postgres so the
 * existing webhook + state-machine flow can operate on it.
 */
export interface CacheSnowflakeLeadInput {
  vendeluxLeadId: string;
  teamId: string;
  teamName: string;
  eventId: string;
  eventName: string;
  eventStartDate: Date;
  eventEndDate: Date;
  /** Agent persona name from sub-campaign config, e.g. "Sloane Royale". */
  agentPersonaName?: string | null;
  /** Booth location at the event, e.g. "6513". */
  boothLocation?: string | null;
  name: string;
  phone: string;
  email: string | null;
  company: string | null;
  scheduledMeetingTime: Date | null;
}

export interface LeadRepository {
  getLead(id: string): Promise<Lead | null>;
  getActiveLeadByPhone(phone: string): Promise<Lead | null>;
  getConversationHistory(leadId: string): Promise<ConversationMessage[]>;
  appendMessage(input: AppendMessageInput): Promise<ConversationMessage>;
  updateLeadStatus(leadId: string, status: LeadStatus): Promise<void>;
  updateScheduledMeetingTime(leadId: string, time: Date): Promise<void>;
  getActiveNoShows(eventId?: string): Promise<Lead[]>;
  getFdeOwner(leadId: string): Promise<string | null>;
  getMidConversationLeads(now: Date): Promise<Lead[]>;
  getCurrentEvent(now?: Date): Promise<Event | null>;
  getCurrentEventForClient(clientId: string, now?: Date): Promise<Event | null>;
  getLeadsForEvent(eventId: string): Promise<Lead[]>;
  getRecentlyEndedEvents(now: Date, lookbackHours: number): Promise<Event[]>;
  getClient(id: string): Promise<Client | null>;
  listClients(): Promise<Client[]>;
  getLeadByVendeluxId(vendeluxLeadId: string): Promise<Lead | null>;
  getLeadStatesByVendeluxIds(ids: string[]): Promise<Map<string, Lead>>;
  cacheSnowflakeLead(input: CacheSnowflakeLeadInput): Promise<Lead>;
  /** Mark a lead as suppressed (duplicate phone, no SMS sent). */
  suppressLead(leadId: string): Promise<void>;
  /** Cancel all suppressed leads older than the given threshold. Returns count. */
  cancelExpiredSuppressions(olderThan: Date): Promise<number>;
}

let repository: LeadRepository | null = null;

export function getLeadRepository(): LeadRepository {
  if (!repository) {
    repository = new PrismaLeadRepository();
  }
  return repository;
}

export function setLeadRepository(repo: LeadRepository): void {
  repository = repo;
}
