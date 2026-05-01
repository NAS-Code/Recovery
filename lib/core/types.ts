export type LeadStatus =
  | "scheduled"
  | "no_show"
  | "in_reschedule_convo"
  | "confirmed_reschedule"
  | "in_virtual_convo"
  | "confirmed_virtual"
  | "context_question"
  | "not_interested"
  | "uncategorized";

export const ACTIVE_NO_SHOW_STATUSES: LeadStatus[] = [
  "no_show",
  "in_reschedule_convo",
  "in_virtual_convo",
  "context_question",
  "uncategorized"
];

export const TERMINAL_STATUSES: LeadStatus[] = [
  "confirmed_reschedule",
  "confirmed_virtual",
  "not_interested"
];

export type MessageDirection = "inbound" | "outbound";

export type ClaudeCategory =
  | "reschedule_at_event"
  | "virtual_meeting"
  | "context_question"
  | "not_interested"
  | "uncategorized";

export interface ClaudeClassification {
  category: ClaudeCategory;
  is_confirmation: boolean;
  reasoning: string;
  draft_reply: string | null;
}

export interface Client {
  id: string;
  name: string;
}

export interface Event {
  id: string;
  name: string;
  startDate: Date;
  endDate: Date;
  clientId: string;
}

export interface Lead {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  company: string | null;
  clientId: string;
  eventId: string;
  nativeSchedulingLink: string | null;
  fdeOwnerSlackId: string | null;
  status: LeadStatus;
  scheduledMeetingTime: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ConversationMessage {
  id: string;
  leadId: string;
  direction: MessageDirection;
  text: string;
  timestamp: Date;
  claudeClassification: ClaudeClassification | null;
}
