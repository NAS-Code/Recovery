import type {
  ClaudeClassification,
  Client,
  ConversationMessage,
  Event,
  Lead,
  LeadStatus,
  MessageDirection
} from "@/lib/core/types";
import { PrismaLeadRepository } from "@/lib/integrations/data.prisma";

export interface AppendMessageInput {
  leadId: string;
  direction: MessageDirection;
  text: string;
  classification?: ClaudeClassification | null;
  timestamp?: Date;
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
