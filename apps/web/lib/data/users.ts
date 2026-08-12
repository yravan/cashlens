import "server-only";
import { cache } from "react";
import { auth } from "@clerk/nextjs/server";
import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";

import { users } from "@/lib/db/schema";
import { withRequestScope, type ScopedTx } from "@/lib/db/scope";

export type CurrentUser = {
  id: string;
  clerkUserId: string;
  createdAt: Date;
};

function toCurrentUser(row: typeof users.$inferSelect): CurrentUser {
  return {
    id: row.id,
    clerkUserId: row.clerkUserId,
    createdAt: row.createdAt,
  };
}

async function findUser(tx: ScopedTx, clerkUserId: string) {
  const rows = await tx
    .select()
    .from(users)
    .where(eq(users.clerkUserId, clerkUserId));
  return rows[0];
}

// Idempotent first-contact provisioning: steady state is a pure read; the
// unique constraint plus ON CONFLICT DO NOTHING make concurrent first
// requests converge on one row.
async function ensureUser(clerkUserId: string): Promise<CurrentUser> {
  return withRequestScope(clerkUserId, async (tx) => {
    const found = await findUser(tx, clerkUserId);
    if (found) return toCurrentUser(found);

    const inserted = await tx
      .insert(users)
      .values({ clerkUserId })
      .onConflictDoNothing({ target: users.clerkUserId })
      .returning();
    if (inserted[0]) return toCurrentUser(inserted[0]);

    const raced = await findUser(tx, clerkUserId);
    if (!raced) throw new Error("user provisioning raced and lost the row");
    return toCurrentUser(raced);
  });
}

export const requireUser = cache(async (): Promise<CurrentUser> => {
  const { isAuthenticated, userId } = await auth();
  if (!isAuthenticated) redirect("/sign-in");
  return ensureUser(userId);
});
