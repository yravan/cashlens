import { readBodyCapped } from "@/lib/api/body";
import { guardPost } from "@/lib/api/guard";
import { offlineAccountResponse } from "@/lib/api/offline-accounts";
import { importStatementRows } from "@/lib/data/offline-accounts";
import { MAX_IMPORT_BODY_BYTES, parseStatementImportInput } from "@/lib/ledger/statement-import";

const parseJson = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

export async function POST(
  request: Request,
  { params }: { params: Promise<{ accountId: string }> },
) {
  const denied = await guardPost(request);
  if (denied) return denied;

  const body = await readBodyCapped(request, MAX_IMPORT_BODY_BYTES);
  if (body instanceof Response) return body;
  const parsed = parseStatementImportInput(parseJson(body));
  if (!parsed.ok) return offlineAccountResponse({ error: "invalid_request" });

  const { accountId } = await params;
  return offlineAccountResponse(await importStatementRows(accountId, parsed.input));
}
