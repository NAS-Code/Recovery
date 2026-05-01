import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import {
  CLASSIFIER_SYSTEM_PROMPT,
  CLASSIFIER_TOOL,
  CLASSIFIER_TOOL_NAME,
  buildClassifierUserMessage
} from "@/lib/core/classifier-prompts";
import type {
  ClaudeClassification,
  ConversationMessage,
  Lead
} from "@/lib/core/types";
import { logger } from "@/lib/util/logger";

const DEFAULT_MODEL = "claude-sonnet-4-6";
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_TOKENS = 1024;

const classificationSchema = z.object({
  category: z.enum([
    "reschedule_at_event",
    "virtual_meeting",
    "context_question",
    "not_interested",
    "uncategorized"
  ]),
  is_confirmation: z.boolean(),
  reasoning: z.string(),
  draft_reply: z.string().nullable()
});

export class ClassifierError extends Error {
  constructor(message: string, public cause?: unknown) {
    super(message);
    this.name = "ClassifierError";
  }
}

export function parseClassification(toolInput: unknown): ClaudeClassification {
  const result = classificationSchema.safeParse(toolInput);
  if (!result.success) {
    throw new ClassifierError(
      `Claude returned an invalid classification: ${result.error.message}`,
      result.error
    );
  }
  return result.data;
}

let cachedClient: Anthropic | null = null;

function getClient(): Anthropic {
  if (cachedClient) return cachedClient;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new ClassifierError("ANTHROPIC_API_KEY is not set");
  cachedClient = new Anthropic({ apiKey });
  return cachedClient;
}

export interface ClassifyInput {
  lead: Lead;
  history: ConversationMessage[];
}

export async function classifyConversation(
  input: ClassifyInput
): Promise<ClaudeClassification> {
  const client = getClient();
  const model = process.env.CLAUDE_MODEL ?? DEFAULT_MODEL;
  const userMessage = buildClassifierUserMessage(input.lead, input.history);

  const startedAt = Date.now();
  logger.info("claude.classify.start", {
    leadId: input.lead.id,
    historyLength: input.history.length,
    model
  });

  let response: Anthropic.Messages.Message;
  try {
    response = await client.messages.create(
      {
        model,
        max_tokens: DEFAULT_MAX_TOKENS,
        system: [
          {
            type: "text",
            text: CLASSIFIER_SYSTEM_PROMPT,
            cache_control: { type: "ephemeral" }
          }
        ],
        tools: [CLASSIFIER_TOOL as Anthropic.Messages.Tool],
        tool_choice: { type: "tool", name: CLASSIFIER_TOOL_NAME },
        messages: [{ role: "user", content: userMessage }]
      },
      { timeout: DEFAULT_TIMEOUT_MS }
    );
  } catch (err) {
    logger.error("claude.classify.failed", {
      leadId: input.lead.id,
      latencyMs: Date.now() - startedAt,
      error: err instanceof Error ? err.message : String(err)
    });
    throw new ClassifierError(
      `Claude API call failed: ${err instanceof Error ? err.message : String(err)}`,
      err
    );
  }

  const toolUse = response.content.find(
    (block): block is Anthropic.Messages.ToolUseBlock =>
      block.type === "tool_use" && block.name === CLASSIFIER_TOOL_NAME
  );

  if (!toolUse) {
    logger.error("claude.classify.no_tool_use", {
      leadId: input.lead.id,
      stopReason: response.stop_reason
    });
    throw new ClassifierError(
      "Claude did not return a classify_and_draft tool call"
    );
  }

  const classification = parseClassification(toolUse.input);

  logger.info("claude.classify.ok", {
    leadId: input.lead.id,
    latencyMs: Date.now() - startedAt,
    category: classification.category,
    isConfirmation: classification.is_confirmation,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
    cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
    cacheCreationTokens: response.usage.cache_creation_input_tokens ?? 0
  });

  return classification;
}
