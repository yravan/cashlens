import { eq, sql } from "drizzle-orm";
import { expect, test, vi } from "vitest";

import { POST as updateManualBalance } from "@/app/api/accounts/[accountId]/manual/route";
import { POST as createManualAccount } from "@/app/api/accounts/manual/route";
import {
  captureBalanceSnapshot,
  manualBalanceHistory,
  providerBalanceHistory,
} from "@/lib/data/balance-history";
import { withRequestScope } from "@/lib/db/client";
import { accountBalances, accountBalanceSnapshots, transactions } from "@/lib/db/schema";
import { withAuth } from "../harness/clerk";
import { adminDb } from "../harness/db";
import { anchoredAccount, provisionedUser, request } from "./offline-helpers";

test("snapshot storage forces owner-scoped RLS", async () => {
  const catalog = await adminDb().execute(sql`
    select relrowsecurity as "rlsEnabled", relforcerowsecurity as "rlsForced"
    from pg_class
    where relname = 'account_balance_snapshots'
  `);
  expect(catalog.rows).toEqual([{ rlsEnabled: true, rlsForced: true }]);

  const owner = await provisionedUser();
  const neighbor = await provisionedUser();
  const accountId = await anchoredAccount({
    userId: owner.id,
    name: "Checking",
    type: "depository",
    source: "plaid",
    currentMinor: 12345,
    reportedOn: null,
  });
  const observedAt = new Date("2026-04-01T12:00:00Z");

  await withRequestScope(owner.clerkUserId, (tx) =>
    tx.execute(sql`
      insert into account_balance_snapshots (
        account_id, user_id, snapshot_day, current_minor, currency,
        source, capture_reason, observed_at, provider_as_of
      ) values (
        ${accountId}, ${owner.id}, '2026-04-01', 12345, 'USD',
        'provider', 'event', ${observedAt}, null
      )
    `),
  );

  const visible = await withRequestScope(owner.clerkUserId, (tx) =>
    tx.execute(sql`
      select account_id::text as "accountId", current_minor::int as "currentMinor"
      from account_balance_snapshots
    `),
  );
  expect(visible.rows).toEqual([{ accountId, currentMinor: 12345 }]);

  const hidden = await withRequestScope(neighbor.clerkUserId, (tx) =>
    tx.execute(sql`select account_id from account_balance_snapshots`),
  );
  expect(hidden.rows).toEqual([]);
});

test("manual create captures the raw anchor at the current projection instant", async () => {
  const owner = await provisionedUser();
  const response = await withAuth(owner.clerkUserId, () =>
    createManualAccount(
      request(
        "http://localhost/api/accounts/manual",
        JSON.stringify({
          name: "Wallet",
          type: "other",
          currency: "USD",
          balance: "250.00",
          reportedOn: "2026-09-12",
        }),
      ),
    ),
  );
  expect(response.status).toBe(201);
  const { accountId } = await response.json();

  const [balance] = await adminDb()
    .select()
    .from(accountBalances)
    .where(eq(accountBalances.accountId, accountId));
  const snapshots = await adminDb()
    .select()
    .from(accountBalanceSnapshots)
    .where(eq(accountBalanceSnapshots.accountId, accountId));

  expect(snapshots).toHaveLength(1);
  expect(snapshots[0]).toMatchObject({
    userId: owner.id,
    snapshotDay: "2026-09-12",
    currentMinor: 25000,
    currency: "USD",
    source: "manual_anchor",
    captureReason: "event",
    providerAsOf: null,
  });
  expect(snapshots[0].observedAt).toEqual(balance.asOf);
});

