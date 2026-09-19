import { eq, sql } from "drizzle-orm";
import { expect, test, vi } from "vitest";

import { POST as importStatement } from "@/app/api/accounts/[accountId]/manual/import/route";
import { POST as updateManualBalance } from "@/app/api/accounts/[accountId]/manual/route";
import { POST as createManualAccount } from "@/app/api/accounts/manual/route";
import { POST as deleteTransaction } from "@/app/api/transactions/[transactionId]/manual/delete/route";
import { POST as updateTransaction } from "@/app/api/transactions/[transactionId]/manual/route";
import { POST as createTransaction } from "@/app/api/transactions/manual/route";
import {
  accountBalanceHistory,
  captureBalanceSnapshot,
  manualBalanceHistory,
  parseBalanceHistoryRange,
  providerBalanceHistory,
  type BalanceSnapshotCapture,
} from "@/lib/data/balance-history";
import { withRequestScope } from "@/lib/db/client";
import { accountBalances, accountBalanceSnapshots, accounts, transactions, users } from "@/lib/db/schema";
import { withAuth } from "../harness/clerk";
import { adminDb, appQuery, appQueryScopedAs } from "../harness/db";
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

async function captureFixture(source: "plaid" | "manual" | "import" = "plaid") {
  const owner = await provisionedUser();
  const accountId = await anchoredAccount({
    userId: owner.id, name: "History account", type: "depository", source, currentMinor: 10000,
  });
  const capture: BalanceSnapshotCapture = {
    accountId, userId: owner.id, currency: "USD", currentMinor: 10000,
    captureReason: "event", observedAt: new Date("2026-04-01T12:00:00Z"),
    ...(source === "manual"
      ? { source: "manual_anchor", snapshotDay: "2026-04-01", providerAsOf: null }
      : { source: "provider", providerAsOf: null }),
  };
  const write = (value: BalanceSnapshotCapture = capture) =>
    withRequestScope(owner.clerkUserId, (tx) => captureBalanceSnapshot(tx, value));
  const stored = () => adminDb().select().from(accountBalanceSnapshots)
    .where(eq(accountBalanceSnapshots.accountId, accountId));
  return { owner, accountId, capture, write, stored };
}

test.each([
  ["manual", "provider"], ["import", "provider"],
  ["plaid", "manual_anchor"], ["import", "manual_anchor"],
] as const)("%s accounts reject incompatible %s captures", async (accountSource, source) => {
  const fixture = await captureFixture(accountSource);
  const invalid: BalanceSnapshotCapture = {
    ...fixture.capture, source, snapshotDay: "2026-04-01", providerAsOf: null,
  };
  await expect(fixture.write(invalid)).rejects.toThrow("balance snapshot invariant conflict");
  expect(await fixture.stored()).toEqual([]);
});

test.each(["11", "12", "13"])("existing captures reject currency/source conflicts at %s:00", async (hour) => {
  const fixture = await captureFixture();
  await fixture.write();
  const before = await fixture.stored();
  const observedAt = new Date(`2026-04-01T${hour}:00:00Z`);
  for (const invalid of [
    { ...fixture.capture, currency: "EUR", observedAt },
    { ...fixture.capture, source: "manual_anchor" as const, snapshotDay: "2026-04-01", providerAsOf: null, observedAt },
  ]) {
    await expect(fixture.write(invalid)).rejects.toThrow("balance snapshot invariant conflict");
    expect(await fixture.stored()).toEqual(before);
  }
});

test.each(["plaid", "manual"] as const)("%s replay is a complete no-op and fresh observations correct or extend history", async (source) => {
  const fixture = await captureFixture(source);
  await fixture.write();
  await adminDb().update(accountBalanceSnapshots).set({ updatedAt: new Date("2026-04-01T12:01:00Z") });
  const before = await fixture.stored();
  for (const captureReason of ["bootstrap", "reconciliation", "event"] as const) {
    await fixture.write({ ...fixture.capture, captureReason });
    expect(await fixture.stored()).toEqual(before);
  }
  const later = { ...fixture.capture, currentMinor: 11000, observedAt: new Date("2026-04-01T13:00:00Z"), captureReason: "reconciliation" as const };
  await fixture.write(later);
  const corrected = await fixture.stored();
  expect(corrected).toHaveLength(1);
  expect(corrected[0]).toMatchObject({ currentMinor: 11000, observedAt: later.observedAt, captureReason: "reconciliation", createdAt: before[0].createdAt });
  expect(corrected[0].updatedAt).not.toEqual(before[0].updatedAt);
  await fixture.write(fixture.capture);
  expect(await fixture.stored()).toEqual(corrected);
  const next = { ...later, observedAt: new Date("2026-04-02T13:00:00Z") };
  if (next.source === "manual_anchor") next.snapshotDay = "2026-04-02";
  await fixture.write(next);
  const extended = await fixture.stored();
  expect(extended.map(({ snapshotDay, currentMinor }) => ({ snapshotDay, currentMinor })).sort((a, b) => a.snapshotDay.localeCompare(b.snapshotDay)))
    .toEqual([{ snapshotDay: "2026-04-01", currentMinor: 11000 }, { snapshotDay: "2026-04-02", currentMinor: 11000 }]);
});

