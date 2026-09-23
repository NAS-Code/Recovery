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
 * Input shape for caching a platform Snowflake lead into Postgres so the
 * existing webhook + state-machine flow can operate on it.
 */
export interface CacheSnowflakeLeadInput {
  sourceLeadId: string;
  teamId: string;
  teamName: string;
  eventId: string;
  eventName: string;
  eventStartDate: Date;
  eventEndDate: Date;
  /** Agent persona name from sub-campaign config, e.g. "Jordan Reyes". */
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
  /** Active no-show lead by email — used to match native scheduler bookings. */
  getActiveLeadByEmail(email: string): Promise<Lead | null>;
  getConversationHistory(leadId: string): Promise<ConversationMessage[]>;
  appendMessage(input: AppendMessageInput): Promise<ConversationMessage>;
  updateLeadStatus(leadId: string, status: LeadStatus): Promise<void>;
  updateScheduledMeetingTime(leadId: string, time: Date): Promise<void>;
  getActiveNoShows(eventId?: string): Promise<Lead[]>;
  /** Every lead currently in `no_show` status, across all clients/events. */
  getNoShowLeads(): Promise<Lead[]>;
  getEventsByIds(ids: string[]): Promise<Event[]>;
  getFdeOwner(leadId: string): Promise<string | null>;
  getMidConversationLeads(now: Date): Promise<Lead[]>;
  getCurrentEvent(now?: Date): Promise<Event | null>;
  getCurrentEventForClient(clientId: string, now?: Date): Promise<Event | null>;
  getLeadsForEvent(eventId: string): Promise<Lead[]>;
  getRecentlyEndedEvents(now: Date, lookbackHours: number): Promise<Event[]>;
  getClient(id: string): Promise<Client | null>;
  listClients(): Promise<Client[]>;
  getLeadBySourceId(sourceLeadId: string): Promise<Lead | null>;
  getLeadStatesBySourceIds(ids: string[]): Promise<Map<string, Lead>>;
  cacheSnowflakeLead(input: CacheSnowflakeLeadInput): Promise<Lead>;
  /** Mark a lead as suppressed (duplicate phone, no SMS sent). */
  suppressLead(leadId: string): Promise<void>;
  /** Store a lead-proposed reschedule time and move to pending_client_approval. */
  setProposedMeetingTime(leadId: string, time: Date): Promise<void>;
  /** Client approved: proposed time → scheduled, clear proposed, confirm reschedule. */
  approveProposedTime(leadId: string): Promise<void>;
  /** Client rejected: clear proposed time, reopen the reschedule conversation. */
  rejectProposedTime(leadId: string): Promise<void>;
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
