import { handlePlaidWebhook, MAX_BODY_BYTES } from "@/lib/data/plaid-webhook";

export const maxDuration = 60;

// Public, unauthenticated by design: authentication is Plaid's ES256 signature
// over the exact raw bytes, so the body must be read verbatim before parsing.
export async function POST(request: Request) {
  const reader = request.body?.getReader();
  const decoder = new TextDecoder();
  let rawBody = "";
  let bytes = 0;
  if (reader) {
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > MAX_BODY_BYTES) {
          void reader.cancel().catch(() => {});
          return Response.json({ error: "too_large" }, { status: 413 });
        }
        rawBody += decoder.decode(value, { stream: true });
      }
      rawBody += decoder.decode();
    } catch {
      void reader.cancel().catch(() => {});
      return Response.json({ error: "invalid_body" }, { status: 400 });
    } finally {
      reader.releaseLock();
    }
  }
  return handlePlaidWebhook(rawBody, request.headers.get("plaid-verification"));
}
