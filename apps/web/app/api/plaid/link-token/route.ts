import { auth } from "@clerk/nextjs/server";

import { crossOrigin } from "@/lib/api/same-origin";
import { createLinkTokenForUser, ProviderError } from "@/lib/data/plaid";

export async function POST(request: Request) {
  const { isAuthenticated } = await auth();
  if (!isAuthenticated) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  if (crossOrigin(request)) {
    return Response.json({ error: "cross_origin" }, { status: 403 });
  }

  try {
    return Response.json({ linkToken: await createLinkTokenForUser() });
  } catch (error) {
    if (error instanceof ProviderError) {
      return Response.json(
        { error: "provider_error", message: error.displayMessage },
        { status: 502 },
      );
    }
    throw error;
  }
}
