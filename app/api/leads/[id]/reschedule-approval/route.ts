import { NextResponse, type NextRequest } from "next/server";
import { getClientContext } from "@/lib/auth/context";
import { hasConflict } from "@/lib/core/availability";
import {
  buildRescheduleConfirmedSms,
  buildRescheduleConflictSms
} from "@/lib/core/outbound-templates";
import { sendSms } from "@/lib/integrations/clicksend";
import { getLeadRepository } from "@/lib/integrations/data";
import { getCampaignMeetingTimes } from "@/lib/integrations/meetings";
import { notifyRebooked } from "@/lib/integrations/slack";
import { logger } from "@/lib/util/logger";

export const runtime = "nodejs";

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const ctx = getClientContext();
  if (!ctx) {
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

  const leadId = params.id;
  const repo = getLeadRepository();
  const lead = await repo.getLead(leadId);
  if (!lead) {
    return NextResponse.json({ error: "lead_not_found" }, { status: 404 });
  }
  if (lead.clientId !== ctx.clientId) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  if (lead.status !== "pending_client_approval" || !lead.proposedMeetingTime) {
    return NextResponse.json(
      { error: "no_pending_proposal", currentStatus: lead.status },
      { status: 409 }
    );
  }

  const proposedTime = lead.proposedMeetingTime;

  if (decision === "reject") {
    await repo.rejectProposedTime(leadId);
    await sendOutbound(leadId, lead.phone, buildRescheduleConflictSms(lead));
    logger.info("reschedule.rejected", { leadId, clientId: ctx.clientId });
    return NextResponse.json({ status: "in_reschedule_convo" });
  }

  // Re-check against known meetings (only possible when the lead came from Snowflake).
  if (lead.vendeluxLeadId) {
    const known = await getCampaignMeetingTimes(
      lead.clientId,
      lead.eventId,
      lead.vendeluxLeadId
    ).catch(() => [] as Date[]);
    if (hasConflict(known, proposedTime)) {
      return NextResponse.json(
        { error: "conflict", detail: "That time is no longer open." },
        { status: 409 }
      );
    }
  }

  const previousTime = lead.scheduledMeetingTime;
  await repo.approveProposedTime(leadId);
  await sendOutbound(leadId, lead.phone, buildRescheduleConfirmedSms(lead));

  const [client, event] = await Promise.all([
    repo.getClient(lead.clientId),
    repo.getCurrentEventForClient(lead.clientId)
  ]);
  await notifyRebooked({
    lead: { ...lead, status: "confirmed_reschedule" },
    clientName: client?.name ?? null,
    eventName: event?.name ?? null,
    previousTime,
    meetingTime: proposedTime,
    timezone: event?.timezone
  });

  logger.info("reschedule.approved", {
    leadId,
    clientId: ctx.clientId,
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
