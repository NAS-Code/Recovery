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
  /** Onsite Contact Manager — the Vendelux rep who booked the meeting with this lead. */
  ocm: string | null;
  /** Customer Success Manager — the Vendelux rep who owns the client relationship. */
  csm: string | null;
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
  OCM: string | null;
  CSM: string | null;
  STATUS: string | null;
  DATE_MEETING_BOOKED_FOR: Date | null;
  TIME_MEETING_BOOKED_FOR: string | null;
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
    ocm: row.OCM ?? null,
    csm: row.CSM ?? null,
    vendeluxStatus: row.STATUS,
    meetingDate: row.DATE_MEETING_BOOKED_FOR
      ? new Date(row.DATE_MEETING_BOOKED_FOR)
      : null,
    meetingTimeRaw: row.TIME_MEETING_BOOKED_FOR,
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
  OCM,
  CSM,
  STATUS,
  DATE_MEETING_BOOKED_FOR,
  TIME_MEETING_BOOKED_FOR,
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
     WHERE TEAM_ID = ?
       AND EVENT_ID = ?
       AND STATUS = 'Meeting Booked'
     ORDER BY DATE_MEETING_BOOKED_FOR ASC NULLS LAST, LEAD_NAME ASC`,
    [teamId, eventId]
  );
  return rows.map(toDomain);
}

/**
 * Data-team rule: if this phone number is a positive lead under a *different*
 * team, don't text them — the other team owns the relationship. Source of truth
 * is SILVER.TEXTING.POSITIVE_LEAD_DETAILS (full population, not just leads we've
 * already cached in Postgres).
 */
export async function hasCrossTeamConflict(
  phone: string,
  teamId: string
): Promise<boolean> {
  const rows = await query<{ N: number }>(
    `SELECT COUNT(*) AS "N"
     FROM SILVER.TEXTING.POSITIVE_LEAD_DETAILS
     WHERE TO_NUMBER = ? AND TEAM_ID != ?`,
    [phone, teamId]
  );
  return (rows[0]?.N ?? 0) > 0;
}

export type EventLead = CampaignLead & { teamId: string; teamName: string | null };

/** All meetings booked for one event across every team/client. Admin-only view. */
export async function listLeadsForEventAllTeams(
  eventId: string
): Promise<EventLead[]> {
  const rows = await query<LeadRow & { TEAM_ID: string; TEAM: string | null }>(
    `SELECT ${LEAD_COLUMNS},
       TEAM_ID,
       TEAM
     FROM DATA_OPS.SIGMA.SLOANE_LEADS_WITH_POSITIVE_STATUS
     WHERE EVENT_ID = ?
       AND STATUS = 'Meeting Booked'
     ORDER BY TEAM ASC, DATE_MEETING_BOOKED_FOR ASC NULLS LAST, LEAD_NAME ASC`,
    [eventId]
  );
  return rows.map((row) => ({
    ...toDomain(row),
    teamId: row.TEAM_ID,
    teamName: row.TEAM ?? null
  }));
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

// ---------------------------------------------------------------------------
// Native scheduler rebooking link
// ---------------------------------------------------------------------------

const SCHEDULER_HOST = "https://vendelux.com/app/rsvp/hosted/";

/**
 * The native Vendelux scheduler link for a lead's campaign, with concierge
 * UTM correlation (utm_content = vendeluxLeadId flows through to the booking
 * webhook). Returns null when the campaign has no active scheduler — callers
 * treat that as "no link to offer". Only ever emits native vendelux.com links.
 *
 * Slugs live in the Fivetran copy of the app DB; EVENTS_MEETINGSUBCAMPAIGN
 * bridges the concierge sub-campaign UUID to the app-DB integer id.
 */
export async function getSchedulerRebookLink(
  teamId: string,
  eventId: string,
  vendeluxLeadId: string
): Promise<string | null> {
  try {
    const rows = await query<{ SLUG: string }>(
      `SELECT et.SLUG AS "SLUG"
       FROM VDXDB.APPDB_VEND2.MEETING_HOST_EVENT_TYPES et
       JOIN VDXDB.APPDB_VEND2.EVENTS_MEETINGSUBCAMPAIGN sc
         ON et.SUBCAMPAIGN_ID = sc.ID AND sc._FIVETRAN_DELETED = FALSE
       WHERE et._FIVETRAN_DELETED = FALSE
         AND et.STATUS = 'active'
         AND sc.UUID IN (
           SELECT VDX_SUB_CAMPAIGN_ID
           FROM SILVER.SLOANE_V2.V_VDX_SUB_CAMPAIGN_CONFIG
           WHERE TEAM_ID = ? AND EVENT_ID = ?
         )
       ORDER BY et.ID
       LIMIT 1`,
      [teamId, eventId]
    );
    if (rows.length === 0 || !rows[0].SLUG) return null;
    return `${SCHEDULER_HOST}${rows[0].SLUG}?utm_source=concierge&utm_content=${encodeURIComponent(vendeluxLeadId)}`;
  } catch {
    // Missing grant / transient failure → behave as "no scheduler link".
    return null;
  }
}

// ---------------------------------------------------------------------------
// Sub-campaign config — agent persona, booth, booking link
// ---------------------------------------------------------------------------

export interface SubCampaignContext {
  agentPersonaName: string | null;
  boothLocation: string | null;
  bookingLink: string | null;
  /** First connected sender address (the Instantly "eaccount" for one-off emails). */
  senderEmail: string | null;
}

interface SubCampaignRow {
  AGENT_PERSONAS: unknown[] | null;
  ONSITE_CONTACT_NAME: string | null;
  BOOTH_LOCATION: string | null;
  BOOKING_LINK: string | null;
  SENDER_EMAIL_LIST: unknown;
}

/** SENDER_EMAIL_LIST may come back as an array or a comma-separated string — take the first. */
function firstSenderEmail(raw: unknown): string | null {
  const list = Array.isArray(raw)
    ? raw
    : typeof raw === "string"
      ? raw.split(",")
      : [];
  for (const item of list) {
    const email = String(item).trim();
    if (email) return email;
  }
  return null;
}

/**
 * Fetch the sub-campaign context for a given campaign (team + event).
 * A campaign may have multiple sub-campaigns; we take the first one with
 * a non-empty AGENT_PERSONAS array, falling back to ONSITE_CONTACT_NAME.
 */
export async function getSubCampaignContext(
  teamId: string,
  eventId: string
): Promise<SubCampaignContext | null> {
  const rows = await query<SubCampaignRow>(
    `SELECT
       AGENT_PERSONAS       AS "AGENT_PERSONAS",
       ONSITE_CONTACT_NAME  AS "ONSITE_CONTACT_NAME",
       BOOTH_LOCATION       AS "BOOTH_LOCATION",
       BOOKING_LINK         AS "BOOKING_LINK",
       SENDER_EMAIL_LIST    AS "SENDER_EMAIL_LIST"
     FROM SILVER.SLOANE_V2.V_VDX_SUB_CAMPAIGN_CONFIG
     WHERE TEAM_ID = ? AND EVENT_ID = ?
     ORDER BY LAST_UPDATED_AT DESC
     LIMIT 5`,
    [teamId, eventId]
  );

  if (rows.length === 0) return null;

  // Find the first row with a populated AGENT_PERSONAS array
  let personaName: string | null = null;
  for (const row of rows) {
    const personas = row.AGENT_PERSONAS;
    if (Array.isArray(personas) && personas.length > 0) {
      // AGENT_PERSONAS can be an array of strings or objects with a "name" field
      const first = personas[0];
      if (typeof first === "string" && first.trim()) {
        personaName = first.trim();
      } else if (first && typeof first === "object" && "name" in first) {
        personaName = String((first as { name: unknown }).name).trim() || null;
      }
      if (personaName) break;
    }
  }

  // Fallback: ONSITE_CONTACT_NAME from the first row that has one
  if (!personaName) {
    for (const row of rows) {
      if (row.ONSITE_CONTACT_NAME?.trim()) {
        personaName = row.ONSITE_CONTACT_NAME.trim();
        break;
      }
    }
  }

  // Use the first row for booth/booking (most recently updated sub-campaign)
  const primary = rows[0];

  // Sender email: first row that has a populated SENDER_EMAIL_LIST.
  let senderEmail: string | null = null;
  for (const row of rows) {
    senderEmail = firstSenderEmail(row.SENDER_EMAIL_LIST);
    if (senderEmail) break;
  }

  return {
    agentPersonaName: personaName,
    boothLocation: primary.BOOTH_LOCATION ?? null,
    bookingLink: primary.BOOKING_LINK ?? null,
    senderEmail
  };
}
