import { auth } from "@clerk/nextjs/server";

import { requireUser } from "@/lib/data/users";

export async function GET() {
  const { isAuthenticated } = await auth();
  if (!isAuthenticated) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const { id, createdAt } = await requireUser();
  return Response.json({ id, createdAt });
}
