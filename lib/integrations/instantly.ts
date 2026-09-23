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

/**
 * The parent (agency) key authenticates every send; the target client's
 * workspace is selected per-request via the `x-as-workspace` header. One key covers all sub-workspaces.
 */
function getApiKey(): string {
  const key = (
    process.env.Instantly_API_Key_Full_Email_Create ??
    process.env.INSTANTLY_API_KEY ??
    ""
  ).trim();
  if (!key) {
    throw new InstantlyError(
      "No Instantly API key — set Instantly_API_Key_Full_Email_Create"
    );
  }
  return key;
}

export interface SendEmailInput {
  /** A connected sending account in the workspace (the "from" address). */
  eaccount: string;
  to: string;
  subject: string;
  /** HTML email body. */
  html: string;
  /** Optional opaque string for logging correlation. */
  leadId?: string;
  /** Client's Instantly sub-workspace id — routes the send via x-as-workspace. */
  workspaceId?: string | null;
}

export interface SendEmailResult {
  messageId: string | null;
  status: string;
}

/**
 * Send a one-off email via Instantly's /emails/test endpoint. Instantly v2 has
 * no plain transactional send — /emails/test delivers a real email to arbitrary
 * recipients without needing a campaign. The agency key + x-as-workspace header
 * scopes the send to the client's workspace.
 */
export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  const apiKey = getApiKey();
  const startedAt = Date.now();

  logger.info("instantly.send.start", {
    to: input.to,
    eaccount: input.eaccount,
    workspaceId: input.workspaceId ?? null,
    leadId: input.leadId,
    bodyLength: input.html.length
  });

  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json"
  };
  if (input.workspaceId) headers["x-as-workspace"] = input.workspaceId;

  let response: Response;
  try {
    response = await fetchWithTimeout(`${INSTANTLY_BASE_URL}/emails/test`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        eaccount: input.eaccount,
        to_address_email_list: input.to,
        subject: input.subject,
        body: { html: input.html }
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
