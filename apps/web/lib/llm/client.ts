import "server-only";
import Anthropic, {
  APIConnectionError,
  APIError,
  AuthenticationError,
  RateLimitError,
} from "@anthropic-ai/sdk";

import { errorClass } from "@/lib/log";
import {
  ASSIGNMENT_SCHEMA,
  classificationPrompt,
  InvalidClassificationError,
  parseAssignments,
  type ClassifyAssignment,
  type ClassifyItem,
} from "./classify";

export { InvalidClassificationError } from "./classify";
export type { ClassifyAssignment, ClassifyItem, Confidence } from "./classify";

export const CLASSIFY_MODEL = "claude-haiku-4-5";

export class LlmUnconfiguredError extends Error {}
export class LlmRateLimitedError extends Error {}
export class LlmUnavailableError extends Error {}

export function llmConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

// Raw provider errors may carry request configuration; only these sanitized
// classes — never the provider's error object or message — leave this module.
function sanitized(error: unknown): Error {
  if (error instanceof AuthenticationError) {
    return new LlmUnconfiguredError("provider rejected the credentials");
  }
  if (error instanceof RateLimitError) return new LlmRateLimitedError("provider rate limit");
  if (error instanceof APIConnectionError) return new LlmUnavailableError("provider unreachable");
  if (error instanceof APIError) {
    return error.status === 529
      ? new LlmRateLimitedError("provider overloaded")
      : new LlmUnavailableError(`provider error ${error.status ?? "unknown"}`);
  }
  return new LlmUnavailableError(errorClass(error));
}

export async function classifyTransactions(
  items: ClassifyItem[],
  categoryLabels: string[],
): Promise<ClassifyAssignment[]> {
  if (!llmConfigured()) throw new LlmUnconfiguredError("ANTHROPIC_API_KEY is not set");
  const { system, user } = classificationPrompt(items, categoryLabels);
  const client = new Anthropic({ maxRetries: 1, timeout: 30_000 });
  let response;
  try {
    response = await client.messages.create({
      model: CLASSIFY_MODEL,
      max_tokens: 200 + items.length * 60,
      temperature: 0,
      system,
      messages: [{ role: "user", content: user }],
      output_config: { format: { type: "json_schema", schema: ASSIGNMENT_SCHEMA } },
    });
  } catch (error) {
    throw sanitized(error);
  }
  if (response.stop_reason !== "end_turn") {
    throw new InvalidClassificationError(`classification stopped on ${response.stop_reason}`);
  }
  const text = response.content
    .flatMap((block) => (block.type === "text" ? [block.text] : []))
    .join("");
  return parseAssignments(text, items.length, categoryLabels.length);
}
