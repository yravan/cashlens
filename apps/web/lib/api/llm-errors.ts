import {
  InvalidClassificationError,
  LlmRateLimitedError,
  LlmUnavailableError,
  LlmUnconfiguredError,
} from "@/lib/data/auto-categorize";

export const LLM_RETRY_AFTER_SECONDS = 30;

export function llmErrorResponse(error: unknown): Response {
  if (error instanceof LlmUnconfiguredError) {
    return Response.json({ error: "llm_unconfigured" }, { status: 503 });
  }
  if (error instanceof LlmRateLimitedError) {
    return Response.json(
      { error: "llm_rate_limited" },
      { status: 429, headers: { "retry-after": String(LLM_RETRY_AFTER_SECONDS) } },
    );
  }
  if (error instanceof LlmUnavailableError || error instanceof InvalidClassificationError) {
    return Response.json({ error: "llm_unavailable" }, { status: 502 });
  }
  throw error;
}