test("equal observation times reject contradictory provider provenance and permit later correction", async () => {
  const fixture = await captureFixture();
  await fixture.write();
  const before = await fixture.stored();
  const providerAsOf = new Date("2026-04-01T11:00:00Z");
  await expect(fixture.write({ ...fixture.capture, source: "provider", providerAsOf }))
    .rejects.toThrow("balance snapshot invariant conflict");
  expect(await fixture.stored()).toEqual(before);
  await fixture.write({ ...fixture.capture, source: "provider", providerAsOf, observedAt: new Date("2026-04-01T13:00:00Z") });
  expect((await fixture.stored())[0]).toMatchObject({ providerAsOf, observedAt: new Date("2026-04-01T13:00:00Z") });
});

test.each([
  [false, false], [false, true], [true, false], [true, true],
])("concurrent captures converge with existing=%s and newer-first=%s", async (existing, newerFirst) => {
  const fixture = await captureFixture();
  if (existing) await fixture.write({ ...fixture.capture, observedAt: new Date("2026-04-01T10:00:00Z") });
  const older = { ...fixture.capture, currentMinor: 12000 };
  const newer = { ...fixture.capture, currentMinor: 13000, observedAt: new Date("2026-04-01T13:00:00Z") };
  let release!: () => void;
  const released = new Promise<void>((resolve) => { release = resolve; });
  let ready!: (pid: number) => void;
  let failReady!: (error: unknown) => void;
  const acquired = new Promise<number>((resolve, reject) => { ready = resolve; failReady = reject; });
  const first = withRequestScope(fixture.owner.clerkUserId, async (tx) => {
    const result = await tx.execute(sql`select pg_backend_pid() as pid`);
    await captureBalanceSnapshot(tx, newerFirst ? newer : older);
    ready(Number(result.rows[0].pid));
    await released;
  });
  void first.catch(failReady);
  let second: Promise<void> | undefined;
  try {
    const firstPid = await acquired;
    second = fixture.write(newerFirst ? older : newer);
    void second.catch(() => undefined);
    const deadline = Date.now() + 5_000;
    let blocked = false;
    while (!blocked && Date.now() < deadline) {
      const result = await adminDb().execute(sql`select exists (
        select 1 from pg_stat_activity where ${firstPid} = any(pg_blocking_pids(pid))
      ) as blocked`);
      blocked = Boolean(result.rows[0].blocked);
      if (!blocked) await new Promise<void>((resolve) => setImmediate(resolve));
    }
    expect(blocked, "the second real capture must wait on the first transaction").toBe(true);
  } finally {
    release();
    const outcomes = await Promise.allSettled([first, ...(second ? [second] : [])]);
    expect(outcomes).toEqual([{ status: "fulfilled", value: undefined }, { status: "fulfilled", value: undefined }]);
  }
  const stored = await fixture.stored();
  expect(stored).toHaveLength(1);
  expect(stored[0]).toMatchObject({ currentMinor: 13000, snapshotDay: "2026-04-01", observedAt: newer.observedAt });
});

test("one account cannot store duplicate observations for a day", async () => {
  const fixture = await captureFixture();
  const row = {
    accountId: fixture.accountId, userId: fixture.owner.id, snapshotDay: "2026-04-01",
    currentMinor: 10000, currency: "USD", source: "provider" as const, captureReason: "event" as const,
    observedAt: new Date("2026-04-01T12:00:00Z"),
  };
  await adminDb().insert(accountBalanceSnapshots).values(row);
  await expect(appQueryScopedAs(fixture.owner.clerkUserId, `insert into account_balance_snapshots (
    account_id, user_id, snapshot_day, current_minor, currency, source, capture_reason, observed_at
  ) values ($1, $2, '2026-04-01', 20000, 'USD', 'provider', 'event', '2026-04-01T13:00:00Z')`,
  [fixture.accountId, fixture.owner.id])).rejects.toMatchObject({ code: "23505" });
  expect((await fixture.stored()).map(({ currentMinor }) => currentMinor)).toEqual([10000]);
});

test("snapshot runtime privileges are exactly the approved column sets", async () => {
  const privileges = await appQuery(`select privilege_type, array_agg(column_name::text order by column_name) as columns
    from information_schema.column_privileges where grantee = current_user
      and table_schema = 'public' and table_name = 'account_balance_snapshots'
    group by privilege_type order by privilege_type`);
  expect(privileges.rows).toEqual([
    { privilege_type: "INSERT", columns: ["account_id", "capture_reason", "currency", "current_minor", "observed_at", "provider_as_of", "snapshot_day", "source", "user_id"] },
    { privilege_type: "SELECT", columns: ["account_id", "capture_reason", "created_at", "currency", "current_minor", "observed_at", "provider_as_of", "snapshot_day", "source", "updated_at", "user_id"] },
    { privilege_type: "UPDATE", columns: ["capture_reason", "current_minor", "observed_at", "provider_as_of", "updated_at"] },
  ]);
  expect((await appQuery(`select privilege_type from information_schema.table_privileges
    where grantee = current_user and table_schema = 'public' and table_name = 'account_balance_snapshots'
    order by privilege_type`)).rows).toEqual([{ privilege_type: "SELECT" }]);
});

