import { guardPost } from "@/lib/api/guard";
import { llmErrorResponse } from "@/lib/api/llm-errors";
import { autoCategorizeBatch } from "@/lib/data/auto-categorize";

export const maxDuration = 60;

export async function POST(request: Request) {
  const denied = await guardPost(request);
  if (denied) return denied;

  try {
    return Response.json(await autoCategorizeBatch());
  } catch (error) {
    return llmErrorResponse(error);
  }
}
