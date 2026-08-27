import { eq } from "drizzle-orm";
import { beforeEach, expect, test } from "vitest";

import { listResumableSyncs } from "@/lib/data/plaid-sync";
import { accountBalances, connections, transactions } from "@/lib/db/schema";
import { fakeClerkUserId, withAuth } from "../harness/clerk";
import { adminDb } from "../harness/db";
import {
  balanceRequests,
  failNextBalanceGet,
  failNextSync,
  capSyncPageSize,
  onceAfterSyncPage,
  pushSyncUpdates,
  resetPlaidSubstitute,
  sandboxTransaction,
  syncRequests,
  usd,
  type SandboxAccount,
} from "../harness/plaid";
import {
  backfilled,
  CARD,
  CHECKING,
  connect,
  expectStored,
  ledgerRows,
  step,
} from "./plaid-helpers";

beforeEach(resetPlaidSubstitute);

const age = (connectionId: string, ms: number) =>
  adminDb()
    .update(connections)
    .set({ updatedAt: new Date(Date.now() - ms) })
    .where(eq(connections.id, connectionId));

const balanceOf = (accountId: string) =>
  adminDb().select().from(accountBalances).where(eq(accountBalances.accountId, accountId));

const MINUTES = 60 * 1000;
const HOURS = 60 * MINUTES;

test("new transactions keep flowing after the backfill is complete", async () => {
  const groceries = sandboxTransaction(CHECKING, 12, "OLD GROCERIES", "2026-08-01");
  const { accessToken, sync, connectionId } = await backfilled(fakeClerkUserId(), groceries);

  const dinner = sandboxTransaction(CARD, 84.2, "FRESH DINNER", "2026-08-24", { merchant_name: "Bistro" });
  const payroll = sandboxTransaction(CHECKING, -2500, "PAYROLL", "2026-08-25");
  pushSyncUpdates(accessToken, { added: [dinner, payroll] });

  const response = await sync();
  await expect(response.json()).resolves.toEqual(step("complete", 2));
  expect((await ledgerRows()).map((row) => [row.description, row.amountMinor])).toEqual([
    ["OLD GROCERIES", -1200],
    ["FRESH DINNER", -8420],
    ["PAYROLL", 250000],
  ]);
  await expectStored(connectionId, "complete", "sync-cursor-3");
});

test("modified transactions update the stored row in place; unseen ones are inserted", async () => {
  const coffee = sandboxTransaction(CHECKING, 4.5, "CARD AUTH", "2026-08-20", { pending: true });
  const { accessToken, sync, accountId } = await backfilled(fakeClerkUserId(), coffee);

  const settled = { ...coffee, amount: 5.25, name: "BEAN BARREL", merchant_name: "Bean Barrel", pending: false };
  const unseen = sandboxTransaction(CARD, 30, "NEVER SEEN BEFORE", "2026-08-21");
  pushSyncUpdates(accessToken, { modified: [settled, unseen] });

  const response = await sync();
  await expect(response.json()).resolves.toEqual(step("complete", 0, { modified: 2 }));
  await expect(ledgerRows()).resolves.toEqual([
    {
      accountId: accountId.get(CHECKING),
      amountMinor: -525,
      currency: "USD",
      date: "2026-08-20",
      description: "BEAN BARREL",
      merchant: "Bean Barrel",
      status: "posted",
      source: "plaid",
      sourceId: coffee.transaction_id,
    },
    {
      accountId: accountId.get(CARD),
      amountMinor: -3000,
      currency: "USD",
      date: "2026-08-21",
      description: "NEVER SEEN BEFORE",
      merchant: null,
      status: "posted",
      source: "plaid",
      sourceId: unseen.transaction_id,
    },
  ]);
});

