import type { ManualMutationResult } from "@/lib/data/manual-transactions";

export function manualMutationResponse(
  result: ManualMutationResult,
  successStatus: 200 | 201,
): Response {
  if (!("error" in result)) {
    return Response.json(result, { status: successStatus });
  }

  const status =
    result.error === "invalid_request"
      ? 400
      : result.error === "category_not_assignable"
        ? 422
        : 404;
  return Response.json(result, { status });
}