test("a later manual anchor corrects the same reported day", async () => {
  const owner = await provisionedUser();
  const created = await withAuth(owner.clerkUserId, () =>
    createManualAccount(
      request(
        "http://localhost/api/accounts/manual",
        JSON.stringify({
          name: "Wallet",
          type: "other",
          currency: "USD",
          balance: "250.00",
          reportedOn: "2026-09-12",
        }),
      ),
    ),
  );
  const { accountId } = await created.json();

  const updated = await withAuth(owner.clerkUserId, () =>
    updateManualBalance(
      request(
        `http://localhost/api/accounts/${accountId}/manual`,
        JSON.stringify({ balance: "275.00", reportedOn: "2026-09-12" }),
      ),
      { params: Promise.resolve({ accountId }) },
    ),
  );
  expect(updated.status).toBe(200);

  const [balance] = await adminDb()
    .select()
    .from(accountBalances)
    .where(eq(accountBalances.accountId, accountId));
  const snapshots = await adminDb()
    .select()
    .from(accountBalanceSnapshots)
    .where(eq(accountBalanceSnapshots.accountId, accountId));

  expect(snapshots).toHaveLength(1);
  expect(snapshots[0]).toMatchObject({
    snapshotDay: "2026-09-12",
    currentMinor: 27500,
    source: "manual_anchor",
    captureReason: "event",
  });
  expect(snapshots[0].observedAt).toEqual(balance.asOf);
});

test("provider snapshot days use UTC regardless of the database timezone", async () => {
  const owner = await provisionedUser();
  const accountId = await anchoredAccount({
    userId: owner.id,
    name: "Checking",
    type: "depository",
    source: "plaid",
    currentMinor: 10000,
    reportedOn: null,
  });

  await withRequestScope(owner.clerkUserId, async (tx) => {
    await tx.execute(sql`set local time zone 'Pacific/Honolulu'`);
    await captureBalanceSnapshot(tx, {
      accountId,
      userId: owner.id,
      currentMinor: 10000,
      currency: "USD",
      source: "provider",
      captureReason: "event",
      observedAt: new Date("2026-04-02T00:30:00Z"),
      providerAsOf: null,
    });
  });

  const [snapshot] = await adminDb()
    .select()
    .from(accountBalanceSnapshots)
    .where(eq(accountBalanceSnapshots.accountId, accountId));
  expect(snapshot.snapshotDay).toBe("2026-04-02");
});

test("provider history labels observed, carried, and unavailable days with provenance", async () => {
  const owner = await provisionedUser();
  const neighbor = await provisionedUser();
  const accountId = await anchoredAccount({
    userId: owner.id,
    name: "Card",
    type: "credit",
    source: "plaid",
    currency: "EUR",
    currentMinor: 0,
    reportedOn: null,
  });
  const neighborAccountId = await anchoredAccount({
    userId: neighbor.id,
    name: "Neighbor checking",
    type: "depository",
    source: "plaid",
    currentMinor: 99999,
    reportedOn: null,
  });
  const firstObservedAt = new Date("2026-04-02T10:00:00Z");
  const firstProviderAsOf = new Date("2026-04-02T09:45:00Z");
  const latestObservedAt = new Date("2026-04-04T11:00:00Z");

  await withRequestScope(owner.clerkUserId, async (tx) => {
    await captureBalanceSnapshot(tx, {
      accountId,
      userId: owner.id,
      currentMinor: 12500,
      currency: "EUR",
      source: "provider",
      captureReason: "event",
      observedAt: firstObservedAt,
      providerAsOf: firstProviderAsOf,
    });
    await captureBalanceSnapshot(tx, {
      accountId,
      userId: owner.id,
      currentMinor: 0,
      currency: "EUR",
      source: "provider",
      captureReason: "reconciliation",
      observedAt: latestObservedAt,
      providerAsOf: null,
    });
  });
  await withRequestScope(neighbor.clerkUserId, (tx) =>
    captureBalanceSnapshot(tx, {
      accountId: neighborAccountId,
      userId: neighbor.id,
      currentMinor: 99999,
      currency: "USD",
      source: "provider",
      captureReason: "event",
      observedAt: firstObservedAt,
      providerAsOf: null,
    }),
  );
  await adminDb()
    .update(accountBalances)
    .set({ currentMinor: 0, asOf: latestObservedAt })
    .where(eq(accountBalances.accountId, accountId));

  const history = await withAuth(owner.clerkUserId, () =>
    providerBalanceHistory({ from: "2026-04-01", to: "2026-04-05" }),
  );

  expect(history).toEqual([
    {
      accountId,
      accountType: "credit",
      currency: "EUR",
      points: [
        { day: "2026-04-01", basis: "unavailable", currentMinor: null },
        {
          day: "2026-04-02",
          basis: "observed",
          currentMinor: 12500,
          observedDay: "2026-04-02",
          observedAt: firstObservedAt,
          providerAsOf: firstProviderAsOf,
          captureReason: "event",
        },
        {
          day: "2026-04-03",
          basis: "carried",
          currentMinor: 12500,
          observedDay: "2026-04-02",
          observedAt: firstObservedAt,
          providerAsOf: firstProviderAsOf,
          captureReason: "event",
        },
        {
          day: "2026-04-04",
          basis: "observed",
          currentMinor: 0,
          observedDay: "2026-04-04",
          observedAt: latestObservedAt,
          providerAsOf: null,
          captureReason: "reconciliation",
        },
        {
          day: "2026-04-05",
          basis: "carried",
          currentMinor: 0,
          observedDay: "2026-04-04",
          observedAt: latestObservedAt,
          providerAsOf: null,
          captureReason: "reconciliation",
        },
      ],
    },
  ]);

  const stored = await adminDb()
    .select({ snapshotDay: accountBalanceSnapshots.snapshotDay })
    .from(accountBalanceSnapshots)
    .where(eq(accountBalanceSnapshots.accountId, accountId))
    .orderBy(accountBalanceSnapshots.snapshotDay);
  expect(stored).toEqual([{ snapshotDay: "2026-04-02" }, { snapshotDay: "2026-04-04" }]);
});

