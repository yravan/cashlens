import { guardPost } from "@/lib/api/guard";
import { unlinkTransferPair } from "@/lib/data/transfers";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ pairId: string }> },
) {
  const denied = await guardPost(request);
  if (denied) return denied;

  const { pairId } = await params;
  if (!(await unlinkTransferPair(pairId))) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }
  return Response.json({ ok: true });
}
