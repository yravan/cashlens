import "server-only";
import { and, asc, desc, eq, gte, inArray, lt, lte, sql } from "drizzle-orm";

import { requireUser } from "@/lib/data/users";
import { withRequestScope, type ScopedTx } from "@/lib/db/client";
import { accountBalanceSnapshots, accounts, transactions } from "@/lib/db/schema";
import { OWED_TYPES } from "@/lib/ledger/offline-accounts";
import { logEvent } from "@/lib/log";

type BalanceSnapshotBase = {
  accountId: string;
  userId: string;
  currentMinor: number;
  currency: string;
  captureReason: "event" | "bootstrap" | "reconciliation";
  observedAt: Date;
};

export type BalanceSnapshotCapture = BalanceSnapshotBase &
  (
    | { source: "provider"; providerAsOf: Date | null }
    | { source: "manual_anchor"; snapshotDay: string; providerAsOf: null }
  );

function invariantConflict(capture: BalanceSnapshotCapture, snapshotDay: string): never {
  logEvent("balance_snapshot.invariant_conflict", {
    accountId: capture.accountId,
    source: capture.source,
    snapshotDay,
  });
  throw new Error("balance snapshot invariant conflict");
}

export async function captureBalanceSnapshot(
  tx: ScopedTx,
  capture: BalanceSnapshotCapture,
): Promise<void> {
  const snapshotDay =
    capture.source === "provider"
      ? capture.observedAt.toISOString().slice(0, 10)
      : capture.snapshotDay;
  const written = await tx.execute(sql`
    insert into account_balance_snapshots (
      account_id, user_id, snapshot_day, current_minor, currency,
      source, capture_reason, observed_at, provider_as_of
    ) select
      account.id, account.user_id, ${snapshotDay},
      ${capture.currentMinor}, account.currency, ${capture.source},
      ${capture.captureReason}, ${capture.observedAt}, ${capture.providerAsOf}
    from accounts account
    where account.id = ${capture.accountId}
      and account.user_id = ${capture.userId}
      and account.currency = ${capture.currency}
    on conflict (account_id, snapshot_day) do update set
      current_minor = excluded.current_minor,
      capture_reason = excluded.capture_reason,
      observed_at = excluded.observed_at,
      provider_as_of = excluded.provider_as_of,
      updated_at = now()
    where account_balance_snapshots.user_id = ${capture.userId}
      and account_balance_snapshots.currency = excluded.currency
      and account_balance_snapshots.source = excluded.source
      and account_balance_snapshots.observed_at < excluded.observed_at
      and not (
        account_balance_snapshots.source = 'provider'
        and account_balance_snapshots.provider_as_of is not null
        and excluded.provider_as_of is not null
        and excluded.provider_as_of < account_balance_snapshots.provider_as_of
      )
    returning account_id
  `);
  if (written.rows.length > 0) return;

  const [existing] = await tx
    .select({
      currentMinor: accountBalanceSnapshots.currentMinor,
      source: accountBalanceSnapshots.source,
      observedAt: accountBalanceSnapshots.observedAt,
      providerAsOf: accountBalanceSnapshots.providerAsOf,
    })
    .from(accountBalanceSnapshots)
    .where(
      and(
        eq(accountBalanceSnapshots.accountId, capture.accountId),
        eq(accountBalanceSnapshots.userId, capture.userId),
        eq(accountBalanceSnapshots.snapshotDay, snapshotDay),
      ),
    );
  if (!existing) invariantConflict(capture, snapshotDay);
  if (
    existing.observedAt.getTime() === capture.observedAt.getTime() &&
    (existing.currentMinor !== capture.currentMinor ||
      existing.source !== capture.source ||
      existing.providerAsOf?.getTime() !== capture.providerAsOf?.getTime())
  ) {
    invariantConflict(capture, snapshotDay);
  }
}

type ProviderBalanceHistoryPoint =
  | {
      day: string;
      basis: "observed" | "carried";
      currentMinor: number;
      observedDay: string;
      observedAt: Date;
      providerAsOf: Date | null;
      captureReason: "event" | "bootstrap" | "reconciliation";
    }
  | { day: string; basis: "unavailable"; currentMinor: null };

export type ProviderAccountBalanceHistory = {
  accountId: string;
  accountType: (typeof accounts.$inferSelect)["type"];
  currency: string;
  points: ProviderBalanceHistoryPoint[];
};

type ProviderHistoryRange = {
  from: string;
  to: string;
  accountIds?: readonly string[];
};

