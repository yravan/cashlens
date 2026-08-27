import { guardPost } from "@/lib/api/guard";
import { plaidErrorResponse } from "@/lib/api/plaid-errors";
import { abandonPlaidItem, PUBLIC_TOKEN_PATTERN } from "@/lib/data/plaid";

export async function POST(request: Request) {
  const denied = await guardPost(request);
  if (denied) return denied;

  const body: unknown = await request.json().catch(() => null);
  const publicToken = (body as { publicToken?: unknown } | null)?.publicToken;
  if (typeof publicToken !== "string" || !PUBLIC_TOKEN_PATTERN.test(publicToken)) {
    return Response.json({ error: "invalid_request" }, { status: 400 });
  }

  try {
    await abandonPlaidItem(publicToken);
    return Response.json({ abandoned: true });
  } catch (error) {
    return plaidErrorResponse(error);
  }
}
