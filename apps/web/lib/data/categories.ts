import "server-only";
import { and, asc, count, eq, isNull, ne, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import { UUID_PATTERN } from "@/lib/crypto/credentials";
import { requireUser } from "@/lib/data/users";
import { withRequestScope, type ScopedTx } from "@/lib/db/client";
import { categories, transactions } from "@/lib/db/schema";
import type { CategoryCreateInput, CategoryEditInput } from "@/lib/ledger/categories";
import { DEFAULT_CATEGORIES } from "@/lib/ledger/default-categories";

export type CategoryGroup = {
  id: string;
  name: string;
  categories: { id: string; name: string }[];
};

export type CategoryLeaf = { id: string; name: string; retiredAt: Date | null };
export type CategoryNode = CategoryLeaf & { categories: CategoryLeaf[] };

export type CategoryAssignment =
  | { error: "transaction_not_found" | "category_not_found" | "category_not_assignable" }
  | { transactionId: string; categoryId: string | null };

export type CategoryMutationError =
  | "category_not_found"
  | "parent_not_found"
  | "has_children"
  | "name_taken";
export type CategoryMutation = { categoryId: string } | { error: CategoryMutationError };

function ownCategories(tx: ScopedTx, userId: string) {
  return tx
    .select({
      id: categories.id,
      parentId: categories.parentId,
      name: categories.name,
      retiredAt: categories.retiredAt,
    })
    .from(categories)
    .where(eq(categories.userId, userId))
    .orderBy(asc(categories.sortOrder), asc(categories.name), asc(categories.id));
}

// Concurrent first reads may both plant: conflicts no-op on the per-level
// unique names, and parents are re-read so children attach to whichever
// insert won.
async function plantDefaults(tx: ScopedTx, userId: string): Promise<void> {
  await tx
    .insert(categories)
    .values(DEFAULT_CATEGORIES.map(({ group }, index) => ({ userId, name: group, sortOrder: index })))
    .onConflictDoNothing();
  const planted = await ownCategories(tx, userId);
  const rootId = new Map(
    planted.filter((row) => row.parentId === null).map((row) => [row.name, row.id]),
  );
  const leaves = DEFAULT_CATEGORIES.flatMap(({ group, categories: names }) => {
    const parentId = rootId.get(group);
    if (!parentId) return [];
    return names.map((name, index) => ({ userId, parentId, name, sortOrder: index }));
  });
  await tx.insert(categories).values(leaves).onConflictDoNothing();
}

export async function categoryTreeFor(tx: ScopedTx, userId: string): Promise<CategoryNode[]> {
  let rows = await ownCategories(tx, userId);
  if (rows.length === 0) {
    await plantDefaults(tx, userId);
    rows = await ownCategories(tx, userId);
  }

  const roots = new Map<string, CategoryNode>(
    rows
      .filter((row) => row.parentId === null)
      .map((row) => [row.id, { id: row.id, name: row.name, retiredAt: row.retiredAt, categories: [] }]),
  );
  for (const row of rows) {
    if (row.parentId !== null) {
      roots
        .get(row.parentId)
        ?.categories.push({ id: row.id, name: row.name, retiredAt: row.retiredAt });
    }
  }
  return [...roots.values()];
}

export async function categoryGroupsFor(tx: ScopedTx, userId: string): Promise<CategoryGroup[]> {
  return (await categoryTreeFor(tx, userId)).map((group) => ({
    id: group.id,
    name: group.name,
    categories: group.categories.map(({ id, name }) => ({ id, name })),
  }));
}

export async function listCategoryGroups(): Promise<CategoryGroup[]> {
  const user = await requireUser();
  return withRequestScope(user.clerkUserId, (tx) => categoryGroupsFor(tx, user.id));
}

export async function listCategoryTree(): Promise<CategoryNode[]> {
  const user = await requireUser();
  return withRequestScope(user.clerkUserId, (tx) => categoryTreeFor(tx, user.id));
}

const lockTaxonomy = (tx: ScopedTx) => tx.execute(sql`select public.app_lock_category_taxonomy()`);

const ownCategory = (categoryId: string, userId: string) =>
  and(eq(categories.id, categoryId), eq(categories.userId, userId));

const siblingsOf = (parentId: string | null) =>
  parentId === null ? isNull(categories.parentId) : eq(categories.parentId, parentId);

async function childCount(tx: ScopedTx, userId: string, categoryId: string): Promise<number | null> {
  const children = alias(categories, "children");
  const [target] = await tx
    .select({ children: count(children.id) })
    .from(categories)
    .leftJoin(children, eq(children.parentId, categories.id))
    .where(ownCategory(categoryId, userId))
    .groupBy(categories.id);
  return target?.children ?? null;
}

async function ownGroupExists(tx: ScopedTx, userId: string, parentId: string): Promise<boolean> {
  if (!UUID_PATTERN.test(parentId)) return false;
  const [parent] = await tx
    .select({ id: categories.id })
    .from(categories)
    .where(and(ownCategory(parentId, userId), isNull(categories.parentId)));
  return parent !== undefined;
}

export async function createCategory(input: CategoryCreateInput): Promise<CategoryMutation> {
  const user = await requireUser();

  return withRequestScope(user.clerkUserId, async (tx) => {
    await lockTaxonomy(tx);
    if ((await tx.$count(categories, eq(categories.userId, user.id))) === 0) {
      await plantDefaults(tx, user.id);
    }
    if (input.parentId !== null && !(await ownGroupExists(tx, user.id, input.parentId))) {
      return { error: "parent_not_found" as const };
    }

    const [{ sortOrder }] = await tx
      .select({ sortOrder: sql`coalesce(max(${categories.sortOrder}), -1) + 1`.mapWith(Number) })
      .from(categories)
      .where(and(eq(categories.userId, user.id), siblingsOf(input.parentId)));
    const [created] = await tx
      .insert(categories)
      .values({ userId: user.id, parentId: input.parentId, name: input.name, sortOrder })
      .onConflictDoNothing()
      .returning({ id: categories.id });
    return created ? { categoryId: created.id } : { error: "name_taken" as const };
  });
}

export async function updateCategory(
  categoryId: string,
  input: CategoryEditInput,
): Promise<CategoryMutation> {
  const user = await requireUser();
  if (!UUID_PATTERN.test(categoryId)) return { error: "category_not_found" };

  return withRequestScope(user.clerkUserId, async (tx) => {
    await lockTaxonomy(tx);
    const children = await childCount(tx, user.id, categoryId);
    if (children === null) return { error: "category_not_found" as const };
    if (input.parentId !== null) {
      if (input.parentId === categoryId || !(await ownGroupExists(tx, user.id, input.parentId))) {
        return { error: "parent_not_found" as const };
      }
      if (children > 0) return { error: "has_children" as const };
    }
    const [clash] = await tx
      .select({ id: categories.id })
      .from(categories)
      .where(
        and(
          eq(categories.userId, user.id),
          siblingsOf(input.parentId),
          eq(categories.name, input.name),
          ne(categories.id, categoryId),
        ),
      );
    if (clash) return { error: "name_taken" as const };

    const [updated] = await tx
      .update(categories)
      .set({
        name: input.name,
        parentId: input.parentId,
        retiredAt: input.retired ? sql`coalesce(${categories.retiredAt}, now())` : null,
        updatedAt: sql`now()`,
      })
      .where(ownCategory(categoryId, user.id))
      .returning({ id: categories.id });
    return updated ? { categoryId: updated.id } : { error: "category_not_found" as const };
  });
}

export type ResolvedAssignableCategory =
  | { ok: true; categoryId: string | null }
  | { ok: false; error: "category_not_found" | "category_not_assignable" };

export async function resolveAssignableCategory(
  tx: ScopedTx,
  userId: string,
  categoryId: string | null,
): Promise<ResolvedAssignableCategory> {
  if (categoryId === null) return { ok: true, categoryId };
  if (!UUID_PATTERN.test(categoryId)) return { ok: false, error: "category_not_found" };

  const children = await childCount(tx, userId, categoryId);
  if (children === null) return { ok: false, error: "category_not_found" };
  if (children > 0) return { ok: false, error: "category_not_assignable" };
  return { ok: true, categoryId };
}

export async function setTransactionCategory(
  transactionId: string,
  categoryId: string | null,
): Promise<CategoryAssignment> {
  const user = await requireUser();
  if (!UUID_PATTERN.test(transactionId)) return { error: "transaction_not_found" };

  return withRequestScope(user.clerkUserId, async (tx) => {
    const category = await resolveAssignableCategory(tx, user.id, categoryId);
    if (!category.ok) return { error: category.error };

    const [updated] = await tx
      .update(transactions)
      .set({
        categoryId,
        categorySource: categoryId === null ? null : "user",
        categoryConfidence: null,
        categoryReason: null,
        categoryRunId: null,
        categoryRevision: sql`${transactions.categoryRevision} + 1`,
        updatedAt: sql`now()`,
      })
      .where(and(eq(transactions.id, transactionId), eq(transactions.userId, user.id)))
      .returning({ id: transactions.id, categoryId: transactions.categoryId });
    if (!updated) return { error: "transaction_not_found" as const };
    return { transactionId: updated.id, categoryId: updated.categoryId };
  });
}
