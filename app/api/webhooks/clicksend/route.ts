import { NextResponse, type NextRequest } from "next/server";
import { waitUntil } from "@vercel/functions";
import { nextState } from "@/lib/core/conversation-state";
import type { ConversationMessage, Lead, LeadStatus } from "@/lib/core/types";
import { hasConflict } from "@/lib/core/availability";
import {
  buildRescheduleConflictSms,
  buildRescheduleHoldingSms
} from "@/lib/core/outbound-templates";
import { classifyConversation } from "@/lib/integrations/claude";
import { tryParseIsoDate } from "@/lib/util/format";
import { getLeadById } from "@/lib/integrations/leads.snowflake";
import { getCampaignMeetingTimes } from "@/lib/integrations/meetings";
import {
  isConciergeInboundNumber,
  parseInboundWebhook,
  sendSms,
  type InboundSms
} from "@/lib/integrations/clicksend";
import { getLeadRepository } from "@/lib/integrations/data";
import { notifyFdeForReview, notifyRebooked } from "@/lib/integrations/slack";
import { logger } from "@/lib/util/logger";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  let raw: unknown;
  try {
    raw = await readBody(req);
  } catch {
    return NextResponse.json({ error: "invalid_payload" }, { status: 400 });
  }

  let inbound: InboundSms;
  try {
    inbound = parseInboundWebhook(raw);
  } catch (err) {
    logger.warn("clicksend.webhook.invalid_payload", {
      error: err instanceof Error ? err.message : String(err)
    });
    return NextResponse.json({ ok: true });
  }

  logger.info("clicksend.webhook.received", {
    from: inbound.from,
    to: inbound.to,
    messageId: inbound.messageId
  });

  // Two ClickSend numbers are shared across workflows. Only handle messages
  // delivered to a concierge-owned number; ignore everything else so we never
  // reply to (or escalate) traffic that belongs to another workflow.
  if (!isConciergeInboundNumber(inbound.to)) {
    logger.info("clicksend.webhook.ignored_non_concierge_number", {
      to: inbound.to,
      messageId: inbound.messageId
    });
    return NextResponse.json({ ok: true });
  }

  waitUntil(processInbound(inbound));

  return NextResponse.json({ ok: true });
}

/**
 * Clicksend's "URL" inbound action posts form-urlencoded by default; their
 * "URL JSON" action posts JSON. Read the raw body once and normalize both
 * into a plain object the parser can consume.
 */
async function readBody(req: NextRequest): Promise<Record<string, unknown>> {
  const text = await req.text();
  if (!text) return {};
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" ? parsed : { _raw: parsed };
  } catch {
    const params = new URLSearchParams(text);
    return Object.fromEntries(params);
  }
}

async function processInbound(inbound: InboundSms): Promise<void> {
  const repo = getLeadRepository();
  const lead = await repo.getActiveLeadByPhone(inbound.from);

  if (!lead) {
    logger.warn("clicksend.webhook.no_active_lead", {
      from: inbound.from,
      messageId: inbound.messageId
    });
    return;
  }

  const priorHistory = await repo.getConversationHistory(lead.id);

  // Build a tentative full thread (with the new inbound) for classification, so
  // Claude reasons about state in light of the just-arrived message before we
  // commit it to the DB.
  const tentativeHistory: ConversationMessage[] = [
    ...priorHistory,
    {
      id: "pending",
      leadId: lead.id,
      direction: "inbound",
      text: inbound.text,
      timestamp: inbound.timestamp,
      claudeClassification: null,
      messageType: "inbound_reply"
    }
  ];

  const [event, client] = await Promise.all([
    repo.getCurrentEventForClient(lead.clientId),
    repo.getClient(lead.clientId)
  ]);

  // Agent persona: cached on Event from Snowflake sub-campaign → env fallback
  const senderCtx = {
    agentName: event?.agentPersonaName || process.env.AGENT_PERSONA_NAME || null,
    clientName: client?.name ?? null
  };

  let classification;
  try {
    classification = await classifyConversation({
      lead,
      history: tentativeHistory,
      event,
      ctx: senderCtx
    });
  } catch (err) {
    logger.error("clicksend.webhook.classify_failed", {
      leadId: lead.id,
      error: err instanceof Error ? err.message : String(err)
    });
    await repo.appendMessage({
      leadId: lead.id,
      direction: "inbound",
      text: inbound.text,
      timestamp: inbound.timestamp,
      messageType: "inbound_reply"
    });
    return;
  }

  await repo.appendMessage({
    leadId: lead.id,
    direction: "inbound",
    text: inbound.text,
    timestamp: inbound.timestamp,
    classification,
    messageType: "inbound_reply"
  });

  // Reschedule confirmations don't auto-confirm. In client-calendar mode we can't
  // see meetings booked outside the platform, so check the times we DO know for a
  // clash, then hold for the client to approve before telling the lead anything.
  const proposedTime =
    classification.category === "reschedule_at_event" &&
    classification.is_confirmation &&
    classification.confirmed_time
      ? tryParseIsoDate(classification.confirmed_time)
      : null;
  if (proposedTime) {
    await handleRescheduleProposal(lead, proposedTime);
    return;
  }

  const newStatus = nextState(lead.status, classification);
  if (newStatus !== lead.status) {
    await repo.updateLeadStatus(lead.id, newStatus);
    logger.info("clicksend.webhook.status_changed", {
      leadId: lead.id,
      from: lead.status,
      to: newStatus
    });
  }

  await maybeUpdateMeetingTime(repo, lead.id, newStatus, classification.confirmed_time);

  // Notify the team only on the transition *into* a confirmed state, not on
  // every later message while already confirmed.
  if (newStatus !== lead.status && RESCHEDULE_STATUSES.includes(newStatus)) {
    // Pull OCM/CSM names from Snowflake so we can tag them. Best-effort.
    const sf = lead.sourceLeadId
      ? await getLeadById(lead.sourceLeadId).catch(() => null)
      : null;
    await notifyRebooked({
      lead: { ...lead, status: newStatus },
      clientName: client?.name ?? null,
      eventName: event?.name ?? null,
      previousTime: lead.scheduledMeetingTime,
      meetingTime: classification.confirmed_time
        ? tryParseIsoDate(classification.confirmed_time)
        : null,
      timezone: event?.timezone,
      ocm: sf?.ocm,
      csm: sf?.csm
    });
  }

  if (classification.draft_reply) {
    await sendDraftReply({
      leadId: lead.id,
      phone: lead.phone,
      body: classification.draft_reply
    });
    return;
  }

  // No draft_reply — route to a human via Slack silently.
  // No auto-reply to the lead so the handoff feels natural.

  await notifyFdeForReview({
    lead: { ...lead, status: newStatus },
    history: tentativeHistory,
    reasoning: classification.reasoning,
    reason:
      classification.category === "context_question"
        ? "context_question"
        : "uncategorized"
  });
}

