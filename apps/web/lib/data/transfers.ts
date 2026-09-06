import "server-only";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";

import { UUID_PATTERN } from "@/lib/crypto/credentials";
import { requireUser } from "@/lib/data/users";
import { withRequestScope } from "@/lib/db/client";
import { transactions, transferPairs } from "@/lib/db/schema";
import { comboKey, matchTransferPairs, pairDistance } from "@/lib/ledger/transfer-matching";
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
        id: transferPairs.id,
        outflowId: transferPairs.outflowTransactionId,
        inflowId: transferPairs.inflowTransactionId,
        dismissedAt: transferPairs.dismissedAt,
      })
      .from(transferPairs)
      .where(eq(transferPairs.userId, user.id));

    // A re-synced half can drift out of the rule (amount, date, currency, account,
    // status): active pairs are re-checked against it and dissolved when it breaks.
    const posted = new Map(rows.map((row) => [row.id, row]));
    const stale = known.filter(
      (pair) =>
        pair.dismissedAt === null &&
        pairDistance(posted.get(pair.outflowId), posted.get(pair.inflowId)) === null,
    );
    let dissolved = 0;
    if (stale.length > 0) {
      const ids = stale.map((pair) => pair.id);
      const removed = await tx.delete(transferPairs).where(inArray(transferPairs.id, ids));
      dissolved = removed.rowCount ?? 0;
    }

    const gone = new Set(stale);
    const live = known.filter((pair) => !gone.has(pair));
    const activelyPaired = new Set(
      live.filter((pair) => pair.dismissedAt === null).flatMap((pair) => [pair.outflowId, pair.inflowId]),
    );
    const excluded = new Set(live.map((pair) => comboKey(pair.outflowId, pair.inflowId)));
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
    return { paired, dissolved };
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
