import "server-only";
import { and, eq, isNull, or, sql } from "drizzle-orm";

import { UUID_PATTERN } from "@/lib/crypto/credentials";
import { resolveAssignableCategory } from "@/lib/data/categories";
import { matchTransfersFor } from "@/lib/data/transfers";
import { requireUser } from "@/lib/data/users";
import { withRequestScope, type ScopedTx } from "@/lib/db/client";
import { accounts, transactions, transferPairs } from "@/lib/db/schema";
import {
  manualAmountMinor,
  type ManualTransactionInput,
} from "@/lib/ledger/manual-transactions";
import { errorClass, logEvent } from "@/lib/log";

export type ManualMutationError =
  | "invalid_request"
  | "transaction_not_found"
  | "account_not_found"
  | "category_not_found"
  | "category_not_assignable";

export type ManualMutationResult =
  | { transactionId: string }
  | { error: ManualMutationError };

type User = Awaited<ReturnType<typeof requireUser>>;
type Operation =
  | "create_manual_transaction"
  | "update_manual_transaction"
  | "delete_manual_transaction";

async function repairTransfers(user: User, operation: Operation): Promise<void> {
  try {
    await matchTransfersFor(user);
  } catch (error) {
    logEvent("transfer_match.run_failed", {
      operation,
      errorClass: errorClass(error),
    });
  }
}

async function resolveAccount(tx: ScopedTx, userId: string, accountId: string) {
  if (!UUID_PATTERN.test(accountId)) return null;
  const [account] = await tx
    .select({ id: accounts.id, currency: accounts.currency })
    .from(accounts)
    .where(and(eq(accounts.id, accountId), eq(accounts.userId, userId)));
  return account ?? null;
}

export async function createManualTransaction(
  input: ManualTransactionInput,
): Promise<ManualMutationResult> {
  const user = await requireUser();
  const result = await withRequestScope(user.clerkUserId, async (tx) => {
    const account = await resolveAccount(tx, user.id, input.accountId);
    if (!account) return { error: "account_not_found" as const };

    const amountMinor = manualAmountMinor(input.direction, input.amount, account.currency);
    if (amountMinor === null) return { error: "invalid_request" as const };

    const category = await resolveAssignableCategory(tx, user.id, input.categoryId);
    if (!category.ok) return { error: category.error };

    const [created] = await tx
      .insert(transactions)
      .values({
        userId: user.id,
        accountId: account.id,
        categoryId: category.categoryId,
        categorySource: category.categoryId === null ? null : "user",
        categoryConfidence: null,
        categoryReason: null,
        categoryRunId: null,
        amountMinor,
        currency: account.currency,
        date: input.date,
        description: input.description,
        merchant: input.merchant,
        status: "posted",
        source: "manual",
        sourceId: null,
      })
      .returning({ id: transactions.id });
    if (!created) throw new Error("manual transaction insert returned no row");
    return { transactionId: created.id };
  });

  if (!("error" in result)) {
    await repairTransfers(user, "create_manual_transaction");
  }
  return result;
}

export async function updateManualTransaction(
  transactionId: string,
  input: ManualTransactionInput,
): Promise<ManualMutationResult> {
  const user = await requireUser();
  if (!UUID_PATTERN.test(transactionId)) return { error: "transaction_not_found" };

  const result = await withRequestScope(user.clerkUserId, async (tx) => {
    const [target] = await tx
      .select({
        id: transactions.id,
        accountId: transactions.accountId,
        categoryId: transactions.categoryId,
        amountMinor: transactions.amountMinor,
        currency: transactions.currency,
        date: transactions.date,
      })
      .from(transactions)
      .where(
        and(
          eq(transactions.id, transactionId),
          eq(transactions.userId, user.id),
          eq(transactions.source, "manual"),
        ),
      )
      .for("update");
    if (!target) return { error: "transaction_not_found" as const };

    const account = await resolveAccount(tx, user.id, input.accountId);
    if (!account) return { error: "account_not_found" as const };

    const amountMinor = manualAmountMinor(input.direction, input.amount, account.currency);
    if (amountMinor === null) return { error: "invalid_request" as const };

    const category = await resolveAssignableCategory(tx, user.id, input.categoryId);
    if (!category.ok) return { error: category.error };

    const categoryChanged = target.categoryId !== category.categoryId;
    const base = {
      accountId: account.id,
      amountMinor,
      currency: account.currency,
      date: input.date,
      description: input.description,
      merchant: input.merchant,
      updatedAt: sql`now()`,
    };
    const [updated] = await tx
      .update(transactions)
      .set(
        categoryChanged
          ? {
              ...base,
              categoryId: category.categoryId,
              categorySource: category.categoryId === null ? null : "user",
              categoryConfidence: null,
              categoryReason: null,
              categoryRunId: null,
              categoryRevision: sql`${transactions.categoryRevision} + 1`,
            }
          : base,
      )
      .where(
        and(
          eq(transactions.id, transactionId),
          eq(transactions.userId, user.id),
          eq(transactions.source, "manual"),
        ),
      )
      .returning({ id: transactions.id });
    if (!updated) return { error: "transaction_not_found" as const };

    const matchChanged =
      target.accountId !== account.id ||
      target.currency !== account.currency ||
      target.amountMinor !== amountMinor ||
      target.date !== input.date;
    if (matchChanged) {
      await tx
        .delete(transferPairs)
        .where(
          and(
            eq(transferPairs.userId, user.id),
            isNull(transferPairs.dismissedAt),
            or(
              eq(transferPairs.outflowTransactionId, target.id),
              eq(transferPairs.inflowTransactionId, target.id),
            ),
          ),
        );
    }

    return { transactionId: updated.id };
  });

  if (!("error" in result)) {
    await repairTransfers(user, "update_manual_transaction");
  }
  return result;
}

export async function deleteManualTransaction(
  transactionId: string,
): Promise<ManualMutationResult> {
  const user = await requireUser();
  if (!UUID_PATTERN.test(transactionId)) return { error: "transaction_not_found" };

  const result = await withRequestScope(user.clerkUserId, async (tx) => {
    const [deleted] = await tx
      .delete(transactions)
      .where(
        and(
          eq(transactions.id, transactionId),
          eq(transactions.userId, user.id),
          eq(transactions.source, "manual"),
        ),
      )
      .returning({ id: transactions.id });
    return deleted
      ? { transactionId: deleted.id }
      : { error: "transaction_not_found" as const };
  });

  if (!("error" in result)) {
    await repairTransfers(user, "delete_manual_transaction");
  }
  return result;
}