function inclusiveDays(from: string, to: string): string[] {
  const days: string[] = [];
  const cursor = new Date(`${from}T00:00:00.000Z`);
  const end = new Date(`${to}T00:00:00.000Z`);
  while (cursor <= end) {
    days.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return days;
}

export async function providerBalanceHistory(
  range: ProviderHistoryRange,
): Promise<ProviderAccountBalanceHistory[]> {
  const user = await requireUser();
  return withRequestScope(user.clerkUserId, async (tx) => {
    if (range.accountIds?.length === 0) return [];

    const accountScope = [eq(accounts.userId, user.id), eq(accounts.source, "plaid")];
    if (range.accountIds) accountScope.push(inArray(accounts.id, range.accountIds));
    const selectedAccounts = await tx
      .select({
        accountId: accounts.id,
        accountType: accounts.type,
        currency: accounts.currency,
      })
      .from(accounts)
      .where(and(...accountScope))
      .orderBy(asc(accounts.type), asc(accounts.id));
    if (selectedAccounts.length === 0) return [];

    const accountIds = selectedAccounts.map((account) => account.accountId);
    const snapshotFields = {
      accountId: accountBalanceSnapshots.accountId,
      snapshotDay: accountBalanceSnapshots.snapshotDay,
      currentMinor: accountBalanceSnapshots.currentMinor,
      captureReason: accountBalanceSnapshots.captureReason,
      observedAt: accountBalanceSnapshots.observedAt,
      providerAsOf: accountBalanceSnapshots.providerAsOf,
    };
    const snapshotScope = and(
      eq(accountBalanceSnapshots.userId, user.id),
      eq(accountBalanceSnapshots.source, "provider"),
      inArray(accountBalanceSnapshots.accountId, accountIds),
    )!;
    const priorSnapshots = await tx
      .selectDistinctOn([accountBalanceSnapshots.accountId], snapshotFields)
      .from(accountBalanceSnapshots)
      .where(and(snapshotScope, lt(accountBalanceSnapshots.snapshotDay, range.from)))
      .orderBy(accountBalanceSnapshots.accountId, desc(accountBalanceSnapshots.snapshotDay));
    const rangeSnapshots = await tx
      .select(snapshotFields)
      .from(accountBalanceSnapshots)
      .where(
        and(
          snapshotScope,
          gte(accountBalanceSnapshots.snapshotDay, range.from),
          lte(accountBalanceSnapshots.snapshotDay, range.to),
        ),
      )
      .orderBy(accountBalanceSnapshots.accountId, accountBalanceSnapshots.snapshotDay);

    type Snapshot = (typeof rangeSnapshots)[number];
    const snapshotsByAccount = new Map<string, Snapshot[]>();
    for (const snapshot of [...priorSnapshots, ...rangeSnapshots]) {
      const snapshots = snapshotsByAccount.get(snapshot.accountId) ?? [];
      snapshots.push(snapshot);
      snapshotsByAccount.set(snapshot.accountId, snapshots);
    }
    const days = inclusiveDays(range.from, range.to);

    return selectedAccounts.map((account) => {
      const snapshots = (snapshotsByAccount.get(account.accountId) ?? []).sort((a, b) =>
        a.snapshotDay.localeCompare(b.snapshotDay),
      );
      let observed: Snapshot | undefined;
      let index = 0;
      const points = days.map((day): ProviderBalanceHistoryPoint => {
        while (index < snapshots.length && snapshots[index].snapshotDay <= day) {
          observed = snapshots[index];
          index += 1;
        }
        if (!observed) return { day, basis: "unavailable", currentMinor: null };
        return {
          day,
          basis: observed.snapshotDay === day ? "observed" : "carried",
          currentMinor: observed.currentMinor,
          observedDay: observed.snapshotDay,
          observedAt: observed.observedAt,
          providerAsOf: observed.providerAsOf,
          captureReason: observed.captureReason,
        };
      });
      return { ...account, points };
    });
  });
}

type ManualBalanceHistoryPoint =
  | {
      day: string;
      basis: "derived";
      currentMinor: number;
      anchorMinor: number;
      anchorDay: string;
      anchorObservedAt: Date;
      captureReason: "event" | "bootstrap" | "reconciliation";
    }
  | { day: string; basis: "unavailable"; currentMinor: null };

export type ManualAccountBalanceHistory = {
  accountId: string;
  accountType: (typeof accounts.$inferSelect)["type"];
  currency: string;
  points: ManualBalanceHistoryPoint[];
};

type ManualHistoryRange = ProviderHistoryRange;

export async function manualBalanceHistory(
  range: ManualHistoryRange,
): Promise<ManualAccountBalanceHistory[]> {
  const user = await requireUser();
  return withRequestScope(user.clerkUserId, async (tx) => {
    if (range.accountIds?.length === 0) return [];

    const accountScope = [eq(accounts.userId, user.id), eq(accounts.source, "manual")];
    if (range.accountIds) accountScope.push(inArray(accounts.id, range.accountIds));
    const selectedAccounts = await tx
      .select({
        accountId: accounts.id,
        accountType: accounts.type,
        currency: accounts.currency,
      })
      .from(accounts)
      .where(and(...accountScope))
      .orderBy(asc(accounts.type), asc(accounts.id));
    if (selectedAccounts.length === 0) return [];

    const accountIds = selectedAccounts.map((account) => account.accountId);
    const anchorFields = {
      accountId: accountBalanceSnapshots.accountId,
      snapshotDay: accountBalanceSnapshots.snapshotDay,
      currentMinor: accountBalanceSnapshots.currentMinor,
      captureReason: accountBalanceSnapshots.captureReason,
      observedAt: accountBalanceSnapshots.observedAt,
      observedMicros: sql<string>`(
        extract(epoch from ${accountBalanceSnapshots.observedAt}) * 1000000
      )::bigint`,
    };
    const anchorScope = and(
      eq(accountBalanceSnapshots.userId, user.id),
      eq(accountBalanceSnapshots.source, "manual_anchor"),
      inArray(accountBalanceSnapshots.accountId, accountIds),
    )!;
    const priorAnchors = await tx
      .selectDistinctOn([accountBalanceSnapshots.accountId], anchorFields)
      .from(accountBalanceSnapshots)
      .where(and(anchorScope, lt(accountBalanceSnapshots.snapshotDay, range.from)))
      .orderBy(accountBalanceSnapshots.accountId, desc(accountBalanceSnapshots.snapshotDay));
    const rangeAnchors = await tx
      .select(anchorFields)
      .from(accountBalanceSnapshots)
      .where(
        and(
          anchorScope,
          gte(accountBalanceSnapshots.snapshotDay, range.from),
          lte(accountBalanceSnapshots.snapshotDay, range.to),
        ),
      )
      .orderBy(accountBalanceSnapshots.accountId, accountBalanceSnapshots.snapshotDay);
    const anchors = [...priorAnchors, ...rangeAnchors];
    const earliestAnchorDay = anchors.reduce<string | null>(
      (earliest, anchor) =>
        earliest === null || anchor.snapshotDay < earliest ? anchor.snapshotDay : earliest,
      null,
    );
    const postedTransactions = earliestAnchorDay
      ? await tx
          .select({
            accountId: transactions.accountId,
            amountMinor: transactions.amountMinor,
            date: transactions.date,
            createdMicros: sql<string>`(
              extract(epoch from ${transactions.createdAt}) * 1000000
            )::bigint`,
          })
          .from(transactions)
          .where(
            and(
              eq(transactions.userId, user.id),
              eq(transactions.status, "posted"),
              inArray(transactions.accountId, accountIds),
              gte(transactions.date, earliestAnchorDay),
              lte(transactions.date, range.to),
            ),
          )
          .orderBy(
            transactions.accountId,
            transactions.date,
            transactions.createdAt,
            transactions.id,
          )
      : [];

    type Anchor = (typeof anchors)[number];
    type PostedTransaction = (typeof postedTransactions)[number];
    const anchorsByAccount = new Map<string, Anchor[]>();
    for (const anchor of anchors) {
      const accountAnchors = anchorsByAccount.get(anchor.accountId) ?? [];
      accountAnchors.push(anchor);
      anchorsByAccount.set(anchor.accountId, accountAnchors);
    }
    const transactionsByAccount = new Map<string, PostedTransaction[]>();
    for (const transaction of postedTransactions) {
      const accountTransactions = transactionsByAccount.get(transaction.accountId) ?? [];
      accountTransactions.push(transaction);
      transactionsByAccount.set(transaction.accountId, accountTransactions);
    }
    const days = inclusiveDays(range.from, range.to);

    return selectedAccounts.map((account) => {
      const accountAnchors = (anchorsByAccount.get(account.accountId) ?? []).sort((a, b) =>
        a.snapshotDay.localeCompare(b.snapshotDay),
      );
      const accountTransactions = transactionsByAccount.get(account.accountId) ?? [];
      let anchor: Anchor | undefined;
      let index = 0;
      const points = days.map((day): ManualBalanceHistoryPoint => {
        while (index < accountAnchors.length && accountAnchors[index].snapshotDay <= day) {
          anchor = accountAnchors[index];
          index += 1;
        }
        const activeAnchor = anchor;
        if (!activeAnchor) return { day, basis: "unavailable", currentMinor: null };

        const sinceMinor = accountTransactions.reduce((total, transaction) => {
          const afterAnchor =
            transaction.date > activeAnchor.snapshotDay ||
            (transaction.date === activeAnchor.snapshotDay &&
              BigInt(transaction.createdMicros) > BigInt(activeAnchor.observedMicros));
          return afterAnchor && transaction.date <= day
            ? total + transaction.amountMinor
            : total;
        }, 0);
        return {
          day,
          basis: "derived",
          currentMinor: OWED_TYPES.has(account.accountType)
            ? activeAnchor.currentMinor - sinceMinor
            : activeAnchor.currentMinor + sinceMinor,
          anchorMinor: activeAnchor.currentMinor,
          anchorDay: activeAnchor.snapshotDay,
          anchorObservedAt: activeAnchor.observedAt,
          captureReason: activeAnchor.captureReason,
        };
      });
      return { ...account, points };
    });
  });
}
