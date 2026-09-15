import { guardPost } from "@/lib/api/guard";
import { obligationResponse, runObligationMutation } from "@/lib/api/obligations";
import { editObligation } from "@/lib/data/obligations";
import { parseObligationInput } from "@/lib/ledger/obligations";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ obligationId: string }> },
) {
  const denied = await guardPost(request);
  if (denied) return denied;

  const parsed = parseObligationInput(await request.json().catch(() => null));
  if (!parsed.ok) return obligationResponse({ error: "invalid_request" });

  const { obligationId } = await params;
  return runObligationMutation(() => editObligation(obligationId, parsed.input));
}