test("runtime cannot rewrite snapshot identity or timestamps on insert, delete, or truncate", async () => {
  const fixture = await captureFixture();
  await fixture.write();
  const before = await fixture.stored();
  for (const column of ["account_id", "user_id", "snapshot_day", "currency", "source", "created_at"]) {
    await expect(appQueryScopedAs(fixture.owner.clerkUserId,
      `update account_balance_snapshots set ${column} = ${column}`)).rejects.toMatchObject({ code: "42501" });
  }
  for (const column of ["created_at", "updated_at"]) {
    await expect(appQueryScopedAs(fixture.owner.clerkUserId, `insert into account_balance_snapshots
      (account_id, user_id, snapshot_day, current_minor, currency, source, capture_reason, observed_at, ${column})
      values ($1, $2, '2026-04-02', 10000, 'USD', 'provider', 'event', '2026-04-02T12:00:00Z', now())`,
    [fixture.accountId, fixture.owner.id])).rejects.toMatchObject({ code: "42501" });
  }
  for (const command of ["delete from account_balance_snapshots", "truncate account_balance_snapshots"]) {
    await expect(appQueryScopedAs(fixture.owner.clerkUserId, command)).rejects.toMatchObject({ code: "42501" });
  }
  expect(await fixture.stored()).toEqual(before);
});

test("raw snapshot writes enforce scope and composite ownership even without DAL predicates", async () => {
  const fixture = await captureFixture();
  const neighbor = await captureFixture();
  await fixture.write();
  await neighbor.write();
  const before = await fixture.stored();
  const query = "select account_id from account_balance_snapshots order by account_id";
  expect((await appQuery(query)).rows).toEqual([]);
  expect((await appQueryScopedAs(neighbor.owner.clerkUserId, query)).rows).toEqual([{ account_id: neighbor.accountId }]);
  expect((await appQueryScopedAs(neighbor.owner.clerkUserId,
    "update account_balance_snapshots set current_minor = 99999 where account_id = $1 returning account_id", [fixture.accountId])).rows).toEqual([]);
  expect((await appQuery("update account_balance_snapshots set current_minor = 99999 returning account_id")).rows).toEqual([]);
  expect((await appQueryScopedAs(fixture.owner.clerkUserId,
    "update account_balance_snapshots set current_minor = 12000 returning account_id, current_minor::int")).rows)
    .toEqual([{ account_id: fixture.accountId, current_minor: 12000 }]);
  const insert = `insert into account_balance_snapshots
    (account_id, user_id, snapshot_day, current_minor, currency, source, capture_reason, observed_at)
    values ($1, $2, '2026-04-02', 10000, 'USD', 'provider', 'event', '2026-04-02T12:00:00Z')`;
  await expect(appQuery(insert, [fixture.accountId, fixture.owner.id])).rejects.toMatchObject({ code: "42501" });
  await expect(appQueryScopedAs(neighbor.owner.clerkUserId, insert, [fixture.accountId, fixture.owner.id]))
    .rejects.toMatchObject({ code: "42501" });
  await expect(appQueryScopedAs(neighbor.owner.clerkUserId, insert, [fixture.accountId, neighbor.owner.id]))
    .rejects.toMatchObject({ code: "23503" });
  expect(await fixture.stored()).toEqual(before);
});

test("account and whole-user purge cascade snapshots without affecting another owner", async () => {
  const fixture = await captureFixture();
  const neighbor = await captureFixture();
  await fixture.write();
  await neighbor.write();
  const retained = await neighbor.stored();
  await withRequestScope(neighbor.owner.clerkUserId, (tx) => tx.delete(accounts).where(eq(accounts.id, fixture.accountId)));
  expect(await fixture.stored()).toHaveLength(1);
  await withRequestScope(fixture.owner.clerkUserId, (tx) => tx.delete(accounts).where(eq(accounts.id, fixture.accountId)));
  expect(await fixture.stored()).toEqual([]);
  const secondAccount = await anchoredAccount({ userId: fixture.owner.id, name: "Second", type: "other", currentMinor: 30000 });
  await fixture.write({ ...fixture.capture, accountId: secondAccount, source: "manual_anchor", snapshotDay: "2026-04-01", providerAsOf: null });
  await adminDb().delete(users).where(eq(users.id, fixture.owner.id));
  expect(await adminDb().select().from(accountBalanceSnapshots)).toEqual(retained);
});

test.each(["plaid", "manual"] as const)("%s reconciliation preserves the exact database observation instant", async (source) => {
  const fixture = await captureFixture(source);
  await adminDb().execute(sql`update account_balances set as_of = '2026-04-01T12:00:00.000900Z'
    where account_id = ${fixture.accountId}`);
  await adminDb().execute(sql`insert into transactions (
    user_id, account_id, amount_minor, currency, date, description, status, source, created_at
  ) values (${fixture.owner.id}, ${fixture.accountId}, -100, 'USD', '2026-04-01',
    'At exact anchor', 'posted', 'manual', '2026-04-01T12:00:00.000900Z')`);
  const range = { from: "2026-04-01", to: "2026-04-01", accountIds: [fixture.accountId] };
  const history = await withAuth(fixture.owner.clerkUserId, () => accountBalanceHistory(range));
  expect((await adminDb().execute(sql`select snapshot.observed_at = balance.as_of as exact
    from account_balance_snapshots snapshot join account_balances balance using (account_id)
    where snapshot.account_id = ${fixture.accountId}`)).rows).toEqual([{ exact: true }]);
  expect(history[0].points[0].currentMinor).toBe(10000);
  const before = await fixture.stored();
  const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
  try {
    await withAuth(fixture.owner.clerkUserId, () => accountBalanceHistory(range));
    expect(info).not.toHaveBeenCalled();
    expect(await fixture.stored()).toEqual(before);
  } finally {
    info.mockRestore();
  }
});

