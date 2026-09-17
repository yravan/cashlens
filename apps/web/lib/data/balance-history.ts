import "server-only";
import { and, eq, sql } from "drizzle-orm";

import type { ScopedTx } from "@/lib/db/client";
import { accountBalanceSnapshots } from "@/lib/db/schema";
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
