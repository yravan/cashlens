import { guardPost } from "@/lib/api/guard";
import { offlineAccountResponse } from "@/lib/api/offline-accounts";
import { renameOfflineAccount } from "@/lib/data/offline-accounts";
import { parseRenameInput } from "@/lib/ledger/offline-accounts";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ accountId: string }> },
) {
  const denied = await guardPost(request);
  if (denied) return denied;

  const parsed = parseRenameInput(await request.json().catch(() => null));
  if (!parsed.ok) return offlineAccountResponse({ error: "invalid_request" });

  const { accountId } = await params;
  return offlineAccountResponse(await renameOfflineAccount(accountId, parsed.input));
}
