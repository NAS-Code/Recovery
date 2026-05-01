import { describe, expect, it } from "vitest";
import {
  ClassifierError,
  parseClassification
} from "@/lib/integrations/claude";
import { buildClassifierUserMessage } from "@/lib/core/classifier-prompts";
import type { ConversationMessage, Lead } from "@/lib/core/types";

const validInput = {
  category: "reschedule_at_event",
  is_confirmation: true,
  reasoning: "Lead replied '3pm works' to our 3pm proposal.",
  draft_reply: "Great, see you at 3pm at the booth.",
  confirmed_time: "2026-05-01T15:00:00-04:00"
};

describe("parseClassification — valid payloads", () => {
  it("accepts a fully populated classification", () => {
    expect(parseClassification(validInput)).toEqual(validInput);
  });

  it("accepts null draft_reply (used for context_question / uncategorized)", () => {
    expect(
      parseClassification({
        category: "context_question",
        is_confirmation: false,
        reasoning: "Lead asked who we are.",
        draft_reply: null,
        confirmed_time: null
      })
    ).toMatchObject({ category: "context_question", draft_reply: null });
  });

  it("accepts null confirmed_time when no specific time was confirmed", () => {
    const result = parseClassification({
      category: "reschedule_at_event",
      is_confirmation: false,
      reasoning: "General positive intent without a clock time.",
      draft_reply: "Want me to send some times?",
      confirmed_time: null
    });
    expect(result.confirmed_time).toBeNull();
  });

  it("preserves confirmed_time as a string for downstream parsing", () => {
    const result = parseClassification({
      category: "virtual_meeting",
      is_confirmation: true,
      reasoning: "Lead said 'Tuesday 4pm works'.",
      draft_reply: "Great — see you Tuesday at 4.",
      confirmed_time: "2026-05-05T16:00:00-04:00"
    });
    expect(result.confirmed_time).toBe("2026-05-05T16:00:00-04:00");
  });

  it("accepts each valid category", () => {
    const categories = [
      "reschedule_at_event",
      "virtual_meeting",
      "context_question",
      "not_interested",
      "uncategorized"
    ] as const;
    for (const c of categories) {
      const result = parseClassification({
        category: c,
        is_confirmation: false,
        reasoning: "test",
        draft_reply: null,
        confirmed_time: null
      });
      expect(result.category).toBe(c);
    }
  });
});

describe("parseClassification — invalid payloads", () => {
  it("throws ClassifierError when category is unknown", () => {
    expect(() =>
      parseClassification({ ...validInput, category: "bogus" })
    ).toThrow(ClassifierError);
  });

  it("throws when is_confirmation is missing", () => {
    const { is_confirmation: _ic, ...rest } = validInput;
    expect(() => parseClassification(rest)).toThrow(ClassifierError);
  });

  it("throws when reasoning is missing", () => {
    const { reasoning: _r, ...rest } = validInput;
    expect(() => parseClassification(rest)).toThrow(ClassifierError);
  });

  it("throws when draft_reply is missing entirely", () => {
    const { draft_reply: _d, ...rest } = validInput;
    expect(() => parseClassification(rest)).toThrow(ClassifierError);
  });

  it("throws when confirmed_time is missing", () => {
    const { confirmed_time: _ct, ...rest } = validInput;
    expect(() => parseClassification(rest)).toThrow(ClassifierError);
  });

  it("throws when is_confirmation is not boolean", () => {
    expect(() =>
      parseClassification({ ...validInput, is_confirmation: "yes" })
    ).toThrow(ClassifierError);
  });

  it("throws when payload is null or wrong type", () => {
    expect(() => parseClassification(null)).toThrow(ClassifierError);
    expect(() => parseClassification("not an object")).toThrow(ClassifierError);
    expect(() => parseClassification(42)).toThrow(ClassifierError);
  });
});

describe("buildClassifierUserMessage", () => {
  const lead: Lead = {
    id: "lead_1",
    name: "Alice Johnson",
    phone: "+15555550101",
    email: null,
    company: "Target Industries",
    clientId: "client_1",
    eventId: "event_1",
    nativeSchedulingLink: null,
    fdeOwnerSlackId: "U01",
    status: "no_show",
    scheduledMeetingTime: new Date("2026-04-29T15:00:00Z"),
    createdAt: new Date("2026-04-29T12:00:00Z"),
    updatedAt: new Date("2026-04-29T15:30:00Z")
  };

  const history: ConversationMessage[] = [
    {
      id: "m1",
      leadId: "lead_1",
      direction: "outbound",
      text: "Hi Alice, sorry we missed you at 3pm. Want another slot?",
      timestamp: new Date("2026-04-29T15:30:00Z"),
      claudeClassification: null
    },
    {
      id: "m2",
      leadId: "lead_1",
      direction: "inbound",
      text: "Yeah, 4:30 works.",
      timestamp: new Date("2026-04-29T15:35:00Z"),
      claudeClassification: null
    }
  ];

  it("includes lead name, company, and current status", () => {
    const msg = buildClassifierUserMessage(lead, history);
    expect(msg).toContain("Alice Johnson");
    expect(msg).toContain("Target Industries");
    expect(msg).toContain("no_show");
  });

  it("renders messages in chronological order with direction labels", () => {
    const msg = buildClassifierUserMessage(lead, history);
    const outboundIdx = msg.indexOf("[outbound");
    const inboundIdx = msg.indexOf("[inbound");
    expect(outboundIdx).toBeGreaterThan(-1);
    expect(inboundIdx).toBeGreaterThan(outboundIdx);
    expect(msg).toContain("Yeah, 4:30 works.");
  });

  it("handles an empty conversation gracefully", () => {
    const msg = buildClassifierUserMessage(lead, []);
    expect(msg).toContain("(no messages yet)");
  });

  it("omits company line when company is null", () => {
    const noCompany = { ...lead, company: null };
    const msg = buildClassifierUserMessage(noCompany, history);
    expect(msg).not.toContain("Company:");
  });

  it("omits scheduled meeting line when scheduledMeetingTime is null", () => {
    const noTime = { ...lead, scheduledMeetingTime: null };
    const msg = buildClassifierUserMessage(noTime, history);
    expect(msg).not.toContain("Originally scheduled meeting:");
  });
});
