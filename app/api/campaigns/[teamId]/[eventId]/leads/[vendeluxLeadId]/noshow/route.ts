import { NextResponse, type NextRequest } from "next/server";
import { getClientContext } from "@/lib/auth/context";
import { buildFirstNoShowSms } from "@/lib/core/outbound-templates";
import { getCampaignRepository } from "@/lib/integrations/campaigns";
import { sendSms } from "@/lib/integrations/clicksend";
import { getLeadRepository } from "@/lib/integrations/data";
import {
  combineMeetingDateTime,
  getLeadById
} from "@/lib/integrations/leads.snowflake";
import { logger } from "@/lib/util/logger";

export const runtime = "nodejs";

export async function POST(
  _req: NextRequest,
  {
    params
  }: {
    params: { teamId: string; eventId: string; vendeluxLeadId: string };
  }
) {
  const ctx = getClientContext();
  if (!ctx) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const teamId = decodeURIComponent(params.teamId);
  const eventId = decodeURIComponent(params.eventId);
  const vendeluxLeadId = decodeURIComponent(params.vendeluxLeadId);

  const repo = getLeadRepository();

  // If we've already cached this lead and it's past 'scheduled', short-circuit
  const existing = await repo.getLeadByVendeluxId(vendeluxLeadId);
  if (existing && existing.status !== "scheduled") {
    return NextResponse.json(
      { error: "invalid_state", currentStatus: existing.status },
      { status: 409 }
    );
  }

  const [snowflakeLead, campaign] = await Promise.all([
    getLeadById(vendeluxLeadId),
    getCampaignRepository().getCampaign(teamId, eventId)
  ]);

  if (!snowflakeLead) {
    return NextResponse.json({ error: "lead_not_found" }, { status: 404 });
  }
  if (!campaign) {
    return NextResponse.json({ error: "campaign_not_found" }, { status: 404 });
  }
  if (!snowflakeLead.phone) {
    return NextResponse.json(
      { error: "lead_has_no_phone", detail: "NUMBER_DIALED is null in the Sigma view for this lead" },
      { status: 422 }
    );
  }

  const lead = await repo.cacheSnowflakeLead({
    vendeluxLeadId,
    teamId: campaign.teamId,
    teamName: campaign.teamName,
    eventId: campaign.eventId,
    eventName: campaign.eventName,
    eventStartDate: campaign.eventStartDate,
    eventEndDate: campaign.eventEndDate,
    name: snowflakeLead.name,
    phone: snowflakeLead.phone,
    email: snowflakeLead.email,
    company: snowflakeLead.company,
    scheduledMeetingTime: combineMeetingDateTime(snowflakeLead)
  });

  const body = buildFirstNoShowSms(lead);

  let sms;
  try {
    sms = await sendSms({ to: lead.phone, body, leadId: lead.id });
  } catch (err) {
    logger.error("noshow.snowflake.sms_failed", {
      leadId: lead.id,
      vendeluxLeadId,
      error: err instanceof Error ? err.message : String(err)
    });
    return NextResponse.json(
      {
        error: "sms_failed",
        detail: err instanceof Error ? err.message : "unknown"
      },
      { status: 502 }
    );
  }

  await repo.updateLeadStatus(lead.id, "no_show");
  await repo.appendMessage({
    leadId: lead.id,
    direction: "outbound",
    text: body
  });

  logger.info("noshow.snowflake.marked", {
    leadId: lead.id,
    vendeluxLeadId,
    teamId: campaign.teamId,
    eventId: campaign.eventId,
    smsMessageId: sms.messageId,
    smsStatus: sms.status
  });

  return NextResponse.json({
    leadId: lead.id,
    vendeluxLeadId,
    status: "no_show",
    sms: { messageId: sms.messageId, status: sms.status }
  });
}
