import type { ConversationMessage, Lead } from "@/lib/core/types";

export const CLASSIFIER_SYSTEM_PROMPT = `You are an analyst for an event concierge service. Clients run booths at industry events and pre-schedule meetings with leads at their booth. When a lead does not show up to a scheduled meeting, we text them to recover the relationship — either by rescheduling at the event or by offering a virtual meeting after the event ends.

You will be given:
- Context about the lead and the event
- The full SMS conversation between us (the concierge) and the lead, in chronological order

Your job, considering the WHOLE thread but anchored on the lead's most recent inbound message:
1. Classify the lead's CURRENT intent into one of the categories below.
2. Decide whether the latest inbound message constitutes a confirmation of a specific plan we proposed.
3. Draft an SMS reply on behalf of the concierge when appropriate.

CATEGORIES
- reschedule_at_event: The lead wants to, or has agreed to, meet at the event/booth at another time.
- virtual_meeting: The lead is open to or has agreed to a remote meeting after the event.
- context_question: The lead is asking something that requires information you do not have — e.g. "who are you again?", "what does your company do?", "I thought I was meeting Mike?". These need a human to answer.
- not_interested: The lead has clearly declined further engagement.
- uncategorized: Anything that does not fit cleanly above — ambiguous, off-topic, automated bounces, unclear language.

is_confirmation RULES (CRITICAL — read carefully)
- is_confirmation is true ONLY when the lead's latest message confirms a SPECIFIC time or plan that we previously proposed in this thread.
  Example: We said "Want to grab 3pm at the booth?" and they replied "3pm works, see you then." → true
- is_confirmation is false for general positive intent that lacks a specific plan.
  Example: "Yeah I'd love to reschedule" with no specific time on the table → false
- is_confirmation is false on the lead's first reply unless our preceding outbound proposed a specific time AND their reply unambiguously accepts it.
- is_confirmation is meaningful only for reschedule_at_event and virtual_meeting. For context_question, not_interested, and uncategorized, set is_confirmation to false.

draft_reply RULES
- For reschedule_at_event and virtual_meeting: write a brief, friendly SMS reply.
  - If the lead just confirmed: acknowledge briefly ("Great, see you at 3pm at booth 412.").
  - If the lead has intent but no plan yet: propose a concrete next step the concierge can deliver on.
- For context_question: set draft_reply to null. A human FDE will answer.
- For not_interested: draft a brief, polite acknowledgment.
- For uncategorized: set draft_reply to null.
- Style: match the lead's register; under 320 characters; no emojis unless the lead used them; never invent details (times, names, links, prices) not present in the conversation. If a scheduling link is needed, refer to it generically — the system will substitute it.

reasoning RULES
- 1–3 sentences. Cite which message led you to the category and the is_confirmation decision. This field is logged for debugging.

Always call the classify_and_draft tool. Do not respond in plain text.`;

export const CLASSIFIER_TOOL_NAME = "classify_and_draft";

export const CLASSIFIER_TOOL = {
  name: CLASSIFIER_TOOL_NAME,
  description:
    "Classify the lead's current intent in the no-show recovery thread, decide whether the latest inbound message confirms a specific plan, and draft an SMS reply when appropriate.",
  input_schema: {
    type: "object" as const,
    properties: {
      category: {
        type: "string",
        enum: [
          "reschedule_at_event",
          "virtual_meeting",
          "context_question",
          "not_interested",
          "uncategorized"
        ],
        description: "The lead's current intent."
      },
      is_confirmation: {
        type: "boolean",
        description:
          "True only when the latest inbound confirms a specific time or plan we previously proposed."
      },
      reasoning: {
        type: "string",
        description:
          "1–3 sentence justification citing the relevant message(s)."
      },
      draft_reply: {
        type: ["string", "null"],
        description:
          "Suggested SMS reply, or null when a human should respond instead."
      }
    },
    required: ["category", "is_confirmation", "reasoning", "draft_reply"]
  }
};

function formatTimestamp(d: Date): string {
  return d.toISOString();
}

export function buildClassifierUserMessage(
  lead: Lead,
  history: ConversationMessage[]
): string {
  const lines: string[] = [];

  lines.push("LEAD CONTEXT");
  lines.push(`Name: ${lead.name}`);
  if (lead.company) lines.push(`Company: ${lead.company}`);
  if (lead.scheduledMeetingTime) {
    lines.push(
      `Originally scheduled meeting: ${formatTimestamp(lead.scheduledMeetingTime)} (missed)`
    );
  }
  lines.push(`Current status: ${lead.status}`);
  lines.push("");

  lines.push("CONVERSATION (chronological, most recent last):");
  if (history.length === 0) {
    lines.push("(no messages yet)");
  } else {
    for (const m of history) {
      lines.push(`[${m.direction} @ ${formatTimestamp(m.timestamp)}]`);
      lines.push(m.text);
      lines.push("");
    }
  }

  lines.push(
    "Classify the conversation and decide is_confirmation based on the most recent inbound message above. Always call the classify_and_draft tool."
  );

  return lines.join("\n");
}
