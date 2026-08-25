import { guardPost } from "@/lib/api/guard";
import { plaidErrorResponse } from "@/lib/api/plaid-errors";
import { advanceBackfill } from "@/lib/data/plaid-sync";

export const maxDuration = 60;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ connectionId: string }> },
) {
  const denied = await guardPost(request);
  if (denied) return denied;

  const { connectionId } = await params;
  try {
    const step = await advanceBackfill(connectionId);
    if (!step) return Response.json({ error: "not_found" }, { status: 404 });
    return Response.json(step);
  } catch (error) {
    return plaidErrorResponse(error);
  }
}
