import { NextResponse, type NextRequest } from "next/server";
import { ADMIN_COOKIE_NAME, validateAdminSession } from "@/lib/auth/admin-auth";
import {
  CAMPAIGN_COOKIE_NAME,
  validateCampaignSession
} from "@/lib/auth/campaign-auth";
import { hasConflict } from "@/lib/core/availability";
import {
  buildRescheduleConfirmedSms,
  buildRescheduleConflictSms
} from "@/lib/core/outbound-templates";
import { sendSms } from "@/lib/integrations/clicksend";
import { getLeadRepository } from "@/lib/integrations/data";
import { getLeadById } from "@/lib/integrations/leads.snowflake";
import { getCampaignMeetingTimes } from "@/lib/integrations/meetings";
import { notifyRebooked } from "@/lib/integrations/slack";
import { logger } from "@/lib/util/logger";

export const runtime = "nodejs";

export async function POST(
  req: NextRequest,
  {
    params
  }: {
    params: { teamId: string; eventId: string; vendeluxLeadId: string };
  }
) {
  const teamId = decodeURIComponent(params.teamId);
  const eventId = decodeURIComponent(params.eventId);
  const vendeluxLeadId = decodeURIComponent(params.vendeluxLeadId);

  // Accept admin auth OR campaign-scoped auth (same as the noshow route).
  let authorized = false;
  const adminToken = req.cookies.get(ADMIN_COOKIE_NAME)?.value;
  if (adminToken) authorized = await validateAdminSession(adminToken);
  if (!authorized) {
    const campaignToken = req.cookies.get(CAMPAIGN_COOKIE_NAME)?.value;
    if (campaignToken) {
      const session = await validateCampaignSession(campaignToken);
      if (session && session.teamId === teamId && session.eventId === eventId) {
        authorized = true;
      }
    }
  }
  if (!authorized) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const decision = body?.decision;
  if (decision !== "approve" && decision !== "reject") {
    return NextResponse.json(
      { error: "decision must be 'approve' or 'reject'" },
      { status: 400 }
    );
  }

  const repo = getLeadRepository();
  const lead = await repo.getLeadByVendeluxId(vendeluxLeadId);
  if (!lead) {
    return NextResponse.json({ error: "lead_not_found" }, { status: 404 });
  }
  if (lead.status !== "pending_client_approval" || !lead.proposedMeetingTime) {
    return NextResponse.json(
      { error: "no_pending_proposal", currentStatus: lead.status },
      { status: 409 }
    );
  }

  const proposedTime = lead.proposedMeetingTime;

  // ---- Reject: clear the proposal, ask the lead for another time ----
  if (decision === "reject") {
    await repo.rejectProposedTime(lead.id);
    await sendOutbound(lead.id, lead.phone, buildRescheduleConflictSms(lead));
    logger.info("reschedule.rejected", { leadId: lead.id, vendeluxLeadId });
    return NextResponse.json({ status: "in_reschedule_convo" });
  }

  // ---- Approve: re-check conflict in case the calendar moved since the popup ----
  const known = await getCampaignMeetingTimes(
    teamId,
    eventId,
    vendeluxLeadId
  ).catch(() => [] as Date[]);
  if (hasConflict(known, proposedTime)) {
    logger.info("reschedule.approve_conflict", { leadId: lead.id, vendeluxLeadId });
    return NextResponse.json(
      { error: "conflict", detail: "That time is no longer open." },
      { status: 409 }
    );
  }

  const previousTime = lead.scheduledMeetingTime;
  await repo.approveProposedTime(lead.id); // proposed → scheduled, status confirmed_reschedule
  await sendOutbound(lead.id, lead.phone, buildRescheduleConfirmedSms(lead));

  // Slack ping, mirroring the webhook's rebooked notification. Best-effort.
  const [sf, client, event] = await Promise.all([
    getLeadById(vendeluxLeadId).catch(() => null),
    repo.getClient(lead.clientId),
    repo.getCurrentEventForClient(lead.clientId)
  ]);
  await notifyRebooked({
    lead: { ...lead, status: "confirmed_reschedule" },
    clientName: client?.name ?? null,
    eventName: event?.name ?? null,
    previousTime,
    meetingTime: proposedTime,
    timezone: event?.timezone,
    ocm: sf?.ocm,
    csm: sf?.csm
  });

  logger.info("reschedule.approved", {
    leadId: lead.id,
    vendeluxLeadId,
    meetingTime: proposedTime.toISOString()
  });
  return NextResponse.json({ status: "confirmed_reschedule" });
}

async function sendOutbound(
  leadId: string,
  phone: string,
  bodyText: string
): Promise<void> {
  const repo = getLeadRepository();
  try {
    await sendSms({ to: phone, body: bodyText, leadId });
  } catch (err) {
    logger.error("reschedule.sms_failed", {
      leadId,
      error: err instanceof Error ? err.message : String(err)
    });
    return;
  }
  await repo.appendMessage({
    leadId,
    direction: "outbound",
    text: bodyText,
    messageType: "auto_reply"
  });
}
