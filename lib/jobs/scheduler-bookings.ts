import { ACTIVE_NO_SHOW_STATUSES } from "@/lib/core/types";
import { getLeadRepository } from "@/lib/integrations/data";
import { getLeadById } from "@/lib/integrations/leads.snowflake";
import { notifyRebooked } from "@/lib/integrations/slack";
import { query } from "@/lib/integrations/snowflake";
import { logger } from "@/lib/util/logger";

const LOOKBACK_HOURS = 48;

export interface SchedulerBookingSyncResult {
  bookings: number;
  confirmed: number;
  unmatched: number;
  alreadyHandled: number;
}

interface BookingRow {
  UUID: string;
  ATTENDEE_EMAIL: string | null;
  /** START_TIME rendered as an explicit UTC ISO string — the column is
   *  TIMESTAMP_NTZ holding UTC, so we format it rather than trust driver tz. */
  START_UTC: string | null;
  UTM_SOURCE: string | null;
  UTM_CONTENT: string | null;
}

/**
 * Close the loop on native-scheduler rebookings: when a no-show lead books
 * through their concierge link, confirm the reschedule in concierge.
 *
 * Matches on utm_content (the sourceLeadId we put in the link), falling back
 * to attendee email. Only ever acts on leads still in an active no-show
 * conversation, which makes it idempotent — once confirmed, later runs skip.
 */
export async function runSchedulerBookingSync(
  now: Date = new Date()
): Promise<SchedulerBookingSyncResult> {
  const repo = getLeadRepository();
  const since = new Date(now.getTime() - LOOKBACK_HOURS * 60 * 60 * 1000);

  const rows = await query<BookingRow>(
    `SELECT
       UUID,
       ATTENDEE_EMAIL,
       TO_CHAR(START_TIME, 'YYYY-MM-DD"T"HH24:MI:SS') || 'Z' AS "START_UTC",
       ATTRIBUTION_PARAMS:utm_source::string  AS "UTM_SOURCE",
       ATTRIBUTION_PARAMS:utm_content::string AS "UTM_CONTENT"
     FROM APPDB.SCHEDULER.MEETING_BOOKINGS
     WHERE _FIVETRAN_DELETED = FALSE
       AND STATUS = 'confirmed'
       AND CREATED >= TO_TIMESTAMP_NTZ(?)`,
    [since.toISOString().slice(0, 19).replace("T", " ")]
  );

  const result: SchedulerBookingSyncResult = {
    bookings: rows.length,
    confirmed: 0,
    unmatched: 0,
    alreadyHandled: 0
  };

  for (const row of rows) {
    const startTime = row.START_UTC ? new Date(row.START_UTC) : null;
    if (!startTime || Number.isNaN(startTime.getTime())) continue;

    // Prefer the lead id we embedded in the link; else match by attendee email.
    const utmLeadId = row.UTM_CONTENT?.trim() || null;
    let lead = utmLeadId ? await repo.getLeadBySourceId(utmLeadId) : null;
    if (!lead && row.ATTENDEE_EMAIL) {
      lead = await repo.getActiveLeadByEmail(row.ATTENDEE_EMAIL.trim());
    }

    if (!lead) {
      result.unmatched++;
      continue;
    }
    if (!ACTIVE_NO_SHOW_STATUSES.includes(lead.status)) {
      result.alreadyHandled++;
      continue;
    }

    await repo.updateScheduledMeetingTime(lead.id, startTime);
    await repo.updateLeadStatus(lead.id, "confirmed_reschedule");
    result.confirmed++;

    logger.info("scheduler_booking.confirmed", {
      leadId: lead.id,
      bookingUuid: row.UUID,
      matchedBy: utmLeadId ? "utm_content" : "attendee_email",
      utmSource: row.UTM_SOURCE ?? null,
      meetingTime: startTime.toISOString()
    });

    // Best-effort Slack ping, mirroring the SMS/manual rebooking paths.
    try {
      const [sf, client, event] = await Promise.all([
        lead.sourceLeadId
          ? getLeadById(lead.sourceLeadId).catch(() => null)
          : Promise.resolve(null),
        repo.getClient(lead.clientId),
        repo.getCurrentEventForClient(lead.clientId)
      ]);
      await notifyRebooked({
        lead: { ...lead, status: "confirmed_reschedule" },
        clientName: client?.name ?? null,
        eventName: event?.name ?? null,
        previousTime: lead.scheduledMeetingTime,
        meetingTime: startTime,
        timezone: event?.timezone,
        ocm: sf?.ocm,
        csm: sf?.csm
      });
    } catch (err) {
      logger.error("scheduler_booking.notify_failed", {
        leadId: lead.id,
        error: err instanceof Error ? err.message : String(err)
      });
    }
  }

  logger.info("cron.scheduler_bookings.done", { ...result });
  return result;
}
