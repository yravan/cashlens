import { guardPost } from "@/lib/api/guard";
import { matchTransfers } from "@/lib/data/transfers";

export async function POST(request: Request) {
  const denied = await guardPost(request);
  if (denied) return denied;

  return Response.json(await matchTransfers());
}
