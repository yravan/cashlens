import type { ObligationMutation } from "@/lib/data/obligations";
import { errorClass, logEvent } from "@/lib/log";

const STATUS = {
  invalid_request: 400,
  account_not_found: 404,
  obligation_not_found: 404,
} as const;

export function obligationResponse(
  result: ObligationMutation | { error: "invalid_request" },
  successStatus: 200 | 201 = 200,
): Response {
  if (!("error" in result)) return Response.json(result, { status: successStatus });
  return Response.json(result, { status: STATUS[result.error] });
}

export async function runObligationMutation(
  action: () => Promise<ObligationMutation>,
  successStatus: 200 | 201 = 200,
): Promise<Response> {
  try {
    return obligationResponse(await action(), successStatus);
  } catch (error) {
    logEvent("obligation_mutation.run_failed", { errorClass: errorClass(error) });
    return Response.json({ error: "server_error" }, { status: 500 });
  }
}
