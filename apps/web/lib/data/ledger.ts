import "server-only";
import { asc, count, desc, eq } from "drizzle-orm";

import { requireUser } from "@/lib/data/users";
import { withRequestScope } from "@/lib/db/client";
import { accountBalances, accounts, transactions } from "@/lib/db/schema";

export async function ledgerCounts() {
  const user = await requireUser();
  return withRequestScope(user.clerkUserId, async (tx) => {
    const [account] = await tx
      .select({ n: count() })
      .from(accounts)
      .where(eq(accounts.userId, user.id));
    const [transaction] = await tx
      .select({ n: count() })
      .from(transactions)
      .where(eq(transactions.userId, user.id));
    return { accounts: account.n, transactions: transaction.n };
  });
}

export async function listTransactions() {
  const user = await requireUser();
  return withRequestScope(user.clerkUserId, (tx) =>
    tx
      .select({
        id: transactions.id,
        date: transactions.date,
        description: transactions.description,
        merchant: transactions.merchant,
        amountMinor: transactions.amountMinor,
        currency: transactions.currency,
        status: transactions.status,
        source: transactions.source,
        categoryId: transactions.categoryId,
      })
      .from(transactions)
      .where(eq(transactions.userId, user.id))
      .orderBy(desc(transactions.date), desc(transactions.createdAt), desc(transactions.id)),
  );
}

export async function accountOverview() {
  const user = await requireUser();
  return withRequestScope(user.clerkUserId, async (tx) => {
    const listed = await tx
      .select({
        id: accounts.id,
        name: accounts.name,
        type: accounts.type,
        subtype: accounts.subtype,
        mask: accounts.mask,
        currency: accounts.currency,
        currentMinor: accountBalances.currentMinor,
      })
      .from(accounts)
      .leftJoin(accountBalances, eq(accountBalances.accountId, accounts.id))
      .where(eq(accounts.userId, user.id))
      .orderBy(asc(accounts.type), asc(accounts.name), asc(accounts.id));
    const total = (type: "depository" | "credit") => {
      const totals: Record<string, number> = {};
      for (const account of listed) {
        if (account.type === type && account.currentMinor !== null) {
          totals[account.currency] = (totals[account.currency] ?? 0) + account.currentMinor;
        }
      }
      return totals;
    };
    return {
      accounts: listed,
      cashOnHand: total("depository"),
      creditOwed: total("credit"),
    };
  });
}
