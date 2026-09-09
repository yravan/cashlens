import { guardPost } from "@/lib/api/guard";
import { parseStreamIdentity, setRecurringStatus } from "@/lib/data/recurring";

export async function POST(request: Request) {
  const denied = await guardPost(request);
  if (denied) return denied;

  const body: unknown = await request.json().catch(() => null);
  const identity = parseStreamIdentity(body);
  const status = (body as { status?: unknown } | null)?.status;
  if (identity === null || (status !== "confirmed" && status !== "dismissed")) {
    return Response.json({ error: "invalid_request" }, { status: 400 });
  }

  if (!(await setRecurringStatus(identity, status))) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }
  return Response.json({ ok: true });
}