test("removed transactions are deleted; a pending replaced by its posted version lands exactly once", async () => {
  const pending = sandboxTransaction(CHECKING, 18, "PENDING HOLD", "2026-08-22", { pending: true });
  const other = sandboxTransaction(CHECKING, 7, "UNTOUCHED", "2026-08-21");
  const { accessToken, sync } = await backfilled(fakeClerkUserId(), pending, other);

  const posted = sandboxTransaction(CHECKING, 18.4, "POSTED CHARGE", "2026-08-23", {
    pending_transaction_id: pending.transaction_id,
  });
  pushSyncUpdates(accessToken, {
    added: [posted],
    removed: [{ transaction_id: pending.transaction_id, account_id: CHECKING }],
  });

  const response = await sync();
  await expect(response.json()).resolves.toEqual(step("complete", 1, { removed: 1 }));
  expect((await ledgerRows()).map((row) => row.description)).toEqual(["UNTOUCHED", "POSTED CHARGE"]);

  pushSyncUpdates(accessToken, {
    removed: [{ transaction_id: "txn-we-never-had", account_id: CHECKING }],
  });
  const noop = await sync();
  await expect(noop.json()).resolves.toEqual(step("complete", 0));
  expect(await ledgerRows()).toHaveLength(2);
});

test("one malformed provider row is skipped and counted while the rest of the run commits and the cursor advances", async () => {
  const { accessToken, sync, connectionId } = await backfilled(fakeClerkUserId());

  pushSyncUpdates(accessToken, {
    added: [
      sandboxTransaction(CHECKING, 1, "GOOD BEFORE", "2026-08-20"),
      sandboxTransaction(CHECKING, 3, "BAD DATE", "2026-02-30"),
      sandboxTransaction(CHECKING, 2, "GOOD AFTER", "2026-08-21"),
    ],
  });

  const response = await sync();
  await expect(response.json()).resolves.toEqual(step("complete", 2, { skipped: 1 }));
  expect((await ledgerRows()).map((row) => row.description)).toEqual(["GOOD BEFORE", "GOOD AFTER"]);
  await expectStored(connectionId, "complete", "sync-cursor-3");

  const clean = await sync();
  await expect(clean.json()).resolves.toEqual(step("complete", 0));
});

test("rows for accounts the ledger never registered are counted, not silently dropped", async () => {
  const { accessToken, sync, connectionId } = await backfilled(fakeClerkUserId());

  pushSyncUpdates(accessToken, {
    added: [
      sandboxTransaction(CHECKING, 1, "KEPT", "2026-08-20"),
      sandboxTransaction("acct-added-after-link", 2, "HOMELESS", "2026-08-21"),
    ],
    removed: [{ transaction_id: "any", account_id: "acct-added-after-link" }],
  });

  const response = await sync();
  await expect(response.json()).resolves.toEqual(step("complete", 1, { skipped: 2 }));
  expect((await ledgerRows()).map((row) => row.description)).toEqual(["KEPT"]);
  await expectStored(connectionId, "complete", "sync-cursor-3");
});

test("a rate-limited run commits nothing, returns 429 with retry-after, and the next run succeeds", async () => {
  const { accessToken, sync, connectionId } = await backfilled(fakeClerkUserId());
  pushSyncUpdates(accessToken, { added: [sandboxTransaction(CHECKING, 9, "AFTER LIMIT", "2026-08-24")] });
  failNextSync("RATE_LIMIT_EXCEEDED", "TRANSACTIONS_SYNC_LIMIT");

  const limited = await sync();
  expect(limited.status).toBe(429);
  expect(limited.headers.get("retry-after")).toBe("60");
  await expect(limited.json()).resolves.toEqual({ error: "rate_limited" });
  await expect(adminDb().$count(transactions)).resolves.toBe(0);

  const retried = await sync();
  await expect(retried.json()).resolves.toEqual(step("complete", 1));
  await expectStored(connectionId, "complete", "sync-cursor-1");
});

