import { guardPost } from "@/lib/api/guard";
import { plaidErrorResponse } from "@/lib/api/plaid-errors";
import { disconnectPlaidConnection } from "@/lib/data/plaid";

export const maxDuration = 60;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ connectionId: string }> },
) {
  const denied = await guardPost(request);
  if (denied) return denied;

  const body: unknown = await request.json().catch(() => null);
  const purge = (body as { purge?: unknown } | null)?.purge ?? false;
  if (typeof purge !== "boolean") {
    return Response.json({ error: "invalid_request" }, { status: 400 });
  }

  const { connectionId } = await params;
  try {
    const result = await disconnectPlaidConnection(connectionId, purge);
    if (!result) return Response.json({ error: "not_found" }, { status: 404 });
    return Response.json({ disconnected: true, purgedAccounts: result.purgedAccounts });
  } catch (error) {
    return plaidErrorResponse(error);
  }
}