test("manual history keeps raw anchors while deriving posted owed balances", async () => {
  const owner = await provisionedUser();
  const neighbor = await provisionedUser();
  const accountId = await anchoredAccount({
    userId: owner.id,
    name: "Card",
    type: "credit",
    source: "manual",
    currentMinor: 7000,
    reportedOn: "2026-04-03",
  });
  const neighborAccountId = await anchoredAccount({
    userId: neighbor.id,
    name: "Neighbor wallet",
    type: "depository",
    source: "manual",
    currentMinor: 99999,
    reportedOn: "2026-04-01",
  });
  const firstObservedAt = new Date("2026-04-01T12:00:00Z");
  const latestObservedAt = new Date("2026-04-03T12:00:00Z");

  await withRequestScope(owner.clerkUserId, async (tx) => {
    await captureBalanceSnapshot(tx, {
      accountId,
      userId: owner.id,
      currentMinor: 5000,
      currency: "USD",
      source: "manual_anchor",
      snapshotDay: "2026-04-01",
      captureReason: "event",
      observedAt: firstObservedAt,
      providerAsOf: null,
    });
    await captureBalanceSnapshot(tx, {
      accountId,
      userId: owner.id,
      currentMinor: 7000,
      currency: "USD",
      source: "manual_anchor",
      snapshotDay: "2026-04-03",
      captureReason: "event",
      observedAt: latestObservedAt,
      providerAsOf: null,
    });
  });
  await withRequestScope(neighbor.clerkUserId, (tx) =>
    captureBalanceSnapshot(tx, {
      accountId: neighborAccountId,
      userId: neighbor.id,
      currentMinor: 99999,
      currency: "USD",
      source: "manual_anchor",
      snapshotDay: "2026-04-01",
      captureReason: "event",
      observedAt: firstObservedAt,
      providerAsOf: null,
    }),
  );
  const rows = [
    { date: "2026-04-01", amountMinor: -100, createdAt: "2026-04-01T11:00:00Z", status: "posted" },
    { date: "2026-04-01", amountMinor: -200, createdAt: "2026-04-01T12:00:00Z", status: "posted" },
    { date: "2026-04-01", amountMinor: -300, createdAt: "2026-04-01T13:00:00Z", status: "posted" },
    { date: "2026-04-02", amountMinor: 500, createdAt: "2026-04-02T10:00:00Z", status: "posted" },
    { date: "2026-04-02", amountMinor: -900, createdAt: "2026-04-02T11:00:00Z", status: "pending" },
    { date: "2026-04-03", amountMinor: -700, createdAt: "2026-04-03T13:00:00Z", status: "posted" },
    { date: "2026-04-04", amountMinor: 1000, createdAt: "2026-04-04T10:00:00Z", status: "posted" },
  ] as const;
  await adminDb()
    .insert(transactions)
    .values(
      rows.map((row, index) => ({
        userId: owner.id,
        accountId,
        amountMinor: row.amountMinor,
        currency: "USD",
        date: row.date,
        description: `History row ${index}`,
        status: row.status,
        source: "manual" as const,
        createdAt: new Date(row.createdAt),
      })),
    );
  await adminDb().execute(sql`
    insert into transactions (
      user_id, account_id, amount_minor, currency, date,
      description, status, source, created_at
    ) values (
      ${owner.id}, ${accountId}, -50, 'USD', '2026-04-01',
      'After anchor by one microsecond', 'posted', 'manual',
      '2026-04-01 12:00:00.000001+00'::timestamptz
    )
  `);

  const history = await withAuth(owner.clerkUserId, () =>
    manualBalanceHistory({
      from: "2026-03-31",
      to: "2026-04-04",
      accountIds: [accountId, neighborAccountId],
    }),
  );

  expect(history).toEqual([
    {
      accountId,
      accountType: "credit",
      currency: "USD",
      points: [
        { day: "2026-03-31", basis: "unavailable", currentMinor: null },
        {
          day: "2026-04-01",
          basis: "derived",
          currentMinor: 5350,
          anchorMinor: 5000,
          anchorDay: "2026-04-01",
          anchorObservedAt: firstObservedAt,
          captureReason: "event",
        },
        {
          day: "2026-04-02",
          basis: "derived",
          currentMinor: 4850,
          anchorMinor: 5000,
          anchorDay: "2026-04-01",
          anchorObservedAt: firstObservedAt,
          captureReason: "event",
        },
        {
          day: "2026-04-03",
          basis: "derived",
          currentMinor: 7700,
          anchorMinor: 7000,
          anchorDay: "2026-04-03",
          anchorObservedAt: latestObservedAt,
          captureReason: "event",
        },
        {
          day: "2026-04-04",
          basis: "derived",
          currentMinor: 6700,
          anchorMinor: 7000,
          anchorDay: "2026-04-03",
          anchorObservedAt: latestObservedAt,
          captureReason: "event",
        },
      ],
    },
  ]);

  const stored = await adminDb()
    .select({
      snapshotDay: accountBalanceSnapshots.snapshotDay,
      currentMinor: accountBalanceSnapshots.currentMinor,
    })
    .from(accountBalanceSnapshots)
    .where(eq(accountBalanceSnapshots.accountId, accountId))
    .orderBy(accountBalanceSnapshots.snapshotDay);
  expect(stored).toEqual([
    { snapshotDay: "2026-04-01", currentMinor: 5000 },
    { snapshotDay: "2026-04-03", currentMinor: 7000 },
  ]);
});

