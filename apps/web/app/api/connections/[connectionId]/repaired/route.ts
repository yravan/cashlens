import { guardPost } from "@/lib/api/guard";
import { markConnectionRepaired } from "@/lib/data/plaid";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ connectionId: string }> },
) {
  const denied = await guardPost(request);
  if (denied) return denied;

  const { connectionId } = await params;
  const cleared = await markConnectionRepaired(connectionId);
  if (!cleared) return Response.json({ error: "not_found" }, { status: 404 });
  return Response.json({ repaired: true });
}