test("older sub-millisecond capture remains a no-op rather than an equal-time conflict", async () => {
  const fixture = await captureFixture();
  await fixture.write();
  await adminDb().execute(sql`update account_balance_snapshots set observed_at = '2026-04-01T12:00:00.000900Z'
    where account_id = ${fixture.accountId}`);
  const before = await fixture.stored();
  await fixture.write({ ...fixture.capture, currentMinor: 9000 });
  expect(await fixture.stored()).toEqual(before);
});

test("manual create and sub-millisecond re-anchor retain the exact current projection cutoff", async () => {
  const owner = await provisionedUser();
  await adminDb().execute(sql`create function balance_history_exact_time() returns trigger language plpgsql as $$
    begin new.as_of := case when TG_OP = 'UPDATE' then '2026-04-01T12:00:00.000901Z'::timestamptz
      else '2026-04-01T12:00:00.000900Z'::timestamptz end; return new; end $$`);
  await adminDb().execute(sql`create trigger balance_history_exact_time before insert or update on account_balances
    for each row execute function balance_history_exact_time()`);
  try {
    const response = await withAuth(owner.clerkUserId, () => createManualAccount(request(
      "http://localhost/api/accounts/manual",
      JSON.stringify({ name: "Exact wallet", type: "other", currency: "USD", balance: "250.00", reportedOn: "2026-04-01" }),
    )));
    expect(response.status).toBe(201);
    const { accountId } = await response.json();
    const exact = () => adminDb().execute(sql`select snapshot.observed_at = balance.as_of as exact
      from account_balance_snapshots snapshot join account_balances balance using (account_id)
      where snapshot.account_id = ${accountId}`);
    expect((await exact()).rows).toEqual([{ exact: true }]);
    const updated = await withAuth(owner.clerkUserId, () => updateManualBalance(request(
      `http://localhost/api/accounts/${accountId}/manual`,
      JSON.stringify({ balance: "275.00", reportedOn: "2026-04-01" }),
    ), { params: Promise.resolve({ accountId }) }));
    expect(updated.status).toBe(200);
    expect((await exact()).rows).toEqual([{ exact: true }]);
    expect(await adminDb().select({ currentMinor: accountBalanceSnapshots.currentMinor }).from(accountBalanceSnapshots))
      .toEqual([{ currentMinor: 27500 }]);
  } finally {
    await adminDb().execute(sql`drop trigger balance_history_exact_time on account_balances`);
    await adminDb().execute(sql`drop function balance_history_exact_time()`);
  }
});

test("failed authoritative capture rolls back manual creation and re-anchor", async () => {
  const owner = await provisionedUser();
  const accountId = await anchoredAccount({ userId: owner.id, name: "Existing anchor", type: "other", currentMinor: 10000 });
  const before = await adminDb().select().from(accountBalances);
  await adminDb().execute(sql`create function balance_history_reject_capture() returns trigger language plpgsql as $$
    begin raise exception 'injected snapshot failure' using errcode = '23514'; end $$`);
  await adminDb().execute(sql`create trigger balance_history_reject_capture before insert or update on account_balance_snapshots
    for each row execute function balance_history_reject_capture()`);
  try {
    await expect(withAuth(owner.clerkUserId, () => createManualAccount(request(
      "http://localhost/api/accounts/manual", JSON.stringify({ name: "Rejected account", type: "other", currency: "USD", balance: "250.00", reportedOn: "2026-04-01" }),
    )))).rejects.toMatchObject({ cause: { code: "23514", message: "injected snapshot failure" } });
    expect(await adminDb().select({ id: accounts.id }).from(accounts)).toEqual([{ id: accountId }]);
    await expect(withAuth(owner.clerkUserId, () => updateManualBalance(request(
      `http://localhost/api/accounts/${accountId}/manual`, JSON.stringify({ balance: "275.00", reportedOn: "2026-04-02" }),
    ), { params: Promise.resolve({ accountId }) }))).rejects.toMatchObject({ cause: { code: "23514", message: "injected snapshot failure" } });
    expect(await adminDb().select().from(accountBalances)).toEqual(before);
    expect(await adminDb().select().from(accountBalanceSnapshots)).toEqual([]);
  } finally {
    await adminDb().execute(sql`drop trigger balance_history_reject_capture on account_balance_snapshots`);
    await adminDb().execute(sql`drop function balance_history_reject_capture()`);
  }
});

