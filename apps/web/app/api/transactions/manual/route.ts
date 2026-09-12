import { guardPost } from "@/lib/api/guard";
import { manualMutationResponse } from "@/lib/api/manual-transactions";
import { createManualTransaction } from "@/lib/data/manual-transactions";
import { parseManualTransactionInput } from "@/lib/ledger/manual-transactions";

export async function POST(request: Request) {
  const denied = await guardPost(request);
  if (denied) return denied;

  const parsed = parseManualTransactionInput(await request.json().catch(() => null));
  if (!parsed.ok) {
    return manualMutationResponse({ error: "invalid_request" }, 201);
  }
  return manualMutationResponse(await createManualTransaction(parsed.input), 201);
}
