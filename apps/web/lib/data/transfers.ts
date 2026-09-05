import "server-only";
import { and, eq, isNull, sql } from "drizzle-orm";

import { UUID_PATTERN } from "@/lib/crypto/credentials";
import { requireUser } from "@/lib/data/users";
import { withRequestScope } from "@/lib/db/client";
import { transactions, transferPairs } from "@/lib/db/schema";
import {
  comboKey,
  matchTransferPairs,
  TRANSFER_WINDOW_DAYS,
} from "@/lib/ledger/transfer-matching";
import { logEvent } from "@/lib/log";

const INSERT_CHUNK = 500;

export type TransferMatchStep = { paired: number; dissolved: number };

type ScopedUser = { id: string; clerkUserId: string };

export async function matchTransfers(): Promise<TransferMatchStep> {
  const user = await requireUser();
  return matchTransfersFor(user);
}

// lib/data-internal: `user` must come from auth() or the verified webhook
// owner mapping — never from request input.
export async function matchTransfersFor(user: ScopedUser): Promise<TransferMatchStep> {
  const step = await withRequestScope(user.clerkUserId, async (tx) => {
    // A re-synced half can drift (amount, date, status): active pairs are
    // re-verified against the full rule and dissolved when it no longer holds.
    const dissolved = await tx.execute(sql`
      delete from transfer_pairs pair
      using transactions outflow, transactions inflow
      where pair.user_id = ${user.id}
        and pair.dismissed_at is null
        and outflow.id = pair.outflow_transaction_id and outflow.user_id = pair.user_id
        and inflow.id = pair.inflow_transaction_id and inflow.user_id = pair.user_id
        and not (
          outflow.status = 'posted' and inflow.status = 'posted'
          and outflow.amount_minor < 0
          and inflow.amount_minor = -outflow.amount_minor
          and outflow.currency = inflow.currency
          and outflow.account_id <> inflow.account_id
          and abs(inflow.date - outflow.date) <= ${TRANSFER_WINDOW_DAYS}
        )
    `);

    const rows = await tx
      .select({
        id: transactions.id,
        accountId: transactions.accountId,
        amountMinor: transactions.amountMinor,
        currency: transactions.currency,
        date: transactions.date,
        status: transactions.status,
      })
      .from(transactions)
      .where(and(eq(transactions.userId, user.id), eq(transactions.status, "posted")));
    const known = await tx
      .select({
        outflowId: transferPairs.outflowTransactionId,
        inflowId: transferPairs.inflowTransactionId,
        dismissedAt: transferPairs.dismissedAt,
      })
      .from(transferPairs)
      .where(eq(transferPairs.userId, user.id));

    const activelyPaired = new Set(
      known.filter((pair) => pair.dismissedAt === null).flatMap((pair) => [pair.outflowId, pair.inflowId]),
    );
    const excluded = new Set(known.map((pair) => comboKey(pair.outflowId, pair.inflowId)));
    const found = matchTransferPairs(
      rows.filter((row) => !activelyPaired.has(row.id)),
      excluded,
    );

    let paired = 0;
    for (let at = 0; at < found.length; at += INSERT_CHUNK) {
      const chunk = await tx
        .insert(transferPairs)
        .values(
          found.slice(at, at + INSERT_CHUNK).map((pair) => ({
            userId: user.id,
            outflowTransactionId: pair.outflowId,
            inflowTransactionId: pair.inflowId,
          })),
        )
        .onConflictDoNothing();
      paired += chunk.rowCount ?? 0;
    }
    return { paired, dissolved: dissolved.rowCount ?? 0 };
  });

  if (step.paired > 0 || step.dissolved > 0) logEvent("transfer_match.run", step);
  return step;
}

export async function unlinkTransferPair(pairId: string): Promise<boolean> {
  if (!UUID_PATTERN.test(pairId)) return false;
  const user = await requireUser();
  const dismissed = await withRequestScope(user.clerkUserId, (tx) =>
    tx
      .update(transferPairs)
      .set({ dismissedAt: sql`now()`, updatedAt: sql`now()` })
      .where(
        and(
          eq(transferPairs.id, pairId),
          eq(transferPairs.userId, user.id),
          isNull(transferPairs.dismissedAt),
        ),
      ),
  );
  return (dismissed.rowCount ?? 0) > 0;
}
