import { guardPost } from "@/lib/api/guard";
import { plaidErrorResponse } from "@/lib/api/plaid-errors";
import { createLinkTokenForUser } from "@/lib/data/plaid";

export async function POST(request: Request) {
  const denied = await guardPost(request);
  if (denied) return denied;

  try {
    return Response.json({ linkToken: await createLinkTokenForUser() });
  } catch (error) {
    return plaidErrorResponse(error);
  }
}
