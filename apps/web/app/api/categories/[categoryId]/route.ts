import { categoryResponse } from "@/lib/api/categories";
import { guardPost } from "@/lib/api/guard";
import { updateCategory } from "@/lib/data/categories";
import { parseCategoryEdit } from "@/lib/ledger/categories";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ categoryId: string }> },
) {
  const denied = await guardPost(request);
  if (denied) return denied;

  const parsed = parseCategoryEdit(await request.json().catch(() => null));
  if (!parsed.ok) return categoryResponse({ error: "invalid_request" });

  const { categoryId } = await params;
  return categoryResponse(await updateCategory(categoryId, parsed.input));
}
