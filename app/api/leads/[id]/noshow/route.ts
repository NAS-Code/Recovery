import { NextResponse, type NextRequest } from "next/server";
import { getClientContext } from "@/lib/auth/context";
import { buildFirstNoShowSms } from "@/lib/core/outbound-templates";
import { sendSms } from "@/lib/integrations/clicksend";
import { getLeadRepository } from "@/lib/integrations/data";
import { logger } from "@/lib/util/logger";

export const runtime = "nodejs";

export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const ctx = getClientContext();
  if (!ctx) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
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
  if (lead.status !== "scheduled") {
    return NextResponse.json(
      { error: "invalid_state", currentStatus: lead.status },
      { status: 409 }
    );
  }

  // Guard: prevent duplicate outreach to the same phone number across campaigns.
  const activeForPhone = await repo.getActiveLeadByPhone(lead.phone);
  if (activeForPhone && activeForPhone.id !== lead.id) {
    logger.warn("noshow.duplicate_phone_blocked", {
      leadId,
      phone: lead.phone,
      blockedByLeadId: activeForPhone.id,
      blockedByStatus: activeForPhone.status
    });
    return NextResponse.json(
      {
        error: "duplicate_phone",
        detail: "This contact already has an active outreach from another campaign"
      },
      { status: 409 }
    );
  }

  const [client, event] = await Promise.all([
    repo.getClient(ctx.clientId),
    repo.getCurrentEventForClient(ctx.clientId)
  ]);
  const senderCtx = {
    agentName: event?.agentPersonaName || process.env.AGENT_PERSONA_NAME || null,
    clientName: client?.name ?? null
  };

  const body = buildFirstNoShowSms(lead, senderCtx);

  let sms;
  try {
    sms = await sendSms({ to: lead.phone, body, leadId: lead.id });
  } catch (err) {
    logger.error("noshow.sms_failed", {
      leadId,
      clientId: ctx.clientId,
      error: err instanceof Error ? err.message : String(err)
    });
    return NextResponse.json(
      { error: "sms_failed", detail: err instanceof Error ? err.message : "unknown" },
      { status: 502 }
    );
  }

  await repo.updateLeadStatus(leadId, "no_show");
  await repo.appendMessage({
    leadId,
    direction: "outbound",
    text: body,
    messageType: "initial_outreach"
  });

  logger.info("noshow.marked", {
    leadId,
    clientId: ctx.clientId,
    eventId: lead.eventId,
    smsMessageId: sms.messageId,
    smsStatus: sms.status
  });

  return NextResponse.json({
    leadId,
    status: "no_show",
    sms: { messageId: sms.messageId, status: sms.status }
  });
}