test("an overlapping run cannot regress the cursor or duplicate rows: the loser commits nothing", async () => {
  const { accessToken, sync, connectionId } = await backfilled(fakeClerkUserId());
  pushSyncUpdates(accessToken, {
    added: [
      sandboxTransaction(CHECKING, 5, "RACED 1", "2026-08-24"),
      sandboxTransaction(CHECKING, 6, "RACED 2", "2026-08-25"),
    ],
  });
  capSyncPageSize(1);

  let winner: unknown;
  onceAfterSyncPage(async () => {
    winner = await (await sync()).json();
  });

  const loser = await sync();
  expect(winner).toEqual(step("complete", 2));
  await expect(loser.json()).resolves.toEqual(step("complete", 0, { drained: false }));
  expect((await ledgerRows()).map((row) => row.description)).toEqual(["RACED 1", "RACED 2"]);
  await expectStored(connectionId, "complete", "sync-cursor-2");
  expect(syncRequests).toHaveLength(5);
});

test("an item stuck reporting UNKNOWN stays honestly in progress and resumable instead of completing", async () => {
  const { clerkUserId, accessToken, sync, connectionId } = await connect();
  pushSyncUpdates(accessToken, {
    added: [sandboxTransaction(CHECKING, 2, "DRAINED ANYWAY", "2026-08-20")],
    updateStatus: "TRANSACTIONS_UPDATE_STATUS_UNKNOWN",
  });

  const unknown = await sync();
  await expect(unknown.json()).resolves.toEqual(step("in_progress", 1));
  await expectStored(connectionId, "in_progress", "sync-cursor-1");

  await age(connectionId, 3 * MINUTES);
  await expect(withAuth(clerkUserId, listResumableSyncs)).resolves.toEqual([connectionId]);

  pushSyncUpdates(accessToken, { updateStatus: "HISTORICAL_UPDATE_COMPLETE" });
  const recovered = await sync();
  await expect(recovered.json()).resolves.toEqual(step("complete", 0));
});

test("provider currency gaps fall back to the account's registered currency, not USD", async () => {
  const yenAccounts: SandboxAccount[] = [
    {
      account_id: CHECKING,
      name: "Checking",
      official_name: null,
      mask: null,
      type: "depository",
      subtype: "checking",
      balances: { available: 1000, current: 1000, limit: null, iso_currency_code: "JPY", unofficial_currency_code: null },
    },
  ];
  const { accessToken, sync, accountId } = await connect(fakeClerkUserId(), yenAccounts);
  pushSyncUpdates(accessToken, {
    added: [sandboxTransaction(CHECKING, 1234, "YEN NO CODES", "2026-08-20", { iso_currency_code: null })],
    updateStatus: "HISTORICAL_UPDATE_COMPLETE",
  });

  const response = await sync();
  await expect(response.json()).resolves.toEqual(step("complete", 1));
  await expect(ledgerRows()).resolves.toEqual([
    {
      accountId: accountId.get(CHECKING),
      amountMinor: -1234,
      currency: "JPY",
      date: "2026-08-20",
      description: "YEN NO CODES",
      merchant: null,
      status: "posted",
      source: "plaid",
      sourceId: expect.any(String),
    },
  ]);
});

test("balances refresh through the live-balance endpoint only when a run changes something, and a balance failure never fails the sync", async () => {
  const start = new Date();
  const first = sandboxTransaction(CHECKING, 3, "SEED", "2026-08-20");
  const { accessToken, sync, accountId } = await backfilled(fakeClerkUserId(), first);
  expect(balanceRequests).toHaveLength(1);
  expect(balanceRequests[0].min_last_updated_datetime).toMatch(/^\d{4}-\d{2}-\d{2}T/);

  const idle = await sync();
  await expect(idle.json()).resolves.toEqual(step("complete", 0));
  expect(balanceRequests).toHaveLength(1);

  pushSyncUpdates(accessToken, {
    added: [sandboxTransaction(CHECKING, 8, "SPENT", "2026-08-24")],
    balances: { [CHECKING]: { available: 892.5, current: 900.25 } },
  });
  const active = await sync();
  await expect(active.json()).resolves.toEqual(step("complete", 1));
  expect(balanceRequests).toHaveLength(2);
  const [balance] = await balanceOf(accountId.get(CHECKING)!);
  expect(balance).toMatchObject({ availableMinor: 89250, currentMinor: 90025 });
  expect(+balance.asOf).toBeGreaterThanOrEqual(+start);

  pushSyncUpdates(accessToken, {
    added: [sandboxTransaction(CHECKING, 1, "DURING OUTAGE", "2026-08-25")],
    balances: { [CHECKING]: { available: 555 } },
  });
  failNextBalanceGet("API_ERROR", "INTERNAL_SERVER_ERROR");
  const outage = await sync();
  await expect(outage.json()).resolves.toEqual(step("complete", 1));
  expect(balanceRequests).toHaveLength(3);
  const [unchanged] = await balanceOf(accountId.get(CHECKING)!);
  expect(unchanged).toMatchObject({ availableMinor: 89250, currentMinor: 90025 });
});

