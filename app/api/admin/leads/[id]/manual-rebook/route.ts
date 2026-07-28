import { NextResponse, type NextRequest } from "next/server";
import { ADMIN_COOKIE_NAME, validateAdminSession } from "@/lib/auth/admin-auth";
import { hasConflict } from "@/lib/core/availability";
import { ACTIVE_NO_SHOW_STATUSES } from "@/lib/core/types";
import { getLeadRepository } from "@/lib/integrations/data";
import { getLeadById } from "@/lib/integrations/leads.snowflake";
import { getCampaignMeetingTimes } from "@/lib/integrations/meetings";
import { notifyRebooked } from "@/lib/integrations/slack";
import { tryParseIsoDate } from "@/lib/util/format";
import { logger } from "@/lib/util/logger";

export const runtime = "nodejs";

/**
 * Caller (phone outreach) manually rebooked a no-show lead. Two modes:
 * - native:   booked through the Vendelux scheduler → authoritative, confirm
 *             immediately (scheduler enforced availability).
 * - external: booked on the client's own calendar → same flow as an SMS
 *             reschedule: conflict pre-check, then pending_client_approval so
 *             the onsite contact confirms via the dashboard popup.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const adminToken = req.cookies.get(ADMIN_COOKIE_NAME)?.value;
  if (!adminToken || !(await validateAdminSession(adminToken))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const mode = body?.mode;
  const meetingTime = tryParseIsoDate(body?.meetingTime);
  if ((mode !== "native" && mode !== "external") || !meetingTime) {
    return NextResponse.json(
      { error: "mode ('native'|'external') and meetingTime (ISO) required" },
      { status: 400 }
    );
  }

  const repo = getLeadRepository();
  const lead = await repo.getLead(params.id);
  if (!lead) {
    return NextResponse.json({ error: "lead_not_found" }, { status: 404 });
  }
  if (!ACTIVE_NO_SHOW_STATUSES.includes(lead.status)) {
    return NextResponse.json(
      { error: "invalid_state", currentStatus: lead.status },
      { status: 409 }
    );
  }

  if (mode === "native") {
    await repo.updateScheduledMeetingTime(lead.id, meetingTime);
    await repo.updateLeadStatus(lead.id, "confirmed_reschedule");

    const [sf, client, event] = await Promise.all([
      lead.vendeluxLeadId
        ? getLeadById(lead.vendeluxLeadId).catch(() => null)
        : Promise.resolve(null),
      repo.getClient(lead.clientId),
      repo.getCurrentEventForClient(lead.clientId)
    ]);
    await notifyRebooked({
      lead: { ...lead, status: "confirmed_reschedule" },
      clientName: client?.name ?? null,
      eventName: event?.name ?? null,
      previousTime: lead.scheduledMeetingTime,
      meetingTime,
      timezone: event?.timezone,
      ocm: sf?.ocm,
      csm: sf?.csm
    });

    logger.info("manual_rebook.native_confirmed", {
      leadId: lead.id,
      meetingTime: meetingTime.toISOString()
    });
    return NextResponse.json({ status: "confirmed_reschedule" });
  }

  // external — pre-check against known meetings, then route to client approval
  if (lead.vendeluxLeadId) {
    const known = await getCampaignMeetingTimes(
      lead.clientId,
      lead.eventId,
      lead.vendeluxLeadId
    ).catch(() => [] as Date[]);
    if (hasConflict(known, meetingTime)) {
      return NextResponse.json(
        {
          error: "conflict",
          detail: "That time overlaps a meeting already on the dashboard."
        },
        { status: 409 }
      );
    }
  }

  await repo.setProposedMeetingTime(lead.id, meetingTime); // → pending_client_approval
  logger.info("manual_rebook.pending_approval", {
    leadId: lead.id,
    meetingTime: meetingTime.toISOString()
  });
  return NextResponse.json({ status: "pending_client_approval" });
}