test.each([
  ["depository", 1], ["investment", 1], ["other", 1], ["credit", -1], ["loan", -1],
] as const)("%s history follows transaction edits, deletes, and backdated imports without rewriting anchors", async (type, sign) => {
  const owner = await provisionedUser();
  const accountId = await anchoredAccount({ userId: owner.id, name: "Mutable ledger", type, currentMinor: 20000, reportedOn: "2026-04-03" });
  await adminDb().update(accountBalances).set({ asOf: new Date("2026-04-03T12:00:00Z") })
    .where(eq(accountBalances.accountId, accountId));
  await withRequestScope(owner.clerkUserId, async (tx) => {
    for (const [snapshotDay, currentMinor] of [["2026-04-01", 10000], ["2026-04-03", 20000]] as const) {
      await captureBalanceSnapshot(tx, {
        accountId, userId: owner.id, source: "manual_anchor", currency: "USD", snapshotDay,
        currentMinor, captureReason: "event", observedAt: new Date(`${snapshotDay}T12:00:00Z`), providerAsOf: null,
      });
    }
  });
  const stored = await adminDb().select().from(accountBalanceSnapshots);
  const values = async () => {
    const history = await withAuth(owner.clerkUserId, () => accountBalanceHistory({
      from: "2026-04-01", to: "2026-04-04", accountIds: [accountId],
    }));
    expect(await adminDb().select().from(accountBalanceSnapshots)).toEqual(stored);
    expect(history[0].points.map((point) => point.basis)).toEqual(["derived", "derived", "derived", "derived"]);
    return history[0].points.map((point) => point.currentMinor);
  };
  const input = { accountId, amount: "5.00", direction: "outflow", date: "2026-04-02", description: "Editable row", merchant: null, categoryId: null };
  const created = await withAuth(owner.clerkUserId, () => createTransaction(request(
    "http://localhost/api/transactions/manual", JSON.stringify(input),
  )));
  expect(created.status).toBe(201);
  const { transactionId } = await created.json();
  expect(await values()).toEqual([10000, 10000 - sign * 500, 20000, 20000]);
  const updated = await withAuth(owner.clerkUserId, () => updateTransaction(request(
    `http://localhost/api/transactions/${transactionId}/manual`, JSON.stringify({ ...input, amount: "7.00", date: "2026-04-01" }),
  ), { params: Promise.resolve({ transactionId }) }));
  expect(updated.status).toBe(200);
  expect(await values()).toEqual([10000 - sign * 700, 10000 - sign * 700, 20000, 20000]);
  const imported = await withAuth(owner.clerkUserId, () => importStatement(request(
    `http://localhost/api/accounts/${accountId}/manual/import`, JSON.stringify({ rows: [
      { date: "2026-04-02", amount: "-3.00", description: "Backdated import" },
      { date: "2026-04-04", amount: "2.00", description: "After re-anchor" },
    ] }),
  ), { params: Promise.resolve({ accountId }) }));
  expect(imported.status).toBe(200);
  expect(await imported.json()).toEqual({ accountId, inserted: 2, skipped: 0 });
  expect(await values()).toEqual([10000 - sign * 700, 10000 - sign * 1000, 20000, 20000 + sign * 200]);
  const deleted = await withAuth(owner.clerkUserId, () => deleteTransaction(request(
    `http://localhost/api/transactions/${transactionId}/manual/delete`, "{}",
  ), { params: Promise.resolve({ transactionId }) }));
  expect(deleted.status).toBe(200);
  expect(await values()).toEqual([10000, 10000 - sign * 300, 20000, 20000 + sign * 200]);
  const prior = await withAuth(owner.clerkUserId, () => manualBalanceHistory({ from: "2026-04-02", to: "2026-04-02", accountIds: [accountId] }));
  expect(prior[0].points[0]).toMatchObject({ currentMinor: 10000 - sign * 300, anchorDay: "2026-04-01", anchorMinor: 10000 });
});

const unknownAccountId = "00000000-0000-4000-8000-000000000001";

const parsedRange = (input: unknown) => {
  const parsed = parseBalanceHistoryRange(input);
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) throw new Error("expected valid balance history range");
  return parsed.range;
};

test("signed-in history reconciles a provider projection at its original observation instant", async () => {
  const owner = await provisionedUser();
  const accountId = await anchoredAccount({
    userId: owner.id,
    name: "Checking",
    type: "depository",
    source: "plaid",
    currentMinor: 12345,
    reportedOn: null,
  });
  const observedAt = new Date("2026-04-02T23:30:00Z");
  await adminDb()
    .update(accountBalances)
    .set({ asOf: observedAt })
    .where(eq(accountBalances.accountId, accountId));

  const history = await withAuth(owner.clerkUserId, () =>
    accountBalanceHistory({
      from: "2026-04-02",
      to: "2026-04-03",
      accountIds: [accountId],
    }),
  );

  expect(history).toEqual([
    {
      accountId,
      accountType: "depository",
      currency: "USD",
      points: [
        {
          day: "2026-04-02",
          basis: "observed",
          currentMinor: 12345,
          observedDay: "2026-04-02",
          observedAt,
          providerAsOf: null,
          captureReason: "reconciliation",
        },
        {
          day: "2026-04-03",
          basis: "carried",
          currentMinor: 12345,
          observedDay: "2026-04-02",
          observedAt,
          providerAsOf: null,
          captureReason: "reconciliation",
        },
      ],
    },
  ]);
  const snapshots = await adminDb()
    .select()
    .from(accountBalanceSnapshots)
    .where(eq(accountBalanceSnapshots.accountId, accountId));
  expect(snapshots).toHaveLength(1);
  expect(snapshots[0]).toMatchObject({
    snapshotDay: "2026-04-02",
    currentMinor: 12345,
    source: "provider",
    captureReason: "reconciliation",
    observedAt,
    providerAsOf: null,
  });
});

