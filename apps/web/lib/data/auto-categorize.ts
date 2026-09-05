import "server-only";
import { and, count, desc, eq, isNull, sql } from "drizzle-orm";

import { categoryGroupsFor } from "@/lib/data/categories";
import { requireUser } from "@/lib/data/users";
import { withRequestScope, type ScopedTx } from "@/lib/db/client";
import { transactions, transferPairs } from "@/lib/db/schema";
import { classifyTransactions } from "@/lib/llm/client";
import { errorClass, logEvent } from "@/lib/log";

export {
  InvalidClassificationError,
  llmConfigured,
  LlmRateLimitedError,
  LlmUnavailableError,
  LlmUnconfiguredError,
} from "@/lib/llm/client";

export const BATCH_LIMIT = 40;

export type AutoCategorizeStep = { attempted: number; categorized: number; remaining: number };

// An actively paired row is a transfer (3.3.1), not spend — it needs no
// category; unlinking re-admits it. The same predicate guards the write, so a
// row paired mid-classification is skipped like a concurrent manual pick.
const unpaired = sql`not exists (
  select 1 from ${transferPairs}
  where ${transferPairs.dismissedAt} is null
    and (${transferPairs.outflowTransactionId} = ${transactions.id}
      or ${transferPairs.inflowTransactionId} = ${transactions.id})
)`;

const uncategorized = (userId: string) =>
  and(eq(transactions.userId, userId), isNull(transactions.categoryId), unpaired);

async function remainingCount(tx: ScopedTx, userId: string): Promise<number> {
  const [row] = await tx.select({ n: count() }).from(transactions).where(uncategorized(userId));
  return row.n;
}

export async function uncategorizedCount(): Promise<number> {
  const user = await requireUser();
  return withRequestScope(user.clerkUserId, (tx) => remainingCount(tx, user.id));
}

export async function autoCategorizeBatch(): Promise<AutoCategorizeStep> {
  const user = await requireUser();

  const { leaves, batch, remaining } = await withRequestScope(user.clerkUserId, async (tx) => {
    const groups = await categoryGroupsFor(tx, user.id);
    const leaves = groups.flatMap((group) =>
      group.categories.map((leaf) => ({ id: leaf.id, label: `${group.name} > ${leaf.name}` })),
    );
    const batch = await tx
      .select({
        id: transactions.id,
        description: transactions.description,
        merchant: transactions.merchant,
        amountMinor: transactions.amountMinor,
      })
      .from(transactions)
      .where(uncategorized(user.id))
      .orderBy(desc(transactions.date), desc(transactions.createdAt), desc(transactions.id))
      .limit(BATCH_LIMIT);
    return { leaves, batch, remaining: await remainingCount(tx, user.id) };
  });
  if (batch.length === 0 || leaves.length === 0) {
    return { attempted: 0, categorized: 0, remaining };
  }

  const assignments = await classifyTransactions(
    batch.map((row) => ({
      description: row.description,
      merchant: row.merchant,
      direction: row.amountMinor >= 0 ? ("in" as const) : ("out" as const),
    })),
    leaves.map((leaf) => leaf.label),
  ).catch((error: unknown) => {
    logEvent("auto_categorize.run_failed", {
      attempted: batch.length,
      errorClass: errorClass(error),
    });
    throw error;
  });

  // `category_id is null` in the write predicate makes a concurrent manual
  // assignment win: the auto write silently skips any row no longer NULL.
  const outcome = await withRequestScope(user.clerkUserId, async (tx) => {
    let categorized = 0;
    for (const assignment of assignments) {
      const updated = await tx
        .update(transactions)
        .set({
          categoryId: leaves[assignment.category].id,
          categorySource: "auto",
          categoryConfidence: assignment.confidence,
          categoryReason: assignment.reason,
          updatedAt: sql`now()`,
        })
        .where(and(eq(transactions.id, batch[assignment.item].id), uncategorized(user.id)));
      categorized += updated.rowCount ?? 0;
    }
    return { categorized, remaining: await remainingCount(tx, user.id) };
  });

  logEvent("auto_categorize.run", {
    attempted: batch.length,
    returned: assignments.length,
    categorized: outcome.categorized,
    remaining: outcome.remaining,
  });
  return { attempted: batch.length, ...outcome };
}
