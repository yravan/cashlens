import { createServer } from "node:http";

// OpenRouter chat/completions stand-in for e2e: answers every classification
// batch deterministically (each transaction -> category 0, high confidence) so
// the suite runs zero-secret and network-free. Wired via OPENROUTER_BASE_URL in
// playwright.config.ts whenever no real OPENROUTER_API_KEY is present.
export function startLlmStub(port: number): Promise<() => Promise<void>> {
  const server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk: Buffer) => {
      body += chunk.toString("utf8");
    });
    request.on("end", () => {
      let results: unknown[] = [];
      let model = "";
      try {
        const parsed = JSON.parse(body) as { model?: string; messages: { role: string; content: string }[] };
        model = parsed.model ?? "";
        const user = parsed.messages.find((message) => message.role === "user");
        const payload = JSON.parse(user!.content) as { transactions: { id: number }[] };
        results = payload.transactions.map((row) => ({
          item: row.id,
          category: 0,
          confidence: "high",
          reason: "e2e stub pick",
        }));
      } catch {
        // an unrecognized request classifies nothing — the app sees a
        // no-progress batch and stops
      }
      response.setHeader("content-type", "application/json");
      response.end(
        JSON.stringify({
          id: "gen-e2e-stub",
          object: "chat.completion",
          created: 0,
          model,
          choices: [
            {
              index: 0,
              logprobs: null,
              message: { role: "assistant", content: JSON.stringify({ results }), refusal: null },
              finish_reason: "stop",
              native_finish_reason: "stop",
            },
          ],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }),
      );
    });
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      resolve(
        () =>
          new Promise((closed) => {
            server.close(() => closed());
          }),
      );
    });
  });
}
