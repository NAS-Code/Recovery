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

is_confirmation captures whether the meeting is mutually scheduled after this exchange completes. The lead will not always send a follow-up "see you then" message after we agree — once they've proposed a time and we accept, they're done. Don't require a third turn just to confirm.

Set is_confirmation = true when EITHER of these holds:

(a) The lead's latest message confirms a specific time or plan that WE previously proposed in this thread.
    Example: We said "Want to grab 3pm at the booth?" and they replied "3pm works, see you then." → true

(b) The lead's latest message PROPOSES a specific time AND your draft_reply unambiguously accepts that time. This is the common case — lead suggests "4pm works", you accept, the meeting is booked.
    Example: Lead says "4pm at the booth works" and your draft_reply says "Great, see you at 4!" → true
    Counter-example: Lead says "afternoon" and your draft_reply says "How about 3pm?" → false (you're countering, lead hasn't accepted)

Set is_confirmation = false when:
- The lead has positive intent but no specific time is on the table
- Your draft_reply proposes a counter-time the lead hasn't accepted yet
- The conversation is still actively negotiating
- The category is context_question, not_interested, or uncategorized

Critical: is_confirmation and draft_reply are decided together. If you're going to accept a time the lead proposed, set is_confirmation = true and write an accepting reply in the same turn. Don't draft an acceptance and then mark is_confirmation = false — that's the inconsistency we're avoiding.

confirmed_time RULES
- Set confirmed_time to an ISO 8601 datetime with timezone offset when is_confirmation is true AND a specific clock time has been agreed (either case (a) or case (b) above).
- Use the lead's originally scheduled meeting time as the date and timezone anchor. The original time is given to you in UTC; deduce the local offset from context (event location, lead's hints) and express the confirmed time in that same offset.
  Example: original meeting was 2026-05-01T19:00:00Z (3pm ET). Lead says "see you at 4pm". confirmed_time = 2026-05-01T16:00:00-04:00.
- For relative phrases ("tomorrow at 3", "next Tuesday morning"), anchor "today" to the lead's latest inbound message timestamp. Pick a sensible default for vague terms (morning = 09:00, afternoon = 14:00, evening = 18:00).
- Set to null when is_confirmation is false, when the confirmation lacks a clock time ("yes I'll be there" with no time), or when the time is genuinely ambiguous.

draft_reply RULES
- For reschedule_at_event and virtual_meeting: write a brief, friendly SMS reply.
  - If the lead confirmed a time we previously proposed: acknowledge briefly ("Great, see you at 3pm at booth 412.").
  - If the lead PROPOSED a workable specific time: accept it directly ("Great, 4pm at the booth works. See you then.") AND set is_confirmation = true.
  - If the lead has intent but no specific time on the table: propose a concrete next step the concierge can deliver on, and is_confirmation = false.
  - If the lead's proposed time is vague ("afternoon", "later") or unworkable, counter-propose a specific time, and is_confirmation = false until they accept.
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
      },
      confirmed_time: {
        type: ["string", "null"],
        description:
          "ISO 8601 datetime with timezone offset when the lead confirms a specific clock time. Null otherwise."
      }
    },
    required: [
      "category",
      "is_confirmation",
      "reasoning",
      "draft_reply",
      "confirmed_time"
    ]
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