test("an existing original observation is not reconciled again", async () => {
  const owner = await provisionedUser();
  const accountId = await anchoredAccount({
    userId: owner.id,
    name: "Checking",
    type: "depository",
    source: "plaid",
    currentMinor: 12345,
    reportedOn: null,
  });
  const observedAt = new Date("2026-04-02T10:00:00Z");
  const providerAsOf = new Date("2026-04-02T09:45:00Z");
  await adminDb()
    .update(accountBalances)
    .set({ asOf: observedAt })
    .where(eq(accountBalances.accountId, accountId));
  await withRequestScope(owner.clerkUserId, (tx) =>
    captureBalanceSnapshot(tx, {
      accountId,
      userId: owner.id,
      currentMinor: 12345,
      currency: "USD",
      source: "provider",
      captureReason: "event",
      observedAt,
      providerAsOf,
    }),
  );

  const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
  try {
    const history = await withAuth(owner.clerkUserId, () =>
      accountBalanceHistory({ from: "2026-04-02", to: "2026-04-02", accountIds: [accountId] }),
    );

    expect(history[0].points).toEqual([
      {
        day: "2026-04-02",
        basis: "observed",
        currentMinor: 12345,
        observedDay: "2026-04-02",
        observedAt,
        providerAsOf,
        captureReason: "event",
      },
    ]);
    expect(info).not.toHaveBeenCalled();
  } finally {
    info.mockRestore();
  }
});

test("reconciliation is bounded to selected owned accounts", async () => {
  const owner = await provisionedUser();
  const neighbor = await provisionedUser();
  const selectedAccountId = await anchoredAccount({
    userId: owner.id,
    name: "Selected checking",
    type: "depository",
    source: "plaid",
    currentMinor: 12000,
    reportedOn: null,
  });
  await anchoredAccount({
    userId: owner.id,
    name: "Omitted checking",
    type: "depository",
    source: "plaid",
    currentMinor: 34000,
    reportedOn: null,
  });
  const neighborAccountId = await anchoredAccount({
    userId: neighbor.id,
    name: "Neighbor checking",
    type: "depository",
    source: "plaid",
    currentMinor: 56000,
    reportedOn: null,
  });

  const history = await withAuth(owner.clerkUserId, () =>
    accountBalanceHistory({
      from: "2026-04-01",
      to: "2026-04-01",
      accountIds: [selectedAccountId, neighborAccountId],
    }),
  );

  expect(history.map(({ accountId }) => accountId)).toEqual([selectedAccountId]);
  const snapshots = await adminDb()
    .select({
      accountId: accountBalanceSnapshots.accountId,
      captureReason: accountBalanceSnapshots.captureReason,
    })
    .from(accountBalanceSnapshots);
  expect(snapshots).toEqual([
    { accountId: selectedAccountId, captureReason: "reconciliation" },
  ]);
});

test("repeated reconciliation leaves the canonical snapshot unchanged", async () => {
  const owner = await provisionedUser();
  const accountId = await anchoredAccount({
    userId: owner.id,
    name: "Checking",
    type: "depository",
    source: "plaid",
    currentMinor: 12345,
    reportedOn: null,
  });
  const range = { from: "2026-04-01", to: "2026-04-01", accountIds: [accountId] };
  await withAuth(owner.clerkUserId, () => accountBalanceHistory(range));
  const pinnedUpdatedAt = new Date("2026-04-02T00:00:00Z");
  await adminDb()
    .update(accountBalanceSnapshots)
    .set({ updatedAt: pinnedUpdatedAt })
    .where(eq(accountBalanceSnapshots.accountId, accountId));

  await withAuth(owner.clerkUserId, () => accountBalanceHistory(range));

  const snapshots = await adminDb()
    .select()
    .from(accountBalanceSnapshots)
    .where(eq(accountBalanceSnapshots.accountId, accountId));
  expect(snapshots).toHaveLength(1);
  expect(snapshots[0]).toMatchObject({
    accountId,
    snapshotDay: "2026-04-01",
    currentMinor: 12345,
    captureReason: "reconciliation",
    updatedAt: pinnedUpdatedAt,
  });
});

test("null provider current and missing manual reported day stay unavailable", async () => {
  const owner = await provisionedUser();
  const providerAccountId = await anchoredAccount({
    userId: owner.id,
    name: "Checking",
    type: "depository",
    source: "plaid",
    currentMinor: 10000,
    reportedOn: null,
  });
  const manualAccountId = await anchoredAccount({
    userId: owner.id,
    name: "Card",
    type: "credit",
    source: "manual",
    currentMinor: 7000,
    reportedOn: null,
  });
  await adminDb()
    .update(accountBalances)
    .set({ currentMinor: null, availableMinor: 10000 })
    .where(eq(accountBalances.accountId, providerAccountId));

  const history = await withAuth(owner.clerkUserId, () =>
    accountBalanceHistory({
      from: "2026-04-01",
      to: "2026-04-01",
      accountIds: [providerAccountId, manualAccountId],
    }),
  );

  expect(history).toHaveLength(2);
  expect(history.map(({ points }) => points)).toEqual([
    [{ day: "2026-04-01", basis: "unavailable", currentMinor: null }],
    [{ day: "2026-04-01", basis: "unavailable", currentMinor: null }],
  ]);
  expect(await adminDb().select().from(accountBalanceSnapshots)).toEqual([]);
});

