import { fetchWithTimeout } from "@/lib/util/fetch-with-timeout";
import { logger } from "@/lib/util/logger";

const INSTANTLY_BASE_URL = "https://api.instantly.ai/api/v2";
const EMAIL_TIMEOUT_MS = 15_000;

export class InstantlyError extends Error {
  constructor(message: string, public cause?: unknown) {
    super(message);
    this.name = "InstantlyError";
  }
}

function getApiKey(): string {
  const key = process.env.INSTANTLY_API_KEY;
  if (!key) throw new InstantlyError("INSTANTLY_API_KEY must be set");
  return key;
}

export interface SendEmailInput {
  to: string;
  subject: string;
  body: string;
  /** Optional Instantly campaign ID to attribute the send to. */
  campaignId?: string;
  /** Optional opaque string echoed back in webhooks. */
  leadId?: string;
}

export interface SendEmailResult {
  messageId: string | null;
  status: string;
}

export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  const apiKey = getApiKey();
  const startedAt = Date.now();

  logger.info("instantly.send.start", {
    to: input.to,
    leadId: input.leadId,
    bodyLength: input.body.length
  });

  let response: Response;
  try {
    response = await fetchWithTimeout(`${INSTANTLY_BASE_URL}/emails`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        to: input.to,
        subject: input.subject,
        body: input.body,
        campaign_id: input.campaignId,
        custom_variables: input.leadId ? { lead_id: input.leadId } : undefined
      }),
      timeoutMs: EMAIL_TIMEOUT_MS
    });
  } catch (err) {
    logger.error("instantly.send.failed", {
      to: input.to,
      leadId: input.leadId,
      latencyMs: Date.now() - startedAt,
      error: err instanceof Error ? err.message : String(err)
    });
    throw new InstantlyError(
      `Instantly request failed: ${err instanceof Error ? err.message : String(err)}`,
      err
    );
  }

  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    // Instantly may return empty body on 204
  }

  if (!response.ok) {
    logger.error("instantly.send.http_error", {
      to: input.to,
      leadId: input.leadId,
      status: response.status,
      latencyMs: Date.now() - startedAt,
      payload
    });
    throw new InstantlyError(`Instantly returned HTTP ${response.status}`);
  }

  const result = extractResult(payload);

  logger.info("instantly.send.ok", {
    to: input.to,
    leadId: input.leadId,
    latencyMs: Date.now() - startedAt,
    messageId: result.messageId,
    status: result.status
  });

  return result;
}

function extractResult(payload: unknown): SendEmailResult {
  if (payload && typeof payload === "object") {
    const p = payload as Record<string, unknown>;
    const messageId =
      (typeof p.id === "string" && p.id) ||
      (typeof p.email_id === "string" && p.email_id) ||
      (typeof p.message_id === "string" && p.message_id) ||
      null;
    const status =
      (typeof p.status === "string" && p.status) ||
      (typeof p.state === "string" && p.state) ||
      "queued";
    return { messageId, status };
  }
  return { messageId: null, status: "queued" };
}
