import { guardPost } from "@/lib/api/guard";
import { manualMutationResponse } from "@/lib/api/manual-transactions";
import { deleteManualTransaction } from "@/lib/data/manual-transactions";
import { isEmptyMutationBody } from "@/lib/ledger/manual-transactions";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ transactionId: string }> },
) {
  const denied = await guardPost(request);
  if (denied) return denied;

  const body: unknown = await request.json().catch(() => null);
  if (!isEmptyMutationBody(body)) {
    return manualMutationResponse({ error: "invalid_request" }, 200);
  }

  const { transactionId } = await params;
  return manualMutationResponse(await deleteManualTransaction(transactionId), 200);
}
