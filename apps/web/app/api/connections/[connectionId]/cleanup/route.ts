import { guardPost } from "@/lib/api/guard";
import { plaidErrorResponse } from "@/lib/api/plaid-errors";
import { retryPlaidCleanup } from "@/lib/data/plaid";

export const maxDuration = 60;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ connectionId: string }> },
) {
  const denied = await guardPost(request);
  if (denied) return denied;

  const { connectionId } = await params;
  try {
    const cleaned = await retryPlaidCleanup(connectionId);
    if (!cleaned) return Response.json({ error: "not_found" }, { status: 404 });
    return Response.json({ cleaned: true });
  } catch (error) {
    return plaidErrorResponse(error);
  }
}
