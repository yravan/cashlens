import {
  ConnectionGoneError,
  DuplicateConnectionError,
  InvalidPublicTokenError,
  ProviderError,
  RateLimitedError,
  ReauthRequiredError,
} from "@/lib/data/plaid";

export const RETRY_AFTER_SECONDS = 60;

export function plaidErrorResponse(error: unknown): Response {
  if (error instanceof InvalidPublicTokenError) {
    return Response.json({ error: "invalid_public_token" }, { status: 400 });
  }
  if (error instanceof DuplicateConnectionError) {
    return Response.json({ error: "already_connected" }, { status: 409 });
  }
  if (error instanceof ReauthRequiredError) {
    return Response.json({ error: "reauth_required" }, { status: 409 });
  }
  if (error instanceof ConnectionGoneError) {
    return Response.json({ error: "connection_gone" }, { status: 410 });
  }
  if (error instanceof RateLimitedError) {
    return Response.json(
      { error: "rate_limited" },
      { status: 429, headers: { "retry-after": String(RETRY_AFTER_SECONDS) } },
    );
  }
  if (error instanceof ProviderError) {
    return Response.json({ error: "provider_error", message: error.displayMessage }, { status: 502 });
  }
  throw error;
}
