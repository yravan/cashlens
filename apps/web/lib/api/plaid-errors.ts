import {
  DuplicateConnectionError,
  InvalidPublicTokenError,
  ProviderError,
} from "@/lib/data/plaid";

export function plaidErrorResponse(error: unknown): Response {
  if (error instanceof InvalidPublicTokenError) {
    return Response.json({ error: "invalid_public_token" }, { status: 400 });
  }
  if (error instanceof DuplicateConnectionError) {
    return Response.json({ error: "already_connected" }, { status: 409 });
  }
  if (error instanceof ProviderError) {
    return Response.json({ error: "provider_error", message: error.displayMessage }, { status: 502 });
  }
  throw error;
}
