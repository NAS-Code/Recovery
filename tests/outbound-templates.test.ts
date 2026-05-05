import { describe, expect, it } from "vitest";
import {
  buildFirstNoShowSms,
  buildVirtualOfferSms
} from "@/lib/core/outbound-templates";
import type { Lead } from "@/lib/core/types";

const baseLead: Lead = {
  id: "lead_1",
  name: "Alice Johnson",
  phone: "+15555550101",
  email: null,
  company: "Target",
  clientId: "client_1",
  eventId: "event_1",
  nativeSchedulingLink: null,
  fdeOwnerSlackId: null,
  vendeluxLeadId: null,
  status: "scheduled",
  scheduledMeetingTime: null,
  createdAt: new Date(),
  updatedAt: new Date()
};

describe("buildFirstNoShowSms", () => {
  it("uses first name and includes the scheduling link when present", () => {
    const msg = buildFirstNoShowSms({
      ...baseLead,
      nativeSchedulingLink: "https://cal.example/alice"
    });
    expect(msg).toMatch(/^Hi Alice,/);
    expect(msg).toContain("https://cal.example/alice");
  });

  it("omits the link and asks for a time when no link is configured", () => {
    const msg = buildFirstNoShowSms(baseLead);
    expect(msg).toMatch(/^Hi Alice,/);
    expect(msg).not.toContain("http");
    expect(msg.toLowerCase()).toContain("another time");
  });

  it("falls back to a friendly greeting when name is empty", () => {
    const msg = buildFirstNoShowSms({ ...baseLead, name: "   " });
    expect(msg).toMatch(/^Hi there,/);
  });

  it("handles single-word names", () => {
    const msg = buildFirstNoShowSms({ ...baseLead, name: "Madonna" });
    expect(msg).toMatch(/^Hi Madonna,/);
  });
});

describe("buildVirtualOfferSms", () => {
  it("invites a virtual meeting using first name", () => {
    const msg = buildVirtualOfferSms(baseLead);
    expect(msg).toContain("Alice");
    expect(msg.toLowerCase()).toContain("virtual");
  });
});
