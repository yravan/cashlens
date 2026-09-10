// The LLM substitute for the api suite, standing in at the transport's real
// seam: a loopback chat/completions server. Importing this module starts it and
// points OPENROUTER_BASE_URL at it, overriding setup.ts's fail-closed default —
// the production fetch path runs unchanged and nothing leaves the machine.
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

export type SubstituteChatRequest = {
  model: string;
  max_tokens: number;
  temperature?: number;
  messages: { role: string; content: string }[];
  response_format?: {
    type: string;
    json_schema?: { name?: string; strict?: boolean; schema?: Record<string, unknown> };
  };
  provider?: Record<string, unknown>;
};

export type RecordedClassification = {
  method: string | undefined;
  path: string | undefined;
  headers: Record<string, string | string[] | undefined>;
  body: SubstituteChatRequest;
};

export const classificationRequests: RecordedClassification[] = [];

type Primed =
  | { kind: "entries"; entries: unknown[]; finishReason: string }
  | { kind: "text"; text: string; finishReason: string }
  | { kind: "http"; status: number; body: unknown }
  | { kind: "body"; body: unknown }
  | { kind: "raw"; contentType: string; text: string }
  | { kind: "drop" };

const primed: Primed[] = [];
let beforeResponse: (() => Promise<void>) | null = null;

export function resetOpenRouterSubstitute(): void {
  classificationRequests.length = 0;
  primed.length = 0;
  beforeResponse = null;
}

export function primeClassification(entries: unknown[], finishReason = "stop"): void {
  primed.push({ kind: "entries", entries, finishReason });
}

export function primeClassificationText(text: string, finishReason = "stop"): void {
  primed.push({ kind: "text", text, finishReason });
}

export function failNextClassification(status: number, body?: unknown): void {
  primed.push({
    kind: "http",
    status,
    body: body ?? { error: { code: status, message: "upstream provider detail" } },
  });
}

// A 200 whose body is exactly `body` — the provider-failed-after-headers shape.
export function primeClassificationBody(body: unknown): void {
  primed.push({ kind: "body", body });
}

// A 200 whose body is not JSON at all — a gateway or proxy answering in place
// of the provider.
export function primeClassificationRaw(contentType: string, text: string): void {
  primed.push({ kind: "raw", contentType, text });
}

export function dropNextClassification(): void {
  primed.push({ kind: "drop" });
}

// Runs once after the next request is captured and before its response is
// returned — lets a test interleave a competing write mid-classification.
export function onceBeforeClassificationResponse(fn: () => Promise<void>): void {
  beforeResponse = fn;
}

const server = createServer((request, response) => {
  let raw = "";
  request.on("data", (chunk: Buffer) => {
    raw += chunk.toString("utf8");
  });
  request.on("end", () => {
    void (async () => {
      const body = JSON.parse(raw) as SubstituteChatRequest;
      classificationRequests.push({
        method: request.method,
        path: request.url,
        headers: request.headers,
        body,
      });
      const next = primed.shift();
      if (beforeResponse) {
        const hook = beforeResponse;
        beforeResponse = null;
        await hook();
      }
      if (!next) {
        console.error(
          "the OpenRouter substitute (tests/harness/openrouter.ts) has no primed response — prime one before invoking classification",
        );
        response.statusCode = 500;
        response.setHeader("content-type", "application/json");
        response.end(JSON.stringify({ error: { code: 500, message: "substitute unprimed" } }));
        return;
      }
      if (next.kind === "drop") {
        request.socket.destroy();
        return;
      }
      if (next.kind === "raw") {
        response.setHeader("content-type", next.contentType);
        response.end(next.text);
        return;
      }
      if (next.kind === "http" || next.kind === "body") {
        response.statusCode = next.kind === "http" ? next.status : 200;
        response.setHeader("content-type", "application/json");
        response.end(JSON.stringify(next.body));
        return;
      }
      const text = next.kind === "text" ? next.text : JSON.stringify({ results: next.entries });
      response.setHeader("content-type", "application/json");
      response.end(
        JSON.stringify({
          id: "gen-substitute",
          object: "chat.completion",
          created: 0,
          model: body.model,
          choices: [
            {
              index: 0,
              logprobs: null,
              message: { role: "assistant", content: text, refusal: null },
              finish_reason: next.finishReason,
              native_finish_reason: next.finishReason,
            },
          ],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }),
      );
    })();
  });
});

await new Promise<void>((resolve, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", resolve);
});
process.env.OPENROUTER_BASE_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1`;
server.unref();
