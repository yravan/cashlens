import { guardPost } from "@/lib/api/guard";
import { setTransactionCategory } from "@/lib/data/categories";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ transactionId: string }> },
) {
  const denied = await guardPost(request);
  if (denied) return denied;

  const body: unknown = await request.json().catch(() => null);
  const categoryId = (body as { categoryId?: unknown } | null)?.categoryId;
  if (categoryId !== null && typeof categoryId !== "string") {
    return Response.json({ error: "invalid_request" }, { status: 400 });
  }

  const { transactionId } = await params;
  const result = await setTransactionCategory(transactionId, categoryId);
  if ("error" in result) {
    return Response.json(result, {
      status: result.error === "category_not_assignable" ? 422 : 404,
    });
  }
  return Response.json(result);
}
