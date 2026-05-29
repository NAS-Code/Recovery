import { NextResponse, type NextRequest } from "next/server";
import { waitUntil } from "@vercel/functions";
import { nextState } from "@/lib/core/conversation-state";
import type { ConversationMessage, LeadStatus } from "@/lib/core/types";
import { classifyConversation } from "@/lib/integrations/claude";
import { tryParseIsoDate } from "@/lib/util/format";
import {
  parseInboundWebhook,
  sendSms,
  type InboundSms
} from "@/lib/integrations/clicksend";
import { getLeadRepository } from "@/lib/integrations/data";
import { notifyFdeForReview } from "@/lib/integrations/slack";
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
    messageId: inbound.messageId
  });

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
