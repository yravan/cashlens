import { guardPost } from "@/lib/api/guard";
import { plaidErrorResponse } from "@/lib/api/plaid-errors";
import { connectPlaidItem } from "@/lib/data/plaid";

const PUBLIC_TOKEN_PATTERN = /^public-[A-Za-z0-9-]{1,250}$/;

export async function POST(request: Request) {
  const denied = await guardPost(request);
  if (denied) return denied;

  const body: unknown = await request.json().catch(() => null);
  const publicToken = (body as { publicToken?: unknown } | null)?.publicToken;
  if (typeof publicToken !== "string" || !PUBLIC_TOKEN_PATTERN.test(publicToken)) {
    return Response.json({ error: "invalid_request" }, { status: 400 });
  }

  try {
    return Response.json(await connectPlaidItem(publicToken));
  } catch (error) {
    return plaidErrorResponse(error);
  }
}