const RESCHEDULE_STATUSES: LeadStatus[] = [
  "confirmed_reschedule",
  "confirmed_virtual"
];

async function maybeUpdateMeetingTime(
  repo: ReturnType<typeof getLeadRepository>,
  leadId: string,
  newStatus: LeadStatus,
  confirmedTime: string | null
): Promise<void> {
  if (!confirmedTime) return;
  if (!RESCHEDULE_STATUSES.includes(newStatus)) return;

  const parsed = tryParseIsoDate(confirmedTime);
  if (!parsed) {
    logger.warn("clicksend.webhook.invalid_confirmed_time", {
      leadId,
      raw: confirmedTime
    });
    return;
  }

  await repo.updateScheduledMeetingTime(leadId, parsed);
  logger.info("clicksend.webhook.meeting_time_updated", {
    leadId,
    newTime: parsed.toISOString()
  });
}

/**
 * A reschedule time the lead proposed. We can't see the client's full calendar,
 * so: reject times that clash with meetings we DO know, otherwise hold the lead
 * and surface the time for client approval. Never confirms to the lead here.
 */
async function handleRescheduleProposal(
  lead: Lead,
  proposedTime: Date
): Promise<void> {
  const repo = getLeadRepository();

  // lead.clientId is the Snowflake teamId and lead.eventId the eventId (set by cacheSnowflakeLead).
  const known = lead.sourceLeadId
    ? await getCampaignMeetingTimes(
        lead.clientId,
        lead.eventId,
        lead.sourceLeadId
      ).catch(() => [] as Date[])
    : [];

  if (hasConflict(known, proposedTime)) {
    logger.info("clicksend.webhook.reschedule_conflict", {
      leadId: lead.id,
      proposed: proposedTime.toISOString()
    });
    if (lead.status !== "in_reschedule_convo") {
      await repo.updateLeadStatus(lead.id, "in_reschedule_convo");
    }
    await sendDraftReply({
      leadId: lead.id,
      phone: lead.phone,
      body: buildRescheduleConflictSms(lead)
    });
    return;
  }

  await repo.setProposedMeetingTime(lead.id, proposedTime); // → pending_client_approval
  logger.info("clicksend.webhook.reschedule_pending_approval", {
    leadId: lead.id,
    proposed: proposedTime.toISOString()
  });
  await sendDraftReply({
    leadId: lead.id,
    phone: lead.phone,
    body: buildRescheduleHoldingSms(lead)
  });
}

async function sendDraftReply(input: {
  leadId: string;
  phone: string;
  body: string;
}): Promise<void> {
  const repo = getLeadRepository();
  try {
    await sendSms({ to: input.phone, body: input.body, leadId: input.leadId });
  } catch (err) {
    logger.error("clicksend.webhook.reply_send_failed", {
      leadId: input.leadId,
      error: err instanceof Error ? err.message : String(err)
    });
    return;
  }

  await repo.appendMessage({
    leadId: input.leadId,
    direction: "outbound",
    text: input.body,
    messageType: "auto_reply"
  });
}