test("an older genuine provider observation cannot replace a newer one", async () => {
  const owner = await provisionedUser();
  const accountId = await anchoredAccount({
    userId: owner.id,
    name: "Checking",
    type: "depository",
    source: "plaid",
    currentMinor: 10000,
    reportedOn: null,
  });
  const newerProviderTime = new Date("2026-04-01T09:00:00Z");

  await withRequestScope(owner.clerkUserId, (tx) =>
    captureBalanceSnapshot(tx, {
      accountId,
      userId: owner.id,
      currentMinor: 10000,
      currency: "USD",
      source: "provider",
      captureReason: "event",
      observedAt: new Date("2026-04-01T10:00:00Z"),
      providerAsOf: newerProviderTime,
    }),
  );
  await withRequestScope(owner.clerkUserId, (tx) =>
    captureBalanceSnapshot(tx, {
      accountId,
      userId: owner.id,
      currentMinor: 9000,
      currency: "USD",
      source: "provider",
      captureReason: "reconciliation",
      observedAt: new Date("2026-04-01T11:00:00Z"),
      providerAsOf: new Date("2026-04-01T08:00:00Z"),
    }),
  );

  const [snapshot] = await adminDb()
    .select()
    .from(accountBalanceSnapshots)
    .where(eq(accountBalanceSnapshots.accountId, accountId));
  expect(snapshot).toMatchObject({
    currentMinor: 10000,
    captureReason: "event",
    observedAt: new Date("2026-04-01T10:00:00Z"),
    providerAsOf: newerProviderTime,
  });
});

