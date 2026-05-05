import type { Lead, LeadStatus } from "@/lib/core/types";
import { query } from "@/lib/integrations/snowflake";

/**
 * One row from DATA_OPS.SIGMA.SLOANE_LEADS_WITH_POSITIVE_STATUS scoped to a
 * single (team_id, event_id) — i.e. one campaign. The status here is
 * Vendelux's lead_interest_status_name (Meeting Booked / Meeting Initiated /
 * etc.) — NOT concierge's no_show / confirmed_reschedule state.
 *
 * Concierge state lives in our Postgres and overlays this view at render
 * time per the side-store decision in docs/vendelux-integration.md.
 */
export interface CampaignLead {
  leadId: string;
  campaignId: string | null;
  name: string;
  title: string | null;
  email: string | null;
  company: string | null;
  phone: string | null;
  vendeluxStatus: string | null;
  meetingDate: Date | null;
  meetingTimeRaw: string | null;
  meetingTimezone: string | null;
  eventStartDate: Date | null;
  eventEndDate: Date | null;
}

interface LeadRow {
  LEAD_ID: string;
  CAMPAIGN_ID: string | null;
  LEAD_NAME: string | null;
  TITLE: string | null;
  EMAIL: string | null;
  COMPANY: string | null;
  NUMBER_DIALED: string | null;
  STATUS: string | null;
  DATE_MEETING_BOOKED_FOR_1: Date | null;
  TIME_MEETING_BOOKED_FOR_1: string | null;
  MEETING_TIMEZONE: string | null;
  EVENT_START_DATE: Date | null;
  EVENT_END_DATE: Date | null;
}

function toDomain(row: LeadRow): CampaignLead {
  return {
    leadId: row.LEAD_ID,
    campaignId: row.CAMPAIGN_ID,
    name: row.LEAD_NAME ?? "(no name)",
    title: row.TITLE,
    email: row.EMAIL,
    company: row.COMPANY,
    phone: row.NUMBER_DIALED,
    vendeluxStatus: row.STATUS,
    meetingDate: row.DATE_MEETING_BOOKED_FOR_1
      ? new Date(row.DATE_MEETING_BOOKED_FOR_1)
      : null,
    meetingTimeRaw: row.TIME_MEETING_BOOKED_FOR_1,
    meetingTimezone: row.MEETING_TIMEZONE,
    eventStartDate: row.EVENT_START_DATE ? new Date(row.EVENT_START_DATE) : null,
    eventEndDate: row.EVENT_END_DATE ? new Date(row.EVENT_END_DATE) : null
  };
}

const LEAD_COLUMNS = `
  LEAD_ID,
  CAMPAIGN_ID,
  LEAD_NAME,
  TITLE,
  EMAIL,
  COMPANY,
  NUMBER_DIALED,
  STATUS,
  DATE_MEETING_BOOKED_FOR_1,
  TIME_MEETING_BOOKED_FOR_1,
  MEETING_TIMEZONE,
  EVENT_START_DATE,
  EVENT_END_DATE
`;

export async function listLeadsForCampaign(
  teamId: string,
  eventId: string
): Promise<CampaignLead[]> {
  const rows = await query<LeadRow>(
    `SELECT ${LEAD_COLUMNS}
     FROM DATA_OPS.SIGMA.SLOANE_LEADS_WITH_POSITIVE_STATUS
     WHERE TEAM_ID = ? AND EVENT_ID = ?
     ORDER BY DATE_MEETING_BOOKED_FOR_1 ASC NULLS LAST, LEAD_NAME ASC`,
    [teamId, eventId]
  );
  return rows.map(toDomain);
}

export async function getLeadById(
  leadId: string
): Promise<CampaignLead | null> {
  const rows = await query<LeadRow>(
    `SELECT ${LEAD_COLUMNS}
     FROM DATA_OPS.SIGMA.SLOANE_LEADS_WITH_POSITIVE_STATUS
     WHERE LEAD_ID = ?
     LIMIT 1`,
    [leadId]
  );
  return rows.length > 0 ? toDomain(rows[0]) : null;
}

/**
 * The Sigma view returns meeting date and time as separate fields plus a
 * timezone string ('PST', 'EST', etc.). Combine them into a single Date in
 * UTC, returning null if anything is missing or malformed.
 */
const TZ_OFFSETS: Record<string, number> = {
  PST: -8, PDT: -7,
  MST: -7, MDT: -6,
  CST: -6, CDT: -5,
  EST: -5, EDT: -4,
  UTC: 0, GMT: 0
};

const TIME_REGEX = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i;

export function combineMeetingDateTime(lead: CampaignLead): Date | null {
  if (!lead.meetingDate || !lead.meetingTimeRaw) return null;

  const match = lead.meetingTimeRaw.trim().match(TIME_REGEX);
  if (!match) return null;

  let hour = Number.parseInt(match[1], 10);
  const minute = match[2] ? Number.parseInt(match[2], 10) : 0;
  const meridiem = match[3]?.toLowerCase();
  if (meridiem === "pm" && hour < 12) hour += 12;
  if (meridiem === "am" && hour === 12) hour = 0;

  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;

  const tz = (lead.meetingTimezone ?? "UTC").toUpperCase();
  const offsetHours = TZ_OFFSETS[tz];
  if (offsetHours === undefined) return null;

  const dateUtc = new Date(
    Date.UTC(
      lead.meetingDate.getUTCFullYear(),
      lead.meetingDate.getUTCMonth(),
      lead.meetingDate.getUTCDate(),
      hour - offsetHours,
      minute,
      0,
      0
    )
  );

  return Number.isNaN(dateUtc.getTime()) ? null : dateUtc;
}

/**
 * Maps Vendelux's lead_interest_status_name to a concierge-friendly summary.
 * Not the concierge state machine — this is just for display when there's
 * no concierge state yet (the lead hasn't been marked no-show in our system).
 */
export function vendeluxStatusToBadge(status: string | null): string {
  if (!status) return "—";
  return status;
}

export type CampaignLeadConcierge = CampaignLead & {
  concierge: { status: LeadStatus; scheduledMeetingTime: Date | null } | null;
};
