import { describe, expect, it } from "vitest";
import { clearsNoShow, nextState } from "@/lib/core/conversation-state";
import type { ClaudeClassification, LeadStatus } from "@/lib/core/types";

function classify(
  category: ClaudeClassification["category"],
  is_confirmation = false
): ClaudeClassification {
  return {
    category,
    is_confirmation,
    reasoning: "test",
    draft_reply: null,
    confirmed_time: null
  };
}

describe("nextState — terminal states are sticky", () => {
  const terminals: LeadStatus[] = [
    "confirmed_reschedule",
    "confirmed_virtual",
    "not_interested"
  ];

  for (const t of terminals) {
    it(`${t} does not transition even on a strong classification`, () => {
      expect(nextState(t, classify("reschedule_at_event", true))).toBe(t);
      expect(nextState(t, classify("virtual_meeting", true))).toBe(t);
      expect(nextState(t, classify("context_question"))).toBe(t);
      expect(nextState(t, classify("not_interested"))).toBe(t);
      expect(nextState(t, classify("uncategorized"))).toBe(t);
    });
  }
});

describe("nextState — scheduled is pre-no-show", () => {
  it("never transitions out of scheduled", () => {
    expect(nextState("scheduled", classify("reschedule_at_event", true))).toBe(
      "scheduled"
    );
    expect(nextState("scheduled", classify("uncategorized"))).toBe("scheduled");
  });
});

describe("nextState — reschedule_at_event", () => {
  it("non-confirmation transitions no_show to in_reschedule_convo", () => {
    expect(nextState("no_show", classify("reschedule_at_event", false))).toBe(
      "in_reschedule_convo"
    );
  });

  it("confirmation transitions no_show straight to confirmed_reschedule", () => {
    expect(nextState("no_show", classify("reschedule_at_event", true))).toBe(
      "confirmed_reschedule"
    );
  });

  it("confirmation closes an in-progress reschedule conversation", () => {
    expect(
      nextState("in_reschedule_convo", classify("reschedule_at_event", true))
    ).toBe("confirmed_reschedule");
  });

  it("non-confirmation keeps lead in in_reschedule_convo", () => {
    expect(
      nextState("in_reschedule_convo", classify("reschedule_at_event", false))
    ).toBe("in_reschedule_convo");
  });
});

describe("nextState — virtual_meeting", () => {
  it("non-confirmation transitions no_show to in_virtual_convo", () => {
    expect(nextState("no_show", classify("virtual_meeting", false))).toBe(
      "in_virtual_convo"
    );
  });

  it("confirmation transitions no_show straight to confirmed_virtual", () => {
    expect(nextState("no_show", classify("virtual_meeting", true))).toBe(
      "confirmed_virtual"
    );
  });

  it("confirmation closes an in-progress virtual conversation", () => {
    expect(
      nextState("in_virtual_convo", classify("virtual_meeting", true))
    ).toBe("confirmed_virtual");
  });
});

describe("nextState — pivots between conversation types", () => {
  it("reschedule convo can pivot to virtual", () => {
    expect(
      nextState("in_reschedule_convo", classify("virtual_meeting", false))
    ).toBe("in_virtual_convo");
  });

  it("virtual convo can pivot to reschedule", () => {
    expect(
      nextState("in_virtual_convo", classify("reschedule_at_event", false))
    ).toBe("in_reschedule_convo");
  });

  it("context_question can resolve into a reschedule confirmation", () => {
    expect(
      nextState("context_question", classify("reschedule_at_event", true))
    ).toBe("confirmed_reschedule");
  });

  it("uncategorized can resolve into a confirmation once Claude figures it out", () => {
    expect(
      nextState("uncategorized", classify("virtual_meeting", true))
    ).toBe("confirmed_virtual");
  });
});

describe("nextState — context_question and not_interested", () => {
  it("context_question moves to context_question regardless of is_confirmation", () => {
    expect(nextState("no_show", classify("context_question", false))).toBe(
      "context_question"
    );
    expect(nextState("no_show", classify("context_question", true))).toBe(
      "context_question"
    );
  });

  it("not_interested moves to not_interested regardless of is_confirmation", () => {
    expect(nextState("no_show", classify("not_interested", false))).toBe(
      "not_interested"
    );
    expect(
      nextState("in_reschedule_convo", classify("not_interested", false))
    ).toBe("not_interested");
  });
});

describe("nextState — uncategorized routes to uncategorized", () => {
  it("from no_show", () => {
    expect(nextState("no_show", classify("uncategorized"))).toBe("uncategorized");
  });

  it("from in_reschedule_convo", () => {
    expect(nextState("in_reschedule_convo", classify("uncategorized"))).toBe(
      "uncategorized"
    );
  });
});

describe("clearsNoShow", () => {
  it("returns true for the three terminal statuses", () => {
    expect(clearsNoShow("confirmed_reschedule")).toBe(true);
    expect(clearsNoShow("confirmed_virtual")).toBe(true);
    expect(clearsNoShow("not_interested")).toBe(true);
  });

  it("returns false for active and pre-no-show statuses", () => {
    expect(clearsNoShow("scheduled")).toBe(false);
    expect(clearsNoShow("no_show")).toBe(false);
    expect(clearsNoShow("in_reschedule_convo")).toBe(false);
    expect(clearsNoShow("in_virtual_convo")).toBe(false);
    expect(clearsNoShow("context_question")).toBe(false);
    expect(clearsNoShow("uncategorized")).toBe(false);
  });
});
