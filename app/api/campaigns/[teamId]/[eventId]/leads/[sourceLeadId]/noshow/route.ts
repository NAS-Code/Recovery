import { NextResponse, type NextRequest } from "next/server";
import { ADMIN_COOKIE_NAME, validateAdminSession } from "@/lib/auth/admin-auth";
import { CAMPAIGN_COOKIE_NAME, validateCampaignSession } from "@/lib/auth/campaign-auth";
import {
  buildFirstNoShowSms,
  buildNoShowEmail
} from "@/lib/core/outbound-templates";
import { getCampaignRepository } from "@/lib/integrations/campaigns";
import { sendSms } from "@/lib/integrations/clicksend";
import { sendEmail } from "@/lib/integrations/instantly";
import { getLeadRepository } from "@/lib/integrations/data";
import {
  combineMeetingDateTime,
  getLeadById,
  getSchedulerRebookLink,
  getSubCampaignContext,
  getTeamInstantlyWorkspaceId,
  hasCrossTeamConflict
} from "@/lib/integrations/leads.snowflake";
import { logger } from "@/lib/util/logger";

export const runtime = "nodejs";

export async function POST(
  _req: NextRequest,
  {
    params
  }: {
    params: { teamId: string; eventId: string; sourceLeadId: string };
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
  const sourceLeadId = decodeURIComponent(params.sourceLeadId);

  const repo = getLeadRepository();

  // If we've already cached this lead and it's past 'scheduled', short-circuit
  const existing = await repo.getLeadBySourceId(sourceLeadId);
  if (existing && existing.status !== "scheduled") {
    return NextResponse.json(
      { error: "invalid_state", currentStatus: existing.status },
      { status: 409 }
    );
  }

  const [snowflakeLead, campaign, subCampaignCtx] = await Promise.all([
    getLeadById(sourceLeadId),
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
      { error: "lead_has_no_phone", detail: "NUMBER_DIALED is null in the leads view for this lead" },
      { status: 422 }
    );
  }

  // Duplicate-phone guard: another campaign already has an active outreach to
  // this number. Silently suppress — cache the lead, mark no_show for the
  // client's dashboard, but do NOT send SMS. A cron will auto-cancel after 1h.
  const [activeForPhone, crossTeamConflict] = await Promise.all([
    repo.getActiveLeadByPhone(snowflakeLead.phone),
    hasCrossTeamConflict(snowflakeLead.phone, teamId)
  ]);
  const isSuppressed = !!activeForPhone || crossTeamConflict;

  // Resolve agent persona: sub-campaign AGENT_PERSONAS → ONSITE_CONTACT_NAME → lead OCM → env var
  const agentPersonaName =
    subCampaignCtx?.agentPersonaName
    || snowflakeLead.ocm
    || process.env.AGENT_PERSONA_NAME
    || null;

  const lead = await repo.cacheSnowflakeLead({
    sourceLeadId,
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

  // Mark as no_show either way so the client's dashboard looks normal
  await repo.updateLeadStatus(lead.id, "no_show");

  if (isSuppressed) {
    // Flag for auto-cancellation — no SMS, no conversation record
    await repo.suppressLead(lead.id);

    logger.info("noshow.suppressed", {
      leadId: lead.id,
      sourceLeadId,
      teamId: campaign.teamId,
      eventId: campaign.eventId,
      reason: activeForPhone ? "active_lead" : "cross_team",
      blockedByLeadId: activeForPhone?.id ?? null
    });

    return NextResponse.json({
      leadId: lead.id,
      sourceLeadId,
      status: "no_show",
      sms: { messageId: "suppressed", status: "suppressed" }
    });
  }

  // Normal path — resolve the native scheduler rebooking link (null when the
  // campaign has no active scheduler; only native scheduler links are sent).
  const rebookLink = await getSchedulerRebookLink(teamId, eventId, sourceLeadId);

  const senderCtx = {
    agentName: agentPersonaName,
    clientName: campaign.teamName
  };

  const body = buildFirstNoShowSms(
    { ...lead, nativeSchedulingLink: rebookLink ?? lead.nativeSchedulingLink },
    senderCtx
  );

  let sms;
  try {
    sms = await sendSms({ to: lead.phone, body, leadId: lead.id });
  } catch (err) {
    logger.error("noshow.snowflake.sms_failed", {
      leadId: lead.id,
      sourceLeadId,
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

  await repo.appendMessage({
    leadId: lead.id,
    direction: "outbound",
    text: body,
    messageType: "initial_outreach"
  });

  // Best-effort one-off email alongside the SMS. Never blocks the response.
  // Only email when we have a NATIVE scheduler rebooking link to send — the
  // email is a one-way nudge to self-serve booking, not a reply channel.
  const senderEmail = subCampaignCtx?.senderEmail ?? null;
  if (lead.email && senderEmail && rebookLink) {
    try {
      const workspaceId = await getTeamInstantlyWorkspaceId(campaign.teamId);
      const emailContent = buildNoShowEmail(lead, rebookLink, senderCtx);
      const emailResult = await sendEmail({
        eaccount: senderEmail,
        to: lead.email,
        subject: emailContent.subject,
        html: emailContent.html,
        leadId: lead.id,
        workspaceId
      });
      logger.info("noshow.email.sent", {
        leadId: lead.id,
        sourceLeadId,
        emailMessageId: emailResult.messageId,
        emailStatus: emailResult.status
      });
    } catch (err) {
      logger.error("noshow.email.failed", {
        leadId: lead.id,
        sourceLeadId,
        error: err instanceof Error ? err.message : String(err)
      });
    }
  } else {
    logger.info("noshow.email.skipped", {
      leadId: lead.id,
      sourceLeadId,
      hasEmail: !!lead.email,
      hasSender: !!senderEmail,
      hasLink: !!rebookLink
    });
  }

  logger.info("noshow.snowflake.marked", {
    leadId: lead.id,
    sourceLeadId,
    teamId: campaign.teamId,
    eventId: campaign.eventId,
    smsMessageId: sms.messageId,
    smsStatus: sms.status
  });

  return NextResponse.json({
    leadId: lead.id,
    sourceLeadId,
    status: "no_show",
    sms: { messageId: sms.messageId, status: sms.status }
  });
}
