import { describe, expect, it } from "vitest";
import {
  combineMeetingDateTime,
  type CampaignLead
} from "@/lib/integrations/leads.snowflake";

function lead(overrides: Partial<CampaignLead> = {}): CampaignLead {
  return {
    leadId: "lead_1",
    campaignId: null,
    name: "Test Lead",
    title: null,
    email: null,
    company: null,
    phone: null,
    ocm: null,
    csm: null,
    vendeluxStatus: null,
    meetingDate: new Date("2026-05-20T00:00:00Z"),
    meetingTimeRaw: "3pm",
    meetingTimezone: "PST",
    eventStartDate: null,
    eventEndDate: null,
    ...overrides
  };
}

describe("combineMeetingDateTime", () => {
  it("combines a PM time + PST date into UTC", () => {
    const result = combineMeetingDateTime(lead());
    // 3pm PST = 23:00 UTC same day
    expect(result?.toISOString()).toBe("2026-05-20T23:00:00.000Z");
  });

  it("handles 24-hour notation", () => {
    const result = combineMeetingDateTime(
      lead({ meetingTimeRaw: "15:30", meetingTimezone: "EST" })
    );
    // 15:30 EST = 20:30 UTC
    expect(result?.toISOString()).toBe("2026-05-20T20:30:00.000Z");
  });

  it("handles AM times correctly", () => {
    const result = combineMeetingDateTime(
      lead({ meetingTimeRaw: "9am", meetingTimezone: "EDT" })
    );
    // 9am EDT = 13:00 UTC
    expect(result?.toISOString()).toBe("2026-05-20T13:00:00.000Z");
  });

  it("handles 12am as midnight", () => {
    const result = combineMeetingDateTime(
      lead({ meetingTimeRaw: "12am", meetingTimezone: "UTC" })
    );
    expect(result?.toISOString()).toBe("2026-05-20T00:00:00.000Z");
  });

  it("handles 12pm as noon", () => {
    const result = combineMeetingDateTime(
      lead({ meetingTimeRaw: "12pm", meetingTimezone: "UTC" })
    );
    expect(result?.toISOString()).toBe("2026-05-20T12:00:00.000Z");
  });

  it("returns null when meetingDate is missing", () => {
    expect(combineMeetingDateTime(lead({ meetingDate: null }))).toBeNull();
  });

  it("returns null when meetingTimeRaw is missing", () => {
    expect(combineMeetingDateTime(lead({ meetingTimeRaw: null }))).toBeNull();
  });

  it("returns null on unparseable time", () => {
    expect(
      combineMeetingDateTime(lead({ meetingTimeRaw: "morning" }))
    ).toBeNull();
  });

  it("returns null on unknown timezone abbreviation", () => {
    expect(
      combineMeetingDateTime(lead({ meetingTimezone: "UNKNOWN_ZONE" }))
    ).toBeNull();
  });

  it("falls back to UTC when timezone is missing", () => {
    const result = combineMeetingDateTime(
      lead({ meetingTimeRaw: "10am", meetingTimezone: null })
    );
    expect(result?.toISOString()).toBe("2026-05-20T10:00:00.000Z");
  });
});
