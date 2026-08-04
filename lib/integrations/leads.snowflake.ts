import type { Lead, LeadStatus } from "@/lib/core/types";
import { query } from "@/lib/integrations/snowflake";
import { logger } from "@/lib/util/logger";

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

/**
 * AutoStore is absent from the Sigma leads view, so its meetings come from a
 * dedicated table instead. Same columns, different names — aliased below so the
 * rest of the pipeline is unchanged.
 * ponytail: one-client special case; fold back into the main query if AutoStore
 * ever lands in the Sigma view.
 */
const AUTOSTORE_TEAM_ID = "d3c63d41e6454ab49a345001d1ae7ca4";
const AUTOSTORE_TABLE =
  "DATA_ANALYSIS_SANDBOXES.SANDBOX.DEB_NICK_HACKATHON_AUTOSTORE_DATA";

/** AutoStore column names → the names the shared LeadRow mapper expects. */
const AUTOSTORE_LEAD_COLUMNS = `
  LEAD_ID,
  CAMPAIGN_ID,
  LEAD_NAME,
  TITLE,
  EMAIL,
  COMPANY_NAME                       AS "COMPANY",
  NUMBER_DIAL                        AS "NUMBER_DIALED",
  OCM_NAME                           AS "OCM",
  CSM_NAME                           AS "CSM",
  LEAD_INTEREST_STATUS_NAME          AS "STATUS",
  TRY_TO_DATE(DATE_MEETING_BOOKED_FOR) AS "DATE_MEETING_BOOKED_FOR",
  TIME_MEETING_BOOKED_FOR,
  MEETING_TIME_ZONE                  AS "MEETING_TIMEZONE",
  EVENT_START_DATE,
  EVENT_END_DATE
`;

export async function listLeadsForCampaign(
  teamId: string,
  eventId: string
): Promise<CampaignLead[]> {
  if (teamId === AUTOSTORE_TEAM_ID) {
    // Sandbox table gets rebuilt (CREATE OR REPLACE drops our SELECT grant), so
    // render an empty campaign rather than a 500 when it's unreadable.
    const rows = await query<LeadRow>(
      `SELECT ${AUTOSTORE_LEAD_COLUMNS}
       FROM ${AUTOSTORE_TABLE}
       WHERE TEAM_ID = ?
         AND EVENT_ID = ?
         AND LEAD_INTEREST_STATUS_NAME = 'Meeting Booked'`,
      [teamId, eventId]
    ).catch((err) => {
      logger.error("autostore.leads_unavailable", {
        eventId,
        error: err instanceof Error ? err.message : String(err)
      });
      return [] as LeadRow[];
    });
    return rows.map(toDomain);
  }

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
  try {
    const rows = await query<{ N: number }>(
      `SELECT COUNT(*) AS "N"
       FROM SILVER.TEXTING.POSITIVE_LEAD_DETAILS
       WHERE TO_NUMBER = ? AND TEAM_ID != ?`,
      [phone, teamId]
    );
    return (rows[0]?.N ?? 0) > 0;
  } catch (err) {
    // Fail OPEN: this view isn't readable by our role today, and throwing here
    // would 500 the whole no-show action. The Postgres active-lead-by-phone
    // guard still catches the common duplicate case.
    logger.warn("noshow.cross_team_check_unavailable", {
      teamId,
      error: err instanceof Error ? err.message : String(err)
    });
    return false;
  }
}

export type EventLead = CampaignLead & { teamId: string; teamName: string | null };

/**
 * All meetings booked for one event across the given teams, in ONE query.
 * TEAM_ID IN (...) keeps the pruning that makes the per-campaign query fast;
 * parallel per-team queries saturate the warehouse and all time out, and an
 * unpruned EVENT_ID-only scan times out too.
 */
