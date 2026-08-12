import { auth } from "@clerk/nextjs/server";

import { requireUser } from "@/lib/data/users";

export async function GET() {
  // The proxy is only an optimistic gate (CVE-2025-29927) — re-check here.
  const { isAuthenticated } = await auth();
  if (!isAuthenticated) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const user = await requireUser();
  return Response.json({ id: user.id, createdAt: user.createdAt });
}
