import { guardPost } from "@/lib/api/guard";
import { plaidErrorResponse } from "@/lib/api/plaid-errors";
import { createRepairToken } from "@/lib/data/plaid";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ connectionId: string }> },
) {
  const denied = await guardPost(request);
  if (denied) return denied;

  const { connectionId } = await params;
  try {
    const linkToken = await createRepairToken(connectionId);
    if (!linkToken) return Response.json({ error: "not_found" }, { status: 404 });
    return Response.json({ linkToken });
  } catch (error) {
    return plaidErrorResponse(error);
  }
}