test("signed-in history reconciles a manual projection on its reported day", async () => {
  const owner = await provisionedUser();
  const accountId = await anchoredAccount({
    userId: owner.id,
    name: "Card",
    type: "credit",
    source: "manual",
    currentMinor: 7000,
    reportedOn: "2026-04-02",
  });
  const observedAt = new Date("2026-04-05T09:15:00Z");
  await adminDb()
    .update(accountBalances)
    .set({ asOf: observedAt })
    .where(eq(accountBalances.accountId, accountId));

  const history = await withAuth(owner.clerkUserId, () =>
    accountBalanceHistory({ from: "2026-04-02", to: "2026-04-02", accountIds: [accountId] }),
  );

  expect(history).toEqual([
    {
      accountId,
      accountType: "credit",
      currency: "USD",
      points: [
        {
          day: "2026-04-02",
          basis: "derived",
          currentMinor: 7000,
          anchorMinor: 7000,
          anchorDay: "2026-04-02",
          anchorObservedAt: observedAt,
          captureReason: "reconciliation",
        },
      ],
    },
  ]);
  const snapshots = await adminDb()
    .select()
    .from(accountBalanceSnapshots)
    .where(eq(accountBalanceSnapshots.accountId, accountId));
  expect(snapshots).toHaveLength(1);
  expect(snapshots[0]).toMatchObject({
    snapshotDay: "2026-04-02",
    currentMinor: 7000,
    source: "manual_anchor",
    captureReason: "reconciliation",
    observedAt,
    providerAsOf: null,
  });
});

test("history falls back to existing snapshots when reconciliation fails", async () => {
  const owner = await provisionedUser();
  const accountId = await anchoredAccount({
    userId: owner.id,
    name: "Checking",
    type: "depository",
    source: "plaid",
    currentMinor: 12345,
    reportedOn: null,
  });
  const priorObservedAt = new Date("2026-04-01T10:00:00Z");
  const missingObservedAt = new Date("2026-04-02T10:00:00Z");
  await withRequestScope(owner.clerkUserId, (tx) =>
    captureBalanceSnapshot(tx, {
      accountId,
      userId: owner.id,
      currentMinor: 10000,
      currency: "USD",
      source: "provider",
      captureReason: "event",
      observedAt: priorObservedAt,
      providerAsOf: null,
    }),
  );
  await adminDb()
    .update(accountBalances)
    .set({ asOf: missingObservedAt })
    .where(eq(accountBalances.accountId, accountId));
  await adminDb().execute(sql`
    alter table account_balance_snapshots
    add constraint balance_snapshot_test_reconciliation_failure
    check (capture_reason <> 'reconciliation')
  `);

  const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
  let history;
  try {
    history = await withAuth(owner.clerkUserId, () =>
      accountBalanceHistory({ from: "2026-04-01", to: "2026-04-02", accountIds: [accountId] }),
    );

    const logs = info.mock.calls.map(([line]) => line);
    expect(logs.map((line) => JSON.parse(String(line)))).toEqual([
      {
        event: "balance_snapshot.reconciliation_failed",
        error: expect.stringMatching(/Error$/),
      },
    ]);
    expect(logs.join("\n")).not.toMatch(
      /12345|10000|USD|balance_snapshot_test_reconciliation_failure/,
    );
  } finally {
    info.mockRestore();
    await adminDb().execute(sql`
      alter table account_balance_snapshots
      drop constraint if exists balance_snapshot_test_reconciliation_failure
    `);
  }

  expect(history).toEqual([
    {
      accountId,
      accountType: "depository",
      currency: "USD",
      points: [
        {
          day: "2026-04-01",
          basis: "observed",
          currentMinor: 10000,
          observedDay: "2026-04-01",
          observedAt: priorObservedAt,
          providerAsOf: null,
          captureReason: "event",
        },
        {
          day: "2026-04-02",
          basis: "carried",
          currentMinor: 10000,
          observedDay: "2026-04-01",
          observedAt: priorObservedAt,
          providerAsOf: null,
          captureReason: "event",
        },
      ],
    },
  ]);
  const snapshots = await adminDb()
    .select({ snapshotDay: accountBalanceSnapshots.snapshotDay })
    .from(accountBalanceSnapshots)
    .where(eq(accountBalanceSnapshots.accountId, accountId));
  expect(snapshots).toEqual([{ snapshotDay: "2026-04-01" }]);
});

