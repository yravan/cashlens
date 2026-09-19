import { categoryResponse } from "@/lib/api/categories";
import { guardPost } from "@/lib/api/guard";
import { createCategory } from "@/lib/data/categories";
import { parseCategoryCreate } from "@/lib/ledger/categories";

export async function POST(request: Request) {
  const denied = await guardPost(request);
  if (denied) return denied;

  const parsed = parseCategoryCreate(await request.json().catch(() => null));
  if (!parsed.ok) return categoryResponse({ error: "invalid_request" });
  return categoryResponse(await createCategory(parsed.input), 201);
}
