import type { ObligationMutation } from "@/lib/data/obligations";

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
  } catch {
    return Response.json({ error: "server_error" }, { status: 500 });
  }
}
