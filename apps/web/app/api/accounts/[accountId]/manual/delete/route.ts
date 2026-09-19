import { guardPost } from "@/lib/api/guard";
import { offlineAccountResponse } from "@/lib/api/offline-accounts";
import { deleteOfflineAccount } from "@/lib/data/offline-accounts";
import { isEmptyMutationBody } from "@/lib/ledger/manual-transactions";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ accountId: string }> },
) {
  const denied = await guardPost(request);
  if (denied) return denied;

  const body: unknown = await request.json().catch(() => null);
  if (!isEmptyMutationBody(body)) return offlineAccountResponse({ error: "invalid_request" });

  const { accountId } = await params;
  return offlineAccountResponse(await deleteOfflineAccount(accountId));
}
