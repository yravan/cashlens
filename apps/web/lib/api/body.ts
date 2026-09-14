export async function readBodyCapped(request: Request, maxBytes: number): Promise<string | Response> {
  const reader = request.body?.getReader();
  if (!reader) return "";
  const decoder = new TextDecoder();
  let body = "";
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) return body + decoder.decode();
      bytes += value.byteLength;
      if (bytes > maxBytes) {
        void reader.cancel().catch(() => {});
        return Response.json({ error: "too_large" }, { status: 413 });
      }
      body += decoder.decode(value, { stream: true });
    }
  } catch {
    void reader.cancel().catch(() => {});
    return Response.json({ error: "invalid_body" }, { status: 400 });
  } finally {
    reader.releaseLock();
  }
}
