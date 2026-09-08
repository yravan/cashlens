import "server-only";
import { and, asc, count, desc, eq, exists, gte, ilike, isNull, lte, notExists, or, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import { categoryGroupsFor } from "@/lib/data/categories";
import { requireUser } from "@/lib/data/users";
import { withRequestScope, type ScopedTx } from "@/lib/db/client";
import { accountBalances, accounts, categories, transactions, transferPairs } from "@/lib/db/schema";
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

const counterpartTransactions = alias(transactions, "counterpart_transactions");
const counterpartAccounts = alias(accounts, "counterpart_accounts");

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
        transferPairId: transferPairs.id,
        transferCounterpart: counterpartAccounts.name,
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
      .leftJoin(
        transferPairs,
        and(
          eq(transferPairs.userId, user.id),
          isNull(transferPairs.dismissedAt),
          or(
            eq(transferPairs.outflowTransactionId, transactions.id),
            eq(transferPairs.inflowTransactionId, transactions.id),
          ),
        ),
      )
      .leftJoin(
        counterpartTransactions,
        and(
          eq(
            counterpartTransactions.id,
            sql`case when ${transferPairs.outflowTransactionId} = ${transactions.id} then ${transferPairs.inflowTransactionId} else ${transferPairs.outflowTransactionId} end`,
          ),
          eq(counterpartTransactions.userId, user.id),
        ),
      )
      .leftJoin(
        counterpartAccounts,
        and(
          eq(counterpartAccounts.id, counterpartTransactions.accountId),
          eq(counterpartAccounts.userId, user.id),
        ),
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

type MonthFlow = { month: string; inflowMinor: number; outflowMinor: number; netMinor: number };

// True spend = posted rows minus active-pair members, whatever their category
// (the 3.3.1 contract). Dismissed pairs count again.
export async function cashFlowSummary() {
  const user = await requireUser();
  return withRequestScope(user.clerkUserId, async (tx) => {
    const activePair = tx
      .select({ one: sql`1` })
      .from(transferPairs)
      .where(
        and(
          eq(transferPairs.userId, user.id),
          isNull(transferPairs.dismissedAt),
          or(
            eq(transferPairs.outflowTransactionId, transactions.id),
            eq(transferPairs.inflowTransactionId, transactions.id),
          ),
        ),
      );
    const posted = and(eq(transactions.userId, user.id), eq(transactions.status, "posted"))!;
    const month = sql<string>`to_char(${transactions.date}, 'YYYY-MM')`;
    const rows = await tx
      .select({
        currency: transactions.currency,
        month,
        inflowMinor: sql`coalesce(sum(${transactions.amountMinor}) filter (where ${transactions.amountMinor} >= 0), 0)`.mapWith(Number),
        outflowMinor: sql`coalesce(sum(${transactions.amountMinor}) filter (where ${transactions.amountMinor} < 0), 0)`.mapWith(Number),
        netMinor: sql`sum(${transactions.amountMinor})`.mapWith(Number),
      })
      .from(transactions)
      .where(and(posted, notExists(activePair)))
      .groupBy(transactions.currency, month)
      .orderBy(asc(transactions.currency), desc(month));

    const [{ pendingCount }] = await tx
      .select({ pendingCount: count() })
      .from(transactions)
      .where(and(eq(transactions.userId, user.id), eq(transactions.status, "pending")));
    const [{ transferRows }] = await tx
      .select({ transferRows: count() })
      .from(transactions)
      .where(and(posted, exists(activePair)));

    const currencies: { currency: string; months: MonthFlow[] }[] = [];
    for (const { currency, ...monthFlow } of rows) {
      const last = currencies.at(-1);
      if (last?.currency === currency) last.months.push(monthFlow);
      else currencies.push({ currency, months: [monthFlow] });
    }
    return { currencies, pendingCount, transferRows };
  });
}

export type CashFlowSummary = Awaited<ReturnType<typeof cashFlowSummary>>;

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
