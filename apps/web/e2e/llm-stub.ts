import { createServer } from "node:http";

// Anthropic Messages API stand-in for e2e: answers every classification batch
// deterministically (each transaction -> category 0, high confidence) so the
// suite runs zero-secret and network-free. Wired via ANTHROPIC_BASE_URL in
// playwright.config.ts whenever no real ANTHROPIC_API_KEY is present.
export function startLlmStub(port: number): Promise<() => Promise<void>> {
  const server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk: Buffer) => {
      body += chunk.toString("utf8");
    });
    request.on("end", () => {
      let results: unknown[] = [];
      try {
        const parsed = JSON.parse(body) as { messages: { content: string }[] };
        const payload = JSON.parse(parsed.messages[0].content) as {
          transactions: { id: number }[];
        };
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
          id: "msg_e2e_stub",
          type: "message",
          role: "assistant",
          model: "claude-haiku-4-5",
          content: [{ type: "text", text: JSON.stringify({ results }) }],
          stop_reason: "end_turn",
          stop_sequence: null,
          usage: { input_tokens: 1, output_tokens: 1 },
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
