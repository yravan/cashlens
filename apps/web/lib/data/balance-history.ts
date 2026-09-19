import "server-only";
import {
  and,
  asc,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  lt,
  lte,
  notExists,
  or,
  sql,
} from "drizzle-orm";

import { requireUser } from "@/lib/data/users";
import { withRequestScope, type ScopedTx } from "@/lib/db/client";
import {
  accountBalances,
  accountBalanceSnapshots,
  accountType,
  accounts,
  transactions,
} from "@/lib/db/schema";
import { isIsoDate } from "@/lib/ledger/history-query";
import { isPlainObject } from "@/lib/ledger/manual-transactions";
import { OWED_TYPES } from "@/lib/ledger/offline-accounts";
import { errorClass, logEvent } from "@/lib/log";

type BalanceSnapshotBase = {
  accountId: string;
  userId: string;
  currentMinor: number;
  currency: string;
  captureReason: "event" | "bootstrap" | "reconciliation";
  observedAt: Date | string;
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
      ? new Date(capture.observedAt).toISOString().slice(0, 10)
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
      and account.source = ${capture.source === "provider" ? "plaid" : "manual"}
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
      and not (
        account_balance_snapshots.source = 'provider'
        and account_balance_snapshots.provider_as_of is not null
        and excluded.capture_reason = 'reconciliation'
        and excluded.provider_as_of is null
      )
    returning account_id
  `);
  if (written.rows.length > 0) return;

  const [existing] = await tx
    .select({
      currentMinor: accountBalanceSnapshots.currentMinor,
      source: accountBalanceSnapshots.source,
      currency: accountBalanceSnapshots.currency,
      sameObservation: sql<boolean>`${accountBalanceSnapshots.observedAt} = ${capture.observedAt}::timestamptz`,
      sameProviderAsOf: sql<boolean>`${accountBalanceSnapshots.providerAsOf} is not distinct from ${capture.providerAsOf}::timestamptz`,
    })
    .from(accountBalanceSnapshots)
    .innerJoin(accounts, and(
      eq(accounts.id, accountBalanceSnapshots.accountId),
      eq(accounts.userId, capture.userId),
      eq(accounts.currency, capture.currency),
      eq(accounts.source, capture.source === "provider" ? "plaid" : "manual"),
    ))
    .where(
      and(
        eq(accountBalanceSnapshots.accountId, capture.accountId),
        eq(accountBalanceSnapshots.userId, capture.userId),
        eq(accountBalanceSnapshots.snapshotDay, snapshotDay),
      ),
    );
  if (!existing || existing.currency !== capture.currency || existing.source !== capture.source) {
    invariantConflict(capture, snapshotDay);
  }
  if (
    existing.sameObservation &&
    (existing.currentMinor !== capture.currentMinor || !existing.sameProviderAsOf)
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

export type BalanceHistoryRange = {
  from: string;
  to: string;
  accountIds?: readonly string[];
};

export type ParsedBalanceHistoryRange =
  | { ok: true; range: BalanceHistoryRange }
  | { ok: false };

const RANGE_KEYS = new Set(["from", "to", "accountIds"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_BALANCE_HISTORY_DAYS = 3_660;
const DAY_MS = 86_400_000;

const isUuid = (value: unknown): value is string =>
  typeof value === "string" && UUID.test(value);

function inclusiveDayCount(from: string, to: string): number {
  return (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS + 1;
}

export function parseBalanceHistoryRange(input: unknown): ParsedBalanceHistoryRange {
  if (!isPlainObject(input) || Object.keys(input).some((key) => !RANGE_KEYS.has(key))) {
    return { ok: false };
  }

  const { from, to, accountIds } = input;
  if (
    typeof from !== "string" ||
    typeof to !== "string" ||
    !isIsoDate(from) ||
    !isIsoDate(to) ||
    from > to ||
    inclusiveDayCount(from, to) > MAX_BALANCE_HISTORY_DAYS
  ) {
    return { ok: false };
  }
  if (accountIds === undefined) return { ok: true, range: { from, to } };
  if (!Array.isArray(accountIds) || !accountIds.every(isUuid)) return { ok: false };
  return { ok: true, range: { from, to, accountIds } };
}

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
  range: BalanceHistoryRange,
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

export async function manualBalanceHistory(
  range: BalanceHistoryRange,
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

export type BalanceHistoryPoint = ProviderBalanceHistoryPoint | ManualBalanceHistoryPoint;

export type AccountBalanceHistory = {
  accountId: string;
  accountType: (typeof accounts.$inferSelect)["type"];
  currency: string;
  points: BalanceHistoryPoint[];
};

const TYPE_ORDER: readonly string[] = accountType.enumValues;

async function reconcileCurrentBalanceHistory(range: BalanceHistoryRange): Promise<void> {
  const user = await requireUser();
  try {
    await withRequestScope(user.clerkUserId, async (tx) => {
      if (range.accountIds?.length === 0) return;

      const accountScope = [
        eq(accounts.userId, user.id),
        eq(accountBalances.userId, user.id),
        isNotNull(accountBalances.currentMinor),
        or(
          eq(accounts.source, "plaid"),
          and(eq(accounts.source, "manual"), isNotNull(accountBalances.reportedOn)),
        )!,
        notExists(
          tx
            .select({ accountId: accountBalanceSnapshots.accountId })
            .from(accountBalanceSnapshots)
            .where(
              and(
                eq(accountBalanceSnapshots.accountId, accounts.id),
                eq(accountBalanceSnapshots.userId, user.id),
                eq(accountBalanceSnapshots.observedAt, accountBalances.asOf),
                or(
                  and(
                    eq(accounts.source, "plaid"),
                    eq(accountBalanceSnapshots.source, "provider"),
                  ),
                  and(
                    eq(accounts.source, "manual"),
                    eq(accountBalanceSnapshots.source, "manual_anchor"),
                  ),
                ),
              ),
            ),
        ),
      ];
      if (range.accountIds) accountScope.push(inArray(accounts.id, range.accountIds));
      const candidates = await tx
        .select({
          accountId: accounts.id,
          currency: accounts.currency,
          source: accounts.source,
          currentMinor: accountBalances.currentMinor,
          observedAt: sql<string>`${accountBalances.asOf}::text`,
          reportedOn: accountBalances.reportedOn,
        })
        .from(accounts)
        .innerJoin(
          accountBalances,
          and(eq(accountBalances.accountId, accounts.id), eq(accountBalances.userId, user.id)),
        )
        .where(and(...accountScope));

      for (const candidate of candidates) {
        if (candidate.currentMinor === null) continue;
        if (candidate.source === "plaid") {
          await captureBalanceSnapshot(tx, {
            accountId: candidate.accountId,
            userId: user.id,
            currentMinor: candidate.currentMinor,
            currency: candidate.currency,
            source: "provider",
            captureReason: "reconciliation",
            observedAt: candidate.observedAt,
            providerAsOf: null,
          });
        } else if (candidate.reportedOn !== null) {
          await captureBalanceSnapshot(tx, {
            accountId: candidate.accountId,
            userId: user.id,
            currentMinor: candidate.currentMinor,
            currency: candidate.currency,
            source: "manual_anchor",
            snapshotDay: candidate.reportedOn,
            captureReason: "reconciliation",
            observedAt: candidate.observedAt,
            providerAsOf: null,
          });
        }
      }
    });
  } catch (error) {
    logEvent("balance_snapshot.reconciliation_failed", { error: errorClass(error) });
  }
}

export async function accountBalanceHistory(
  range: BalanceHistoryRange,
): Promise<AccountBalanceHistory[]> {
  await reconcileCurrentBalanceHistory(range);
  const provider = await providerBalanceHistory(range);
  const manual = await manualBalanceHistory(range);
  return [...provider, ...manual].sort(
    (a, b) =>
      TYPE_ORDER.indexOf(a.accountType) - TYPE_ORDER.indexOf(b.accountType) ||
      a.accountId.localeCompare(b.accountId),
  );
}
