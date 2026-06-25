import { z } from "zod";
import { fetchWithTimeout } from "@/lib/util/fetch-with-timeout";
import { logger } from "@/lib/util/logger";

const CLICKSEND_BASE_URL = "https://rest.clicksend.com/v3";
const SMS_TIMEOUT_MS = 10_000;

export class ClicksendError extends Error {
  constructor(message: string, public cause?: unknown) {
    super(message);
    this.name = "ClicksendError";
  }
}

function getAuthHeader(): string {
  const username = process.env.CLICKSEND_USERNAME;
  const apiKey = process.env.CLICKSEND_API_KEY;
  if (!username || !apiKey) {
    throw new ClicksendError(
      "CLICKSEND_USERNAME and CLICKSEND_API_KEY must be set"
    );
  }
  return `Basic ${Buffer.from(`${username}:${apiKey}`).toString("base64")}`;
}

function getFromNumber(): string {
  const from = process.env.CLICKSEND_FROM_NUMBER;
  if (!from) throw new ClicksendError("CLICKSEND_FROM_NUMBER must be set");
  return from;
}

/** Reduce a phone number to comparable digits (last 10), ignoring +, spaces, punctuation. */
function normalizeNumber(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  return digits.length > 10 ? digits.slice(-10) : digits;
}

/**
 * The ClickSend number(s) this concierge instance owns. Two numbers are shared
 * across multiple workflows, so the inbound webhook must ignore any message
 * delivered to a number concierge does not operate on.
 *
 * Sourced from CONCIERGE_INBOUND_NUMBERS (comma-separated) if set, otherwise
 * falls back to the single CLICKSEND_FROM_NUMBER we send from.
 */
function getConciergeNumbers(): string[] {
  const list = process.env.CONCIERGE_INBOUND_NUMBERS;
  const raw = list
    ? list.split(",")
    : [process.env.CLICKSEND_FROM_NUMBER ?? ""];
  return raw.map((n) => normalizeNumber(n.trim())).filter((n) => n.length > 0);
}

/**
 * True when an inbound message was delivered to a concierge-owned number.
 * Returns true (fail-open) when the destination is unknown or no allowlist is
 * configured — the active-lead lookup remains the backstop in those cases.
 */
export function isConciergeInboundNumber(to: string | null): boolean {
  const allow = getConciergeNumbers();
  if (allow.length === 0) return true; // nothing configured → don't block
  if (!to) return true; // payload omitted the destination → can't filter here
  return allow.includes(normalizeNumber(to));
}

export interface SendSmsInput {
  to: string;
  body: string;
  /** Stamped on the outbound message; logged but NOT preserved on inbound replies. */
  leadId?: string;
}

export interface SendSmsResult {
  messageId: string | null;
  status: string;
  totalPrice: number | null;
}

export async function sendSms(input: SendSmsInput): Promise<SendSmsResult> {
  const auth = getAuthHeader();
  const from = getFromNumber();
  const startedAt = Date.now();

  logger.info("clicksend.send.start", {
    to: input.to,
    leadId: input.leadId,
    bodyLength: input.body.length
  });

  let response: Response;
  try {
    response = await fetchWithTimeout(`${CLICKSEND_BASE_URL}/sms/send`, {
      method: "POST",
      headers: {
        Authorization: auth,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        messages: [
          {
            source: "noshow-recovery",
            from,
            to: input.to,
            body: input.body,
            custom_string: input.leadId
          }
        ]
      }),
      timeoutMs: SMS_TIMEOUT_MS
    });
  } catch (err) {
    logger.error("clicksend.send.failed", {
      to: input.to,
      leadId: input.leadId,
      latencyMs: Date.now() - startedAt,
      error: err instanceof Error ? err.message : String(err)
    });
    throw new ClicksendError(
      `Clicksend request failed: ${err instanceof Error ? err.message : String(err)}`,
      err
    );
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    logger.error("clicksend.send.http_error", {
      to: input.to,
      leadId: input.leadId,
      status: response.status,
      latencyMs: Date.now() - startedAt,
      payload
    });
    throw new ClicksendError(
      `Clicksend returned HTTP ${response.status}`
    );
  }

  const result = extractSendResult(payload);

  logger.info("clicksend.send.ok", {
    to: input.to,
    leadId: input.leadId,
    latencyMs: Date.now() - startedAt,
    messageId: result.messageId,
    status: result.status
  });

  return result;
}

function extractSendResult(payload: unknown): SendSmsResult {
  const shape = z
    .object({
      data: z
        .object({
          total_price: z.number().optional(),
          messages: z
            .array(
              z.object({
                message_id: z.string().optional(),
                status: z.string().optional()
              })
            )
            .optional()
        })
        .optional()
    })
    .safeParse(payload);

  if (!shape.success) {
    return { messageId: null, status: "unknown", totalPrice: null };
  }

  const first = shape.data.data?.messages?.[0];
  return {
    messageId: first?.message_id ?? null,
    status: first?.status ?? "unknown",
    totalPrice: shape.data.data?.total_price ?? null
  };
}

export interface InboundSms {
  from: string;
  to: string | null;
  text: string;
  messageId: string | null;
  timestamp: Date;
  customString: string | null;
}

const inboundPayloadSchema = z
  .object({
    from: z.string().min(1),
    body: z.string(),
    to: z.string().optional(),
    message_id: z.string().optional(),
    customstring: z.string().nullable().optional(),
    custom_string: z.string().nullable().optional(),
    timestamp: z.union([z.string(), z.number()]).optional()
  })
  .passthrough();

export function parseInboundWebhook(raw: unknown): InboundSms {
  const parsed = inboundPayloadSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ClicksendError(
      `Invalid Clicksend inbound payload: ${parsed.error.message}`
    );
  }

  const { from, body, to, message_id, customstring, custom_string, timestamp } =
    parsed.data;

  return {
    from,
    to: to ?? null,
    text: body,
    messageId: message_id ?? null,
    timestamp: parseTimestamp(timestamp),
    customString: customstring ?? custom_string ?? null
  };
}

function parseTimestamp(raw: string | number | undefined): Date {
  if (raw === undefined) return new Date();
  const seconds = typeof raw === "string" ? Number.parseInt(raw, 10) : raw;
  if (!Number.isFinite(seconds)) return new Date();
  const ms = seconds > 1e12 ? seconds : seconds * 1000;
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? new Date() : d;
}
