import {
  TERMINAL_STATUSES,
  type ClaudeClassification,
  type LeadStatus
} from "@/lib/core/types";

/**
 * Pure transition function. Given a lead's current status and the latest
 * Claude classification of an inbound message, return the next status.
 *
 * Rules:
 * - Terminal statuses (confirmed_reschedule, confirmed_virtual, not_interested)
 *   are sticky. Re-opening a closed thread is an FDE decision, not Claude's.
 * - "scheduled" is pre-no-show; the state machine does not apply.
 * - is_confirmation only matters for the two reschedule categories. For
 *   context_question and not_interested it is ignored (it has no meaning
 *   there). For uncategorized we always land in uncategorized.
 */
export function nextState(
  current: LeadStatus,
  classification: ClaudeClassification
): LeadStatus {
  if (TERMINAL_STATUSES.includes(current)) return current;
  if (current === "scheduled") return current;

  switch (classification.category) {
    case "reschedule_at_event":
      return classification.is_confirmation
        ? "confirmed_reschedule"
        : "in_reschedule_convo";
    case "virtual_meeting":
      return classification.is_confirmation
        ? "confirmed_virtual"
        : "in_virtual_convo";
    case "context_question":
      return "context_question";
    case "not_interested":
      return "not_interested";
    case "uncategorized":
      return "uncategorized";
  }
}

export function clearsNoShow(status: LeadStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}
