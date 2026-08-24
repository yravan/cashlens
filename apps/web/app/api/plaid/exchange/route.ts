import { auth } from "@clerk/nextjs/server";

import { crossOrigin } from "@/lib/api/same-origin";
import {
  connectPlaidItem,
  DuplicateConnectionError,
  InvalidPublicTokenError,
  ProviderError,
} from "@/lib/data/plaid";

const PUBLIC_TOKEN_PATTERN = /^public-[A-Za-z0-9-]{1,250}$/;

export async function POST(request: Request) {
  const { isAuthenticated } = await auth();
  if (!isAuthenticated) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  if (crossOrigin(request)) {
    return Response.json({ error: "cross_origin" }, { status: 403 });
  }

  const body: unknown = await request.json().catch(() => null);
  const publicToken = (body as { publicToken?: unknown } | null)?.publicToken;
  if (typeof publicToken !== "string" || !PUBLIC_TOKEN_PATTERN.test(publicToken)) {
    return Response.json({ error: "invalid_request" }, { status: 400 });
  }

  try {
    const { connection, accounts } = await connectPlaidItem(publicToken);
    return Response.json({ connection, accounts });
  } catch (error) {
    if (error instanceof InvalidPublicTokenError) {
      return Response.json({ error: "invalid_public_token" }, { status: 400 });
    }
    if (error instanceof DuplicateConnectionError) {
      return Response.json({ error: "already_connected" }, { status: 409 });
    }
    if (error instanceof ProviderError) {
      return Response.json(
        { error: "provider_error", message: error.displayMessage },
        { status: 502 },
      );
    }
    throw error;
  }
}
