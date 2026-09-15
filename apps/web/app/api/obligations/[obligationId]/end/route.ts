import { guardPost } from "@/lib/api/guard";
import { obligationResponse, runObligationMutation } from "@/lib/api/obligations";
import { endObligation } from "@/lib/data/obligations";
import { parseObligationEndInput } from "@/lib/ledger/obligations";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ obligationId: string }> },
) {
  const denied = await guardPost(request);
  if (denied) return denied;

  const body: unknown = await request.json().catch(() => null);
  if (!parseObligationEndInput(body)) {
    return obligationResponse({ error: "invalid_request" });
  }

  const { obligationId } = await params;
  return runObligationMutation(() => endObligation(obligationId));
}
