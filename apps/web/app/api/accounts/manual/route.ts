import { guardPost } from "@/lib/api/guard";
import { offlineAccountResponse } from "@/lib/api/offline-accounts";
import { createOfflineAccount } from "@/lib/data/offline-accounts";
import { parseOfflineAccountInput } from "@/lib/ledger/offline-accounts";

export async function POST(request: Request) {
  const denied = await guardPost(request);
  if (denied) return denied;

  const parsed = parseOfflineAccountInput(await request.json().catch(() => null));
  if (!parsed.ok) return offlineAccountResponse({ error: "invalid_request" });

  return offlineAccountResponse(await createOfflineAccount(parsed.input), 201);
}