export async function listLeadsForEventAllTeams(
  eventId: string,
  teams: { teamId: string; teamName: string }[]
): Promise<EventLead[]> {
  if (teams.length === 0) return [];
  const nameByTeam = new Map(teams.map((t) => [t.teamId, t.teamName]));
  const sigmaTeams = teams.filter((t) => t.teamId !== AUTOSTORE_TEAM_ID);
  const hasAutostore = teams.length !== sigmaTeams.length;

  const toEventLead = (row: LeadRow & { TEAM_ID: string }) => ({
    ...toDomain(row),
    teamId: row.TEAM_ID,
    teamName: nameByTeam.get(row.TEAM_ID) ?? null
  });

  const [sigmaRows, autostoreRows] = await Promise.all([
    sigmaTeams.length > 0
      ? query<LeadRow & { TEAM_ID: string }>(
          `SELECT ${LEAD_COLUMNS},
             TEAM_ID
           FROM DATA_OPS.SIGMA.SLOANE_LEADS_WITH_POSITIVE_STATUS
           WHERE EVENT_ID = ?
             AND TEAM_ID IN (${sigmaTeams.map(() => "?").join(", ")})
             AND STATUS = 'Meeting Booked'`,
          [eventId, ...sigmaTeams.map((t) => t.teamId)]
        )
      : Promise.resolve([]),
    hasAutostore
      ? query<LeadRow & { TEAM_ID: string }>(
          `SELECT ${AUTOSTORE_LEAD_COLUMNS},
             TEAM_ID
           FROM ${AUTOSTORE_TABLE}
           WHERE EVENT_ID = ?
             AND TEAM_ID = ?
             AND LEAD_INTEREST_STATUS_NAME = 'Meeting Booked'`,
          [eventId, AUTOSTORE_TEAM_ID]
        ).catch(() => [])
      : Promise.resolve([])
  ]);

  const leads = [...sigmaRows, ...autostoreRows].map(toEventLead);

  // Soonest meeting first (date+time; leads with no parseable time last),
  // then client name, then lead name as tie-breakers.
  return leads.sort((a, b) => {
    const ta = combineMeetingDateTime(a)?.getTime() ?? Number.MAX_SAFE_INTEGER;
    const tb = combineMeetingDateTime(b)?.getTime() ?? Number.MAX_SAFE_INTEGER;
    if (ta !== tb) return ta - tb;
    const team = (a.teamName ?? "").localeCompare(b.teamName ?? "");
    if (team !== 0) return team;
    return a.name.localeCompare(b.name);
  });
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
  if (rows.length > 0) return toDomain(rows[0]);

  // AutoStore leads don't exist in the Sigma view — fall back to their table so
  // mark-no-show and the Slack OCM/CSM lookup still work for them.
  const autostore = await query<LeadRow>(
    `SELECT ${AUTOSTORE_LEAD_COLUMNS}
     FROM ${AUTOSTORE_TABLE}
     WHERE LEAD_ID = ?
     LIMIT 1`,
    [leadId]
  ).catch(() => []);
  return autostore.length > 0 ? toDomain(autostore[0]) : null;
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

/**
 * The client's own (non-native) booking link per team for one event, from the
 * BOOKING_LINK field on the Vendelux campaign config.
 *
 * Restricted to "Early Confirmed" / "Predicted" sub-campaigns: BOOKING_LINK
 * holds whatever CTA a sub-campaign uses, so other sub-campaigns carry
 * unrelated links (e.g. an Executive Dinner Luma RSVP) that must never be
 * offered as a meeting-rebooking link. Prefers Early Confirmed, then the most
 * recently updated (NULLS LAST — a null timestamp sorts first otherwise).
 */
export async function getBookingLinksForEvent(
  eventId: string,
  teamIds: string[]
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (teamIds.length === 0) return out;
  try {
    const rows = await query<{ TEAM_ID: string; BOOKING_LINK: string | null }>(
      `SELECT TEAM_ID AS "TEAM_ID", BOOKING_LINK AS "BOOKING_LINK"
       FROM SILVER.SLOANE_V2.V_VDX_SUB_CAMPAIGN_CONFIG
       WHERE EVENT_ID = ?
         AND TEAM_ID IN (${teamIds.map(() => "?").join(", ")})
         AND BOOKING_LINK IS NOT NULL
         AND (VDX_SUB_CAMPAIGN_NAME ILIKE '%early confirmed%'
              OR VDX_SUB_CAMPAIGN_NAME ILIKE '%predicted%')
       ORDER BY
         IFF(VDX_SUB_CAMPAIGN_NAME ILIKE '%early confirmed%', 0, 1),
         LAST_UPDATED_AT DESC NULLS LAST`,
      [eventId, ...teamIds]
    );
    for (const row of rows) {
      const link = row.BOOKING_LINK?.trim();
      // Only surface real URLs — the field is free text and holds junk sometimes.
      if (link && /^https?:\/\//i.test(link) && !out.has(row.TEAM_ID)) {
        out.set(row.TEAM_ID, link);
      }
    }
  } catch (err) {
    logger.warn("booking_links.unavailable", {
      eventId,
      error: err instanceof Error ? err.message : String(err)
    });
  }
  return out;
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
 * AGENT_PERSONAS entries look like:
 *   { agent_emails: [...], agent_first_name: "Sloane", agent_last_name: "Royale", ... }
 * Older/other shapes may be plain strings or carry a "name" key, so handle all three.
 */
function personaObjects(raw: unknown): Record<string, unknown>[] {
  return Array.isArray(raw)
    ? raw.filter(
        (p): p is Record<string, unknown> => !!p && typeof p === "object"
      )
    : [];
}

function firstPersonaName(raw: unknown): string | null {
  if (Array.isArray(raw)) {
    for (const p of raw) {
      if (typeof p === "string" && p.trim()) return p.trim();
      if (p && typeof p === "object") {
        const o = p as Record<string, unknown>;
        const full = [o.agent_first_name, o.agent_last_name]
          .map((v) => (typeof v === "string" ? v.trim() : ""))
          .filter(Boolean)
          .join(" ");
        if (full) return full;
        if (typeof o.name === "string" && o.name.trim()) return o.name.trim();
      }
    }
  }
  return null;
}

/** Sender address nested on the persona (used when SENDER_EMAIL_LIST is null). */
function personaSenderEmail(raw: unknown): string | null {
  for (const p of personaObjects(raw)) {
    const found = firstSenderEmail(p.agent_emails);
    if (found) return found;
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
    personaName = firstPersonaName(row.AGENT_PERSONAS);
    if (personaName) break;
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

  // Sender email: prefer SENDER_EMAIL_LIST, else the persona's agent_emails
  // (many sub-campaigns only populate the nested persona form).
  let senderEmail: string | null = null;
  for (const row of rows) {
    senderEmail =
      firstSenderEmail(row.SENDER_EMAIL_LIST) ??
      personaSenderEmail(row.AGENT_PERSONAS);
    if (senderEmail) break;
  }

  return {
    agentPersonaName: personaName,
    boothLocation: primary.BOOTH_LOCATION ?? null,
    bookingLink: primary.BOOKING_LINK ?? null,
    senderEmail
  };
}
