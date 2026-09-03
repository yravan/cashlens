import "server-only";
import { and, asc, count, desc, eq, gte, ilike, lte, or, sql, type SQL } from "drizzle-orm";

import { categoryGroupsFor } from "@/lib/data/categories";
import { requireUser } from "@/lib/data/users";
import { withRequestScope, type ScopedTx } from "@/lib/db/client";
import { accountBalances, accounts, categories, transactions } from "@/lib/db/schema";
import {
  HISTORY_PAGE_SIZE,
  searchPattern,
  type HistoryQuery,
  type ParsedHistoryQuery,
} from "@/lib/ledger/history-query";

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

function historyConditions(userId: string, query: HistoryQuery): SQL {
  const conditions = [eq(transactions.userId, userId)];
  if (query.q !== null) {
    const pattern = searchPattern(query.q);
    conditions.push(
      or(ilike(transactions.description, pattern), ilike(transactions.merchant, pattern))!,
    );
  }
  if (query.accountId !== null) conditions.push(eq(transactions.accountId, query.accountId));
  if (query.categoryId !== null) conditions.push(eq(transactions.categoryId, query.categoryId));
  if (query.from !== null) conditions.push(gte(transactions.date, query.from));
  if (query.to !== null) conditions.push(lte(transactions.date, query.to));
  if (query.currency !== null) conditions.push(eq(transactions.currency, query.currency));
  if (query.minMinor !== null) {
    conditions.push(sql`abs(${transactions.amountMinor}) >= ${query.minMinor}`);
  }
  if (query.maxMinor !== null) {
    conditions.push(sql`abs(${transactions.amountMinor}) <= ${query.maxMinor}`);
  }
  return and(...conditions)!;
}

async function historyOptions(tx: ScopedTx, userId: string) {
  const owned = await tx
    .select({ id: accounts.id, name: accounts.name })
    .from(accounts)
    .where(eq(accounts.userId, userId))
    .orderBy(asc(accounts.name), asc(accounts.id));
  const currencies = await tx
    .selectDistinct({ currency: transactions.currency })
    .from(transactions)
    .where(eq(transactions.userId, userId))
    .orderBy(asc(transactions.currency));
  return {
    accounts: owned,
    categoryGroups: await categoryGroupsFor(tx, userId),
    currencies: currencies.map((row) => row.currency),
  };
}

export async function transactionHistory(parsed: ParsedHistoryQuery) {
  const user = await requireUser();
  return withRequestScope(user.clerkUserId, async (tx) => {
    const options = await historyOptions(tx, user.id);
    if (!parsed.ok) return { rows: [], total: 0, page: 1, pageCount: 0, options };

    const where = historyConditions(user.id, parsed.query);
    const [{ total }] = await tx
      .select({ total: count() })
      .from(transactions)
      .where(where);
    const rows = await tx
      .select({
        id: transactions.id,
        date: transactions.date,
        description: transactions.description,
        merchant: transactions.merchant,
        amountMinor: transactions.amountMinor,
        currency: transactions.currency,
        status: transactions.status,
        source: transactions.source,
        accountId: transactions.accountId,
        accountName: accounts.name,
        categoryId: transactions.categoryId,
        categoryName: categories.name,
        categorySource: transactions.categorySource,
        categoryConfidence: transactions.categoryConfidence,
        categoryReason: transactions.categoryReason,
      })
      .from(transactions)
      .innerJoin(
        accounts,
        and(eq(accounts.id, transactions.accountId), eq(accounts.userId, user.id)),
      )
      .leftJoin(
        categories,
        and(eq(categories.id, transactions.categoryId), eq(categories.userId, user.id)),
      )
      .where(where)
      .orderBy(desc(transactions.date), desc(transactions.createdAt), desc(transactions.id))
      .limit(HISTORY_PAGE_SIZE)
      .offset((parsed.query.page - 1) * HISTORY_PAGE_SIZE);

    return {
      rows,
      total,
      page: parsed.query.page,
      pageCount: Math.ceil(total / HISTORY_PAGE_SIZE),
      options,
    };
  });
}

export type TransactionHistory = Awaited<ReturnType<typeof transactionHistory>>;

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