test("an equal-time contradiction fails closed with a sanitized event", async () => {
  const owner = await provisionedUser();
  const accountId = await anchoredAccount({
    userId: owner.id,
    name: "Checking",
    type: "depository",
    source: "plaid",
    currentMinor: 10000,
    reportedOn: null,
  });
  const observedAt = new Date("2026-04-01T10:00:00Z");
  const providerAsOf = new Date("2026-04-01T09:00:00Z");

  await withRequestScope(owner.clerkUserId, (tx) =>
    captureBalanceSnapshot(tx, {
      accountId,
      userId: owner.id,
      currentMinor: 10000,
      currency: "USD",
      source: "provider",
      captureReason: "event",
      observedAt,
      providerAsOf,
    }),
  );

  const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
  try {
    await expect(
      withRequestScope(owner.clerkUserId, (tx) =>
        captureBalanceSnapshot(tx, {
          accountId,
          userId: owner.id,
          currentMinor: 812345,
          currency: "USD",
          source: "provider",
          captureReason: "reconciliation",
          observedAt,
          providerAsOf,
        }),
      ),
    ).rejects.toThrow("balance snapshot invariant conflict");

    const logs = info.mock.calls.map(([line]) => line);
    expect(logs).toEqual([
      JSON.stringify({
        event: "balance_snapshot.invariant_conflict",
        accountId,
        source: "provider",
        snapshotDay: "2026-04-01",
      }),
    ]);
    expect(logs.join("\n")).not.toMatch(/812345|10000|USD/);
  } finally {
    info.mockRestore();
  }

  const [snapshot] = await adminDb()
    .select()
    .from(accountBalanceSnapshots)
    .where(eq(accountBalanceSnapshots.accountId, accountId));
  expect(snapshot).toMatchObject({
    currentMinor: 10000,
    captureReason: "event",
    observedAt,
    providerAsOf,
  });
});

test("a candidate currency mismatch writes no snapshot or amount log", async () => {
  const owner = await provisionedUser();
  const accountId = await anchoredAccount({
    userId: owner.id,
    name: "Checking",
    type: "depository",
    source: "plaid",
    currentMinor: 10000,
    reportedOn: null,
  });

  const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
  try {
    await expect(
      withRequestScope(owner.clerkUserId, (tx) =>
        captureBalanceSnapshot(tx, {
          accountId,
          userId: owner.id,
          currentMinor: 812345,
          currency: "EUR",
          source: "provider",
          captureReason: "event",
          observedAt: new Date("2026-04-01T10:00:00Z"),
          providerAsOf: null,
        }),
      ),
    ).rejects.toThrow("balance snapshot invariant conflict");

    const logs = info.mock.calls.map(([line]) => line);
    expect(logs).toEqual([
      JSON.stringify({
        event: "balance_snapshot.invariant_conflict",
        accountId,
        source: "provider",
        snapshotDay: "2026-04-01",
      }),
    ]);
    expect(logs.join("\n")).not.toMatch(/812345|EUR/);
  } finally {
    info.mockRestore();
  }

  const snapshots = await adminDb()
    .select()
    .from(accountBalanceSnapshots)
    .where(eq(accountBalanceSnapshots.accountId, accountId));
  expect(snapshots).toEqual([]);
});
