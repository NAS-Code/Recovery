import { NextResponse, type NextRequest } from "next/server";
import { ADMIN_COOKIE_NAME, validateAdminSession } from "@/lib/auth/admin-auth";
import { CAMPAIGN_COOKIE_NAME, validateCampaignSession } from "@/lib/auth/campaign-auth";
import { buildFirstNoShowSms } from "@/lib/core/outbound-templates";
import { getCampaignRepository } from "@/lib/integrations/campaigns";
import { sendSms } from "@/lib/integrations/clicksend";
import { getLeadRepository } from "@/lib/integrations/data";
import {
  combineMeetingDateTime,
  getLeadById,
  getSubCampaignContext
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
  const teamId = decodeURIComponent(params.teamId);
  const eventId = decodeURIComponent(params.eventId);

  // Accept either admin auth OR campaign-scoped auth
  let authorized = false;

  // Try admin session first
  const adminToken = _req.cookies.get(ADMIN_COOKIE_NAME)?.value;
  if (adminToken) {
    authorized = await validateAdminSession(adminToken);
  }

  // Try campaign session (scoped to this specific campaign)
  if (!authorized) {
    const campaignToken = _req.cookies.get(CAMPAIGN_COOKIE_NAME)?.value;
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

  const [snowflakeLead, campaign, subCampaignCtx] = await Promise.all([
    getLeadById(vendeluxLeadId),
    getCampaignRepository().getCampaign(teamId, eventId),
    getSubCampaignContext(teamId, eventId)
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

  // Resolve agent persona: sub-campaign AGENT_PERSONAS → ONSITE_CONTACT_NAME → lead OCM → env var
  const agentPersonaName =
    subCampaignCtx?.agentPersonaName
    || snowflakeLead.ocm
    || process.env.AGENT_PERSONA_NAME
    || null;

  const lead = await repo.cacheSnowflakeLead({
    vendeluxLeadId,
    teamId: campaign.teamId,
    teamName: campaign.teamName,
    eventId: campaign.eventId,
    eventName: campaign.eventName,
    eventStartDate: campaign.eventStartDate,
    eventEndDate: campaign.eventEndDate,
    agentPersonaName,
    boothLocation: subCampaignCtx?.boothLocation ?? null,
    name: snowflakeLead.name,
    phone: snowflakeLead.phone,
    email: snowflakeLead.email,
    company: snowflakeLead.company,
    scheduledMeetingTime: combineMeetingDateTime(snowflakeLead)
  });

  const senderCtx = {
    agentName: agentPersonaName,
    clientName: campaign.teamName
  };

  const body = buildFirstNoShowSms(lead, senderCtx);

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
    text: body,
    messageType: "initial_outreach"
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
