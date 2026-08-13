import "server-only";
import { count, eq } from "drizzle-orm";

import { requireUser } from "@/lib/data/users";
import { withRequestScope, type ScopedTx } from "@/lib/db/client";
import { accounts, transactions } from "@/lib/db/schema";

export type LedgerCounts = { accounts: number; transactions: number };

async function countLedger(
  tx: ScopedTx,
  userId: string,
): Promise<LedgerCounts> {
  const accountRows = await tx
    .select({ n: count() })
    .from(accounts)
    .where(eq(accounts.userId, userId));
  const transactionRows = await tx
    .select({ n: count() })
    .from(transactions)
    .where(eq(transactions.userId, userId));
  return { accounts: accountRows[0].n, transactions: transactionRows[0].n };
}

export async function ledgerCounts(): Promise<LedgerCounts> {
  const user = await requireUser();
  return withRequestScope(user.clerkUserId, (tx) =>
    countLedger(tx, user.id),
  );
}
