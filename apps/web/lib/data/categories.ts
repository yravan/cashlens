import "server-only";
import { and, asc, count, eq, isNull, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import { UUID_PATTERN } from "@/lib/crypto/credentials";
import { requireUser } from "@/lib/data/users";
import { withRequestScope, type ScopedTx } from "@/lib/db/client";
import { categories, transactions } from "@/lib/db/schema";
import { DEFAULT_CATEGORIES } from "@/lib/ledger/default-categories";

export type CategoryGroup = {
  id: string;
  name: string;
  categories: { id: string; name: string }[];
};

export type CategoryAssignment =
  | { error: "transaction_not_found" | "category_not_found" | "category_not_assignable" }
  | { transactionId: string; categoryId: string | null };

// Concurrent first reads may both plant: conflicts no-op on the per-level
// unique names, and parents are re-read so children attach to whichever
// insert won.
async function plantDefaults(tx: ScopedTx, userId: string): Promise<void> {
  await tx
    .insert(categories)
    .values(DEFAULT_CATEGORIES.map(({ group }, index) => ({ userId, name: group, sortOrder: index })))
    .onConflictDoNothing();
  const roots = await tx
    .select({ id: categories.id, name: categories.name })
    .from(categories)
    .where(and(eq(categories.userId, userId), isNull(categories.parentId)));
  const rootId = new Map(roots.map((root) => [root.name, root.id]));
  const leaves = DEFAULT_CATEGORIES.flatMap(({ group, categories: names }) => {
    const parentId = rootId.get(group);
    if (!parentId) return [];
    return names.map((name, index) => ({ userId, parentId, name, sortOrder: index }));
  });
  await tx.insert(categories).values(leaves).onConflictDoNothing();
}

export async function listCategoryGroups(): Promise<CategoryGroup[]> {
  const user = await requireUser();
  return withRequestScope(user.clerkUserId, async (tx) => {
    const [existing] = await tx
      .select({ n: count() })
      .from(categories)
      .where(eq(categories.userId, user.id));
    if (existing.n === 0) await plantDefaults(tx, user.id);

    const rows = await tx
      .select({ id: categories.id, parentId: categories.parentId, name: categories.name })
      .from(categories)
      .where(eq(categories.userId, user.id))
      .orderBy(asc(categories.sortOrder), asc(categories.name), asc(categories.id));

    const groups = new Map<string, CategoryGroup>(
      rows
        .filter((row) => row.parentId === null)
        .map((row) => [row.id, { id: row.id, name: row.name, categories: [] }]),
    );
    for (const row of rows) {
      if (row.parentId !== null) {
        groups.get(row.parentId)?.categories.push({ id: row.id, name: row.name });
      }
    }
    return [...groups.values()];
  });
}

export async function setTransactionCategory(
  transactionId: string,
  categoryId: string | null,
): Promise<CategoryAssignment> {
  const user = await requireUser();
  if (!UUID_PATTERN.test(transactionId)) return { error: "transaction_not_found" };
  if (categoryId !== null && !UUID_PATTERN.test(categoryId)) return { error: "category_not_found" };

  return withRequestScope(user.clerkUserId, async (tx) => {
    if (categoryId !== null) {
      const children = alias(categories, "children");
      const [target] = await tx
        .select({ children: count(children.id) })
        .from(categories)
        .leftJoin(children, eq(children.parentId, categories.id))
        .where(and(eq(categories.id, categoryId), eq(categories.userId, user.id)))
        .groupBy(categories.id);
      if (!target) return { error: "category_not_found" as const };
      if (target.children > 0) return { error: "category_not_assignable" as const };
    }

    const [updated] = await tx
      .update(transactions)
      .set({ categoryId, updatedAt: sql`now()` })
      .where(and(eq(transactions.id, transactionId), eq(transactions.userId, user.id)))
      .returning({ id: transactions.id, categoryId: transactions.categoryId });
    if (!updated) return { error: "transaction_not_found" as const };
    return { transactionId: updated.id, categoryId: updated.categoryId };
  });
}