test("balance history composes provider and manual account series without combining them", async () => {
  const owner = await provisionedUser();
  const neighbor = await provisionedUser();
  const providerAccountId = await anchoredAccount({
    userId: owner.id,
    name: "Euro checking",
    type: "depository",
    source: "plaid",
    currency: "EUR",
    currentMinor: 1000,
    reportedOn: null,
  });
  const manualAccountId = await anchoredAccount({
    userId: owner.id,
    name: "Card",
    type: "credit",
    source: "manual",
    currency: "USD",
    currentMinor: 7000,
    reportedOn: "2026-04-02",
  });
  const neighborAccountId = await anchoredAccount({
    userId: neighbor.id,
    name: "Neighbor checking",
    type: "depository",
    source: "plaid",
    currency: "USD",
    currentMinor: 99999,
    reportedOn: null,
  });
  const providerObservedAt = new Date("2026-04-02T10:00:00Z");
  const providerAsOf = new Date("2026-04-02T09:45:00Z");
  const anchorObservedAt = new Date("2026-04-02T12:00:00Z");

  await withRequestScope(owner.clerkUserId, async (tx) => {
    await captureBalanceSnapshot(tx, {
      accountId: providerAccountId,
      userId: owner.id,
      currentMinor: 1000,
      currency: "EUR",
      source: "provider",
      captureReason: "event",
      observedAt: providerObservedAt,
      providerAsOf,
    });
    await captureBalanceSnapshot(tx, {
      accountId: manualAccountId,
      userId: owner.id,
      currentMinor: 7000,
      currency: "USD",
      source: "manual_anchor",
      snapshotDay: "2026-04-02",
      captureReason: "bootstrap",
      observedAt: anchorObservedAt,
      providerAsOf: null,
    });
  });
  await adminDb()
    .update(accountBalances)
    .set({ asOf: providerObservedAt })
    .where(eq(accountBalances.accountId, providerAccountId));
  await adminDb()
    .update(accountBalances)
    .set({ asOf: anchorObservedAt })
    .where(eq(accountBalances.accountId, manualAccountId));
  await adminDb().insert(transactions).values({
    userId: owner.id,
    accountId: manualAccountId,
    amountMinor: -300,
    currency: "USD",
    date: "2026-04-03",
    description: "Card charge",
    status: "posted",
    source: "manual",
    createdAt: new Date("2026-04-03T08:00:00Z"),
  });

  const range = parsedRange({
    from: "2026-04-01",
    to: "2026-04-03",
    accountIds: [providerAccountId, manualAccountId, neighborAccountId, unknownAccountId],
  });
  const history = await withAuth(owner.clerkUserId, () => accountBalanceHistory(range));

  expect(history).toEqual([
    {
      accountId: providerAccountId,
      accountType: "depository",
      currency: "EUR",
      points: [
        { day: "2026-04-01", basis: "unavailable", currentMinor: null },
        {
          day: "2026-04-02",
          basis: "observed",
          currentMinor: 1000,
          observedDay: "2026-04-02",
          observedAt: providerObservedAt,
          providerAsOf,
          captureReason: "event",
        },
        {
          day: "2026-04-03",
          basis: "carried",
          currentMinor: 1000,
          observedDay: "2026-04-02",
          observedAt: providerObservedAt,
          providerAsOf,
          captureReason: "event",
        },
      ],
    },
    {
      accountId: manualAccountId,
      accountType: "credit",
      currency: "USD",
      points: [
        { day: "2026-04-01", basis: "unavailable", currentMinor: null },
        {
          day: "2026-04-02",
          basis: "derived",
          currentMinor: 7000,
          anchorMinor: 7000,
          anchorDay: "2026-04-02",
          anchorObservedAt,
          captureReason: "bootstrap",
        },
        {
          day: "2026-04-03",
          basis: "derived",
          currentMinor: 7300,
          anchorMinor: 7000,
          anchorDay: "2026-04-02",
          anchorObservedAt,
          captureReason: "bootstrap",
        },
      ],
    },
  ]);
});

test("unknown and cross-user account filters return byte-identical history", async () => {
  const owner = await provisionedUser();
  const neighbor = await provisionedUser();
  const neighborAccountId = await anchoredAccount({
    userId: neighbor.id,
    name: "Neighbor checking",
    type: "depository",
    source: "plaid",
    currentMinor: 99999,
    reportedOn: null,
  });
  const input = { from: "2026-04-01", to: "2026-04-02" };

  const unknown = await withAuth(owner.clerkUserId, () =>
    accountBalanceHistory(parsedRange({ ...input, accountIds: [unknownAccountId] })),
  );
  const crossUser = await withAuth(owner.clerkUserId, () =>
    accountBalanceHistory(parsedRange({ ...input, accountIds: [neighborAccountId] })),
  );

  expect(JSON.stringify(crossUser)).toBe(JSON.stringify(unknown));
  expect(unknown).toEqual([]);
});

test.each([
  ["non-object", null],
  ["missing end", { from: "2026-04-01" }],
  ["unknown field", { from: "2026-04-01", to: "2026-04-02", currency: "USD" }],
  ["invalid start", { from: "2026-02-30", to: "2026-04-02" }],
  ["reversed", { from: "2026-04-03", to: "2026-04-02" }],
  ["over 3,660 days", { from: "2026-01-01", to: "2036-01-09" }],
  ["non-array accounts", { from: "2026-04-01", to: "2026-04-02", accountIds: null }],
  [
    "malformed account",
    { from: "2026-04-01", to: "2026-04-02", accountIds: ["not-an-account"] },
  ],
])("balance history range rejects %s", (_case, input) => {
  expect(parseBalanceHistoryRange(input)).toEqual({ ok: false });
});

test("balance history range accepts exactly 3,660 inclusive days", () => {
  expect(
    parseBalanceHistoryRange({
      from: "2026-01-01",
      to: "2036-01-08",
      accountIds: [unknownAccountId],
    }),
  ).toEqual({
    ok: true,
    range: {
      from: "2026-01-01",
      to: "2036-01-08",
      accountIds: [unknownAccountId],
    },
  });
});