test("stalled and stale connections surface for resume; fresh, disconnected, and foreign ones never do", async () => {
  const clerkA = fakeClerkUserId();
  const parked = await connect(clerkA);
  await expect(withAuth(clerkA, listResumableSyncs)).resolves.toEqual([]);

  await age(parked.connectionId, 3 * MINUTES);
  await expect(withAuth(clerkA, listResumableSyncs)).resolves.toEqual([parked.connectionId]);

  const laterId = "acct-second-checking";
  const laterAccounts: SandboxAccount[] = [
    { account_id: laterId, name: "Checking", official_name: null, mask: null, type: "depository", subtype: "checking", balances: usd(50, 50) },
  ];
  const finished = await connect(clerkA, laterAccounts);
  pushSyncUpdates(finished.accessToken, {
    added: [sandboxTransaction(laterId, 2, "DONE", "2026-08-20")],
    updateStatus: "HISTORICAL_UPDATE_COMPLETE",
  });
  await expect((await finished.sync()).json()).resolves.toMatchObject({ backfillStatus: "complete" });
  await expect(withAuth(clerkA, listResumableSyncs)).resolves.toEqual([parked.connectionId]);

  await age(finished.connectionId, 7 * HOURS);
  const both = await withAuth(clerkA, listResumableSyncs);
  expect(both.toSorted()).toEqual([parked.connectionId, finished.connectionId].toSorted());

  await adminDb()
    .update(connections)
    .set({ status: "disconnected" })
    .where(eq(connections.id, finished.connectionId));
  await expect(withAuth(clerkA, listResumableSyncs)).resolves.toEqual([parked.connectionId]);

  const clerkB = fakeClerkUserId();
  await expect(withAuth(clerkB, listResumableSyncs)).resolves.toEqual([]);
});

test("user B's sync can never modify or delete user A's rows, even with colliding provider identifiers", async () => {
  const clerkA = fakeClerkUserId();
  const groceries = sandboxTransaction(CHECKING, 42, "A GROCERIES", "2026-08-20");
  await backfilled(clerkA, groceries);

  const clerkB = fakeClerkUserId();
  const b = await backfilled(clerkB);

  pushSyncUpdates(b.accessToken, {
    removed: [{ transaction_id: groceries.transaction_id, account_id: CHECKING }],
  });
  await expect((await b.sync()).json()).resolves.toEqual(step("complete", 0));

  pushSyncUpdates(b.accessToken, {
    modified: [{ ...groceries, amount: 999, name: "B OVERWRITE" }],
  });
  await expect((await b.sync()).json()).resolves.toEqual(step("complete", 0, { modified: 1 }));

  const rows = await ledgerRows();
  const aRow = rows.find((row) => row.description === "A GROCERIES");
  expect(aRow).toMatchObject({ amountMinor: -4200, sourceId: groceries.transaction_id });
  const bRow = rows.find((row) => row.description === "B OVERWRITE");
  expect(bRow?.accountId).toBe(b.accountId.get(CHECKING));
  expect(bRow?.accountId).not.toBe(aRow?.accountId);
  expect(rows).toHaveLength(2);
});
