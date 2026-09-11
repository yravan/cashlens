import "server-only";
import { createHash } from "node:crypto";
import { and, count, desc, eq, isNull, sql } from "drizzle-orm";

import { categoryGroupsFor } from "@/lib/data/categories";
import {
  claimInferenceRun,
  failLiveInferenceRun,
  lockLiveInferenceRun,
} from "@/lib/data/classification-runs";
import { requireUser } from "@/lib/data/users";
import { withRequestScope, type ScopedTx } from "@/lib/db/client";
import { classificationRuns, transactions, transferPairs } from "@/lib/db/schema";
import {
  captureClassificationRequest,
  type ClassificationResult,
  type ClassificationMetadata,
} from "@/lib/llm/client";
import { errorClass, logEvent } from "@/lib/log";

export {
  InvalidClassificationError,
  llmConfigured,
  LlmRateLimitedError,
  LlmUnavailableError,
  LlmUnconfiguredError,
} from "@/lib/llm/client";
export { InferenceBusyError } from "@/lib/data/classification-runs";

export const BATCH_LIMIT = 40;

export type AutoCategorizeStep = { attempted: number; categorized: number; remaining: number };

// An actively paired row is a transfer (3.3.1), not spend — it needs no
// category; unlinking re-admits it. The same predicate guards the write, so a
// row paired mid-classification is skipped like a concurrent manual pick.
const unpaired = sql`not exists (
  select 1 from ${transferPairs}
  where ${transferPairs.userId} = ${transactions.userId}
    and ${transferPairs.dismissedAt} is null
    and (${transferPairs.outflowTransactionId} = ${transactions.id}
      or ${transferPairs.inflowTransactionId} = ${transactions.id})
)`;

const uncategorized = (userId: string) =>
  and(eq(transactions.userId, userId), isNull(transactions.categoryId), unpaired);

const sha256 = (value: string): string => createHash("sha256").update(value).digest("hex");

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
  const [eligible] = await withRequestScope(user.clerkUserId, (tx) =>
    tx
      .select({ id: transactions.id })
      .from(transactions)
      .where(uncategorized(user.id))
      .limit(1),
  );
  if (!eligible) return { attempted: 0, categorized: 0, remaining: 0 };

  const request = captureClassificationRequest();
  const admitted = await withRequestScope(user.clerkUserId, async (tx) => {
    const groups = await categoryGroupsFor(tx, user.id);
    const leaves = groups.flatMap((group) =>
      group.categories.map((leaf) => ({ id: leaf.id, label: `${group.name} > ${leaf.name}` })),
    );
    if (leaves.length === 0) {
      return { runId: null, leaves, batch: [], remaining: await remainingCount(tx, user.id) };
    }
    const runId = await claimInferenceRun(tx, {
      ownerUserId: user.id,
      kind: "automatic_initial",
      requestedModel: request.requestedModel,
      promptVersion: request.promptVersion,
      assignmentSchemaVersion: request.assignmentSchemaVersion,
      taxonomyFingerprint: sha256(JSON.stringify(leaves)),
      providerPolicyFingerprint: request.providerPolicyFingerprint,
      batchSize: BATCH_LIMIT,
    });
    const batch = await tx
      .select({
        id: transactions.id,
        description: transactions.description,
        merchant: transactions.merchant,
        amountMinor: transactions.amountMinor,
        categoryRevision: transactions.categoryRevision,
        updatedAt: sql<string>`${transactions.updatedAt}::text`,
      })
      .from(transactions)
      .where(uncategorized(user.id))
      .orderBy(desc(transactions.date), desc(transactions.createdAt), desc(transactions.id))
      .limit(BATCH_LIMIT);
    await tx
      .update(classificationRuns)
      .set({ attempted: batch.length })
      .where(
        and(
          eq(classificationRuns.id, runId),
          eq(classificationRuns.status, "inferring"),
        ),
      );
    return { runId, leaves, batch, remaining: 0 };
  });
  if (!admitted.runId) {
    return { attempted: 0, categorized: 0, remaining: admitted.remaining };
  }
  const runId = admitted.runId;

  const finalize = async (
    assignments: ClassificationResult["assignments"],
    metadata: ClassificationMetadata,
  ): Promise<AutoCategorizeStep> => withRequestScope(user.clerkUserId, async (tx) => {
    if (!(await lockLiveInferenceRun(tx, user.id, runId))) {
      return {
        attempted: admitted.batch.length,
        categorized: 0,
        remaining: await remainingCount(tx, user.id),
      };
    }
    const applied: {
      transactionId: string;
      categoryId: string;
      confidence: string;
      reason: string;
    }[] = [];
    for (const assignment of assignments) {
      const candidate = admitted.batch[assignment.item];
      const leaf = admitted.leaves[assignment.category];
      const [updated] = await tx
        .update(transactions)
        .set({
          categoryId: leaf.id,
          categorySource: "auto",
          categoryConfidence: assignment.confidence,
          categoryReason: assignment.reason,
          categoryRunId: runId,
          categoryRevision: sql`${transactions.categoryRevision} + 1`,
          updatedAt: sql`clock_timestamp()`,
        })
        .where(
          and(
            eq(transactions.id, candidate.id),
            uncategorized(user.id),
            eq(transactions.categoryRevision, candidate.categoryRevision),
            sql`${transactions.updatedAt} = ${candidate.updatedAt}::timestamptz`,
          ),
        )
        .returning({ id: transactions.id });
      if (updated) {
        applied.push({
          transactionId: updated.id,
          categoryId: leaf.id,
          confidence: assignment.confidence,
          reason: assignment.reason,
        });
      }
    }
    applied.sort((a, b) => a.transactionId.localeCompare(b.transactionId));
    await tx
      .update(classificationRuns)
      .set({
        status: "succeeded",
        responseModel: metadata.responseModel,
        resultSetHash: sha256(JSON.stringify(applied)),
        applied: applied.length,
        skipped: admitted.batch.length - applied.length,
        providerInputTokens: metadata.providerInputTokens,
        providerOutputTokens: metadata.providerOutputTokens,
        providerGenerationId: metadata.providerGenerationId,
        updatedAt: sql`clock_timestamp()`,
      })
      .where(
        and(
          eq(classificationRuns.id, runId),
          eq(classificationRuns.status, "inferring"),
        ),
      );
    return {
      attempted: admitted.batch.length,
      categorized: applied.length,
      remaining: await remainingCount(tx, user.id),
    };
  });

  try {
    const result = admitted.batch.length === 0
      ? {
          assignments: [],
          metadata: {
            responseModel: null,
            providerGenerationId: null,
            providerInputTokens: null,
            providerOutputTokens: null,
          },
        }
      : await request.classify(
          admitted.batch.map((row) => ({
            description: row.description,
            merchant: row.merchant,
            direction: row.amountMinor >= 0 ? ("in" as const) : ("out" as const),
          })),
          admitted.leaves.map((leaf) => leaf.label),
        );
    const outcome = await finalize(result.assignments, result.metadata);
    logEvent("auto_categorize.run", {
      runId,
      attempted: admitted.batch.length,
      returned: result.assignments.length,
      categorized: outcome.categorized,
      remaining: outcome.remaining,
    });
    return outcome;
  } catch (error: unknown) {
    await withRequestScope(user.clerkUserId, (tx) =>
      failLiveInferenceRun(tx, user.id, runId),
    );
    logEvent("auto_categorize.run_failed", {
      runId,
      attempted: admitted.batch.length,
      errorClass: errorClass(error),
    });
    throw error;
  }
}
