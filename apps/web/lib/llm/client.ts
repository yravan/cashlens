import "server-only";
import { createHash } from "node:crypto";

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

const DEFAULT_MODEL = "anthropic/claude-haiku-4.5";
const DEFAULT_BASE_URL = "https://openrouter.ai/api/v1";
const TIMEOUT_MS = 30_000;
const PROMPT_VERSION = "classification-prompt-v1";
const ASSIGNMENT_SCHEMA_VERSION = "transaction-classification-v1";
const PROVIDER_POLICY = { data_collection: "deny", require_parameters: true } as const;

export class LlmUnconfiguredError extends Error {}
export class LlmRateLimitedError extends Error {}
export class LlmUnavailableError extends Error {}

export function llmConfigured(): boolean {
  return Boolean(process.env.OPENROUTER_API_KEY);
}

// The pinned provider controls below only bind on requests that actually reach
// OpenRouter, so the base-URL override exists solely for the test substitutes.
const LOOPBACK = new Set(["127.0.0.1", "[::1]", "localhost"]);

function baseUrl(): string {
  const override = process.env.OPENROUTER_BASE_URL;
  if (!override) return DEFAULT_BASE_URL;
  const hostname = URL.parse(override)?.hostname;
  if (!hostname || !LOOPBACK.has(hostname)) {
    throw new LlmUnconfiguredError("OPENROUTER_BASE_URL may only name a loopback substitute");
  }
  return override;
}

// Provider error bodies may quote user input back (moderation metadata) and
// carry upstream detail; only these sanitized classes — never a provider
// message, body, or metadata — leave this module.
function errorForCode(code: unknown): Error {
  if (code === 401) return new LlmUnconfiguredError("provider rejected the credentials");
  if (code === 402) return new LlmUnconfiguredError("provider account is out of credits");
  if (code === 429) return new LlmRateLimitedError("provider rate limit");
  return new LlmUnavailableError(`provider error ${typeof code === "number" ? code : "unknown"}`);
}

type ChatCompletion = {
  id?: unknown;
  model?: unknown;
  usage?: { prompt_tokens?: unknown; completion_tokens?: unknown };
  error?: { code?: unknown };
  choices?: {
    error?: { code?: unknown };
    finish_reason?: unknown;
    message?: { content?: unknown };
  }[];
};

export type ClassificationRequest = {
  requestedModel: string;
  promptVersion: string;
  assignmentSchemaVersion: string;
  providerPolicyFingerprint: string;
  classify: (items: ClassifyItem[], categoryLabels: string[]) => Promise<ClassificationResult>;
};

export type ClassificationMetadata = {
  responseModel: string | null;
  providerGenerationId: string | null;
  providerInputTokens: number | null;
  providerOutputTokens: number | null;
};

export type ClassificationResult = {
  assignments: ClassifyAssignment[];
  metadata: ClassificationMetadata;
};

const sha256 = (value: string): string => createHash("sha256").update(value).digest("hex");

export function captureClassificationRequest(): ClassificationRequest {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new LlmUnconfiguredError("OPENROUTER_API_KEY is not set");
  const requestedModel = process.env.LLM_MODEL || DEFAULT_MODEL;
  if (requestedModel.length < 1 || requestedModel.length > 200) {
    throw new LlmUnconfiguredError("LLM_MODEL must be between 1 and 200 characters");
  }
  const endpoint = `${baseUrl()}/chat/completions`;
  const identity = {
    requestedModel,
    promptVersion: PROMPT_VERSION,
    assignmentSchemaVersion: ASSIGNMENT_SCHEMA_VERSION,
    providerPolicyFingerprint: sha256(JSON.stringify(PROVIDER_POLICY)),
  };
  return {
    ...identity,
    classify: (items, categoryLabels) =>
      classifyTransactions(items, categoryLabels, { requestedModel, endpoint, apiKey }),
  };
}

const boundedText = (value: unknown): string | null =>
  typeof value === "string" && value.length >= 1 && value.length <= 200 ? value : null;

const tokenCount = (value: unknown): number | null =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= 2_147_483_647
    ? value
    : null;

function contentText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .flatMap((part: unknown) => {
      const text = (part as { text?: unknown } | null)?.text;
      return typeof text === "string" ? [text] : [];
    })
    .join("");
}

async function classifyTransactions(
  items: ClassifyItem[],
  categoryLabels: string[],
  transport: { requestedModel: string; endpoint: string; apiKey: string },
): Promise<ClassificationResult> {
  const { system, user } = classificationPrompt(items, categoryLabels);

  let response: Response;
  try {
    response = await fetch(transport.endpoint, {
      method: "POST",
      headers: { authorization: `Bearer ${transport.apiKey}`, "content-type": "application/json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      body: JSON.stringify({
        model: transport.requestedModel,
        max_tokens: 200 + items.length * 60,
        temperature: 0,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "transaction_classification",
            strict: true,
            schema: ASSIGNMENT_SCHEMA,
          },
        },
        provider: PROVIDER_POLICY,
      }),
    });
  } catch (error) {
    throw new LlmUnavailableError(errorClass(error));
  }
  if (!response.ok) throw errorForCode(response.status);

  let completion: ChatCompletion;
  try {
    completion = (await response.json()) as ChatCompletion;
  } catch {
    throw new LlmUnavailableError("malformed provider response");
  }
  const choice = completion.choices?.[0];
  // A provider failure after headers arrives as a 200 whose body carries only
  // an error object, or a choice with an embedded error (OpenRouter errors doc).
  if (!choice) throw errorForCode(completion.error?.code);
  if (choice.error) throw errorForCode(choice.error.code);
  if (choice.finish_reason !== "stop") {
    throw new InvalidClassificationError(`classification stopped on ${String(choice.finish_reason)}`);
  }
  return {
    assignments: parseAssignments(contentText(choice.message?.content), items.length, categoryLabels.length),
    metadata: {
      responseModel: boundedText(completion.model),
      providerGenerationId: boundedText(completion.id),
      providerInputTokens: tokenCount(completion.usage?.prompt_tokens),
      providerOutputTokens: tokenCount(completion.usage?.completion_tokens),
    },
  };
}
