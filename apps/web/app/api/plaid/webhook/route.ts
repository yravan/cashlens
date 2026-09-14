import { readBodyCapped } from "@/lib/api/body";
import { handlePlaidWebhook, MAX_BODY_BYTES } from "@/lib/data/plaid-webhook";

export const maxDuration = 60;

// Public, unauthenticated by design: authentication is Plaid's ES256 signature
// over the exact raw bytes, so the body must be read verbatim before parsing.
export async function POST(request: Request) {
  const rawBody = await readBodyCapped(request, MAX_BODY_BYTES);
  if (rawBody instanceof Response) return rawBody;
  return handlePlaidWebhook(rawBody, request.headers.get("plaid-verification"));
}
