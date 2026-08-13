import "server-only";
import { cache } from "react";
import { auth } from "@clerk/nextjs/server";
import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";

import { withRequestScope, type ScopedTx } from "@/lib/db/client";
import { users } from "@/lib/db/schema";

async function findUser(tx: ScopedTx, clerkUserId: string) {
  const rows = await tx
    .select()
    .from(users)
    .where(eq(users.clerkUserId, clerkUserId));
  return rows[0];
}

export const requireUser = cache(async () => {
  const { isAuthenticated, userId } = await auth();
  if (!isAuthenticated) redirect("/sign-in");

  return withRequestScope(userId, async (tx) => {
    const found = await findUser(tx, userId);
    if (found) return found;

    const inserted = await tx
      .insert(users)
      .values({ clerkUserId: userId })
      .onConflictDoNothing({ target: users.clerkUserId })
      .returning();
    if (inserted[0]) return inserted[0];

    const raced = await findUser(tx, userId);
    if (!raced) throw new Error("user provisioning raced and lost the row");
    return raced;
  });
});
