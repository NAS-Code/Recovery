import { WebClient, type KnownBlock } from "@slack/web-api";
import type { ConversationMessage, Lead } from "@/lib/core/types";
import { logger } from "@/lib/util/logger";

const MAX_THREAD_MESSAGES = 15;
const MESSAGE_TEXT_TRUNCATE = 280;

export class SlackError extends Error {
  constructor(message: string, public cause?: unknown) {
    super(message);
    this.name = "SlackError";
  }
}

export interface FdeReviewInput {
  lead: Lead;
  history: ConversationMessage[];
  reasoning: string;
  reason: "uncategorized" | "context_question" | "closed_lead_replied";
}

let cachedClient: WebClient | null = null;

function getClient(): WebClient {
  if (cachedClient) return cachedClient;
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) throw new SlackError("SLACK_BOT_TOKEN must be set");
  cachedClient = new WebClient(token);
  return cachedClient;
}

const reasonLabels: Record<FdeReviewInput["reason"], string> = {
  uncategorized: "Uncategorized — needs your judgment",
  context_question: "Lead asked a question only a human can answer",
  closed_lead_replied: "Closed lead replied"
};

export async function notifyFdeForReview(input: FdeReviewInput): Promise<void> {
  const channel = process.env.SLACK_DEFAULT_CHANNEL;
  if (!channel) {
    logger.warn("slack.notify_fde.no_channel", {
      leadId: input.lead.id,
      reason: input.reason
    });
    return;
  }

  if (!process.env.SLACK_BOT_TOKEN) {
    logger.warn("slack.notify_fde.no_token", {
      leadId: input.lead.id,
      reason: input.reason
    });
    return;
  }

  const fallbackText = `${input.lead.name} (${input.lead.company ?? "—"}) — ${reasonLabels[input.reason]}`;
  const blocks = buildReviewBlocks(input);

  try {
    await getClient().chat.postMessage({
      channel,
      text: fallbackText,
      blocks,
      unfurl_links: false,
      unfurl_media: false
    });
    logger.info("slack.notify_fde.sent", {
      leadId: input.lead.id,
      channel,
      reason: input.reason
    });
  } catch (err) {
    logger.error("slack.notify_fde.failed", {
      leadId: input.lead.id,
      channel,
      error: err instanceof Error ? err.message : String(err)
    });
  }
}

function buildReviewBlocks(input: FdeReviewInput): KnownBlock[] {
  const { lead, history, reason, reasoning } = input;
  const blocks: KnownBlock[] = [];

  if (lead.fdeOwnerSlackId) {
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: `<@${lead.fdeOwnerSlackId}> — this one needs your attention.` }
    });
  }

  blocks.push({
    type: "header",
    text: { type: "plain_text", text: reasonLabels[reason], emoji: true }
  });

  blocks.push({
    type: "section",
    fields: [
      { type: "mrkdwn", text: `*Lead*\n${lead.name}` },
      { type: "mrkdwn", text: `*Company*\n${lead.company ?? "—"}` },
      { type: "mrkdwn", text: `*Phone*\n${lead.phone}` },
      { type: "mrkdwn", text: `*Status*\n\`${lead.status}\`` }
    ]
  });

  blocks.push({
    type: "section",
    text: { type: "mrkdwn", text: `*Claude's reasoning*\n${reasoning}` }
  });

  blocks.push({ type: "divider" });

  const trimmed = history.slice(-MAX_THREAD_MESSAGES);
  const omitted = history.length - trimmed.length;
  if (omitted > 0) {
    blocks.push({
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: `_Showing the last ${trimmed.length} of ${history.length} messages_`
        }
      ]
    });
  }

  for (const m of trimmed) {
    const arrow = m.direction === "outbound" ? "→ us" : "← lead";
    const ts = m.timestamp.toISOString();
    const body =
      m.text.length > MESSAGE_TEXT_TRUNCATE
        ? `${m.text.slice(0, MESSAGE_TEXT_TRUNCATE)}…`
        : m.text;
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: `*${arrow}* · _${ts}_\n${body}` }
    });
  }

  const baseUrl = process.env.APP_BASE_URL;
  if (baseUrl) {
    blocks.push({ type: "divider" });
    blocks.push({
      type: "actions",
      elements: [
        {
          type: "button",
          text: { type: "plain_text", text: "Open in dashboard" },
          url: `${baseUrl}/dashboard/${lead.id}`,
          action_id: "open_dashboard"
        }
      ]
    });
  }

  return blocks;
}
