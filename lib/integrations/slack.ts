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

// Cached workspace directory: normalized name → Slack member ID. Built once per
// process from users.list (names rarely change); refetched only on a miss.
// ponytail: in-memory cache, no TTL. Add a TTL if staff churn outpaces deploys.
let directory: Map<string, string> | null = null;

async function loadDirectory(force = false): Promise<Map<string, string>> {
  if (directory && !force) return directory;
  const map = new Map<string, string>();
  let cursor: string | undefined;
  do {
    const res = await getClient().users.list({ limit: 200, cursor });
    for (const m of res.members ?? []) {
      if (!m.id || m.deleted || m.is_bot) continue;
      // Index every name variant so a Snowflake "Heidi Kim" or a display name "Jared" both hit.
      for (const n of [m.profile?.real_name, m.profile?.display_name, m.real_name, m.name]) {
        if (n?.trim()) map.set(n.trim().toLowerCase(), m.id);
      }
    }
    cursor = res.response_metadata?.next_cursor || undefined;
  } while (cursor);
  directory = map;
  return map;
}

/** Resolve a person's name to a Slack `<@id>` mention, or the plain name if not found. */
async function resolveMention(name: string | null | undefined): Promise<string> {
  if (!name?.trim()) return "";
  const key = name.trim().toLowerCase();
  try {
    let dir = await loadDirectory();
    let id = dir.get(key);
    if (!id) {
      dir = await loadDirectory(true); // miss → refetch once in case they were just added
      id = dir.get(key);
    }
    if (id) return `<@${id}>`;
  } catch {
    // missing users:read scope or API error → fall back to plain name
  }
  return name.trim();
}

/** Format like "6/18 11:45am PST" in the given IANA timezone. */
function fmtMeeting(d: Date | null, timezone?: string): string {
  if (!d) return "TBD";
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZoneName: "short"
  }).formatToParts(d);
  const p = (t: string) => parts.find((x) => x.type === t)?.value ?? "";
  const ampm = p("dayPeriod").toLowerCase().replace(/\s/g, "");
  return `${p("month")}/${p("day")} ${p("hour")}:${p("minute")}${ampm} ${p("timeZoneName")}`;
}

/** Ping the team when a lead confirms a rebooking (reschedule or virtual). */
export async function notifyRebooked(input: {
  lead: Lead;
  clientName: string | null;
  eventName: string | null;
  previousTime: Date | null;
  meetingTime: Date | null;
  timezone?: string;
  ocm?: string | null;
  csm?: string | null;
}): Promise<void> {
  // ponytail: env override defaults to the default channel; swap for test/prod without redeploy
  const channel =
    process.env.SLACK_REBOOKED_CHANNEL ?? process.env.SLACK_DEFAULT_CHANNEL;
  if (!process.env.SLACK_BOT_TOKEN || !channel) {
    logger.warn("slack.notify_rebooked.no_token", { leadId: input.lead.id });
    return;
  }

  const newTime = fmtMeeting(input.meetingTime, input.timezone);
  const when = input.previousTime
    ? `${fmtMeeting(input.previousTime, input.timezone)} :point_right: ${newTime}`
    : newTime;

  // Tag the OCM and CSM (dedup if they're the same person).
  const names = [input.ocm, input.csm].filter(Boolean) as string[];
  const resolved = (
    await Promise.all([...new Set(names)].map(resolveMention))
  ).filter(Boolean);
  const cc = resolved.length ? `\n${resolved.join(" ")}` : "";

  const header = `${input.lead.name} | ${input.clientName ?? "—"} | ${input.eventName ?? "—"}`;
  const text = `:repeat: ${header} - Rebooked Meeting - ${when}${cc}`;

  try {
    await getClient().chat.postMessage({
      channel,
      text,
      unfurl_links: false,
      unfurl_media: false
    });
    logger.info("slack.notify_rebooked.sent", { leadId: input.lead.id, channel });
  } catch (err) {
    logger.error("slack.notify_rebooked.failed", {
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
