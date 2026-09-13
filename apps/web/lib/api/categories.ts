import type { CategoryMutation, CategoryMutationError } from "@/lib/data/categories";

const STATUS: Record<CategoryMutationError | "invalid_request", number> = {
  invalid_request: 400,
  category_not_found: 404,
  parent_not_found: 404,
  has_children: 409,
  name_taken: 409,
};

export function categoryResponse(
  result: CategoryMutation | { error: "invalid_request" },
  successStatus: 200 | 201 = 200,
): Response {
  if (!("error" in result)) return Response.json(result, { status: successStatus });
  return Response.json(result, { status: STATUS[result.error] });
}
