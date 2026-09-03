// vitest.config.mts aliases `@anthropic-ai/sdk` to this file for the api suite.

export type SubstituteMessageRequest = {
  model: string;
  max_tokens: number;
  temperature?: number;
  system?: string;
  messages: { role: string; content: string }[];
  output_config?: { format?: { type: string; schema: Record<string, unknown> } };
};

export class APIError extends Error {
  constructor(
    readonly status: number | undefined,
    message: string,
  ) {
    super(message);
  }
}
export class AuthenticationError extends APIError {
  constructor() {
    super(401, "invalid x-api-key");
  }
}
export class RateLimitError extends APIError {
  constructor() {
    super(429, "rate limited");
  }
}
export class InternalServerError extends APIError {}
export class APIConnectionError extends APIError {
  constructor() {
    super(undefined, "Connection error.");
  }
}

export const classificationRequests: SubstituteMessageRequest[] = [];
export const clientOptions: Record<string, unknown>[] = [];

type Primed =
  | { kind: "entries"; entries: unknown[]; stopReason: string }
  | { kind: "text"; text: string; stopReason: string }
  | { kind: "error"; error: Error };

const primed: Primed[] = [];
let beforeResponse: (() => Promise<void>) | null = null;

export function resetAnthropicSubstitute(): void {
  classificationRequests.length = 0;
  clientOptions.length = 0;
  primed.length = 0;
  beforeResponse = null;
}

export function primeClassification(entries: unknown[], stopReason = "end_turn"): void {
  primed.push({ kind: "entries", entries, stopReason });
}

export function primeClassificationText(text: string, stopReason = "end_turn"): void {
  primed.push({ kind: "text", text, stopReason });
}

export function failNextClassification(error: Error): void {
  primed.push({ kind: "error", error });
}

// Runs once after the next request is captured and before its response is
// returned — lets a test interleave a competing write mid-classification.
export function onceBeforeClassificationResponse(fn: () => Promise<void>): void {
  beforeResponse = fn;
}

export default class Anthropic {
  constructor(options: Record<string, unknown> = {}) {
    clientOptions.push(options);
  }

  messages = {
    create: async (request: SubstituteMessageRequest) => {
      classificationRequests.push(request);
      const next = primed.shift();
      if (!next) {
        throw new Error(
          "the Anthropic substitute (tests/harness/anthropic.ts) has no primed response — prime one before invoking classification",
        );
      }
      if (beforeResponse) {
        const hook = beforeResponse;
        beforeResponse = null;
        await hook();
      }
      if (next.kind === "error") throw next.error;
      const text = next.kind === "text" ? next.text : JSON.stringify({ results: next.entries });
      return {
        id: "msg_substitute",
        type: "message",
        role: "assistant",
        model: request.model,
        content: [{ type: "text", text }],
        stop_reason: next.stopReason,
        stop_sequence: null,
        usage: { input_tokens: 1, output_tokens: 1 },
      };
    },
  };
}
