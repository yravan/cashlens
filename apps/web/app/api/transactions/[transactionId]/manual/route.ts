import { guardPost } from "@/lib/api/guard";
import { manualMutationResponse } from "@/lib/api/manual-transactions";
import { updateManualTransaction } from "@/lib/data/manual-transactions";
import { parseManualTransactionInput } from "@/lib/ledger/manual-transactions";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ transactionId: string }> },
) {
  const denied = await guardPost(request);
  if (denied) return denied;

  const parsed = parseManualTransactionInput(await request.json().catch(() => null));
  if (!parsed.ok) {
    return manualMutationResponse({ error: "invalid_request" }, 200);
  }

  const { transactionId } = await params;
  return manualMutationResponse(
    await updateManualTransaction(transactionId, parsed.input),
    200,
  );
}
