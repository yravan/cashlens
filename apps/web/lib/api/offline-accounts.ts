import type { OfflineAccountResult, StatementImportResult } from "@/lib/data/offline-accounts";

export function offlineAccountResponse(
  result: OfflineAccountResult | StatementImportResult,
  successStatus: 200 | 201 = 200,
): Response {
  if (!("error" in result)) return Response.json(result, { status: successStatus });
  return Response.json(result, { status: result.error === "invalid_request" ? 400 : 404 });
}
