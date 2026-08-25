import { inspect } from "node:util";
import { asc, eq } from "drizzle-orm";
import { beforeEach, expect, test } from "vitest";

import { POST as exchange } from "@/app/api/plaid/exchange/route";
import { POST as sync } from "@/app/api/connections/[connectionId]/sync/route";
import { advanceBackfill } from "@/lib/data/plaid-sync";
import { ProviderError } from "@/lib/data/plaid";
import { withRequestScope } from "@/lib/db/client";
import { accountBalances, connections, transactions } from "@/lib/db/schema";
import { fakeClerkUserId, withAuth } from "../harness/clerk";
import { adminDb } from "../harness/db";
import {
  capSyncPageSize,
  failNextSync,
  mintSandboxItem,
  pushSyncUpdates,
  resetPlaidSubstitute,
  sandboxTransaction,
  syncRequests,
  SUBSTITUTE_SECRET,
  usd,
  type SandboxAccount,
  type SandboxTransaction,
} from "../harness/plaid";

beforeEach(resetPlaidSubstitute);

const CHECKING = "acct-checking";
const CARD = "acct-card";

const testAccounts = (): SandboxAccount[] => [
  { account_id: CHECKING, name: "Checking", official_name: null, mask: null, type: "depository", subtype: "checking", balances: usd(1000, 1000) },
  { account_id: CARD, name: "Card", official_name: null, mask: null, type: "credit", subtype: "credit card", balances: usd(null, 410, 2000) },
];

const postExchange = (publicToken: string) =>
  exchange(
    new Request("http://localhost/api/plaid/exchange", {
      method: "POST",
      headers: { "content-type": "application/json", host: "localhost" },
      body: JSON.stringify({ publicToken }),
    }),
  );

const postSync = (connectionId: string, headers: Record<string, string> = {}) =>
  sync(
    new Request(`http://localhost/api/connections/${connectionId}/sync`, {
      method: "POST",
      headers: { host: "localhost", ...headers },
    }),
    { params: Promise.resolve({ connectionId }) },
  );

async function connect(clerkUserId = fakeClerkUserId()) {
  const minted = mintSandboxItem({ accounts: testAccounts() });
  const response = await withAuth(clerkUserId, () => postExchange(minted.publicToken));
  expect(response.status).toBe(200);
  const body = await response.json();
  const accountId = new Map<string, string>(
    body.accounts.map((registered: { name: string; id: string }) => [
      registered.name === "Checking" ? CHECKING : CARD,
      registered.id,
    ]),
  );
  const connectionId = body.connection.id as string;
  const sync = (headers?: Record<string, string>) =>
    withAuth(clerkUserId, () => postSync(connectionId, headers));
  return { ...minted, clerkUserId, connectionId, accountId, body, sync };
}

const ledgerRows = () =>
  adminDb()
    .select({
      accountId: transactions.accountId,
      amountMinor: transactions.amountMinor,
      currency: transactions.currency,
      date: transactions.date,
      description: transactions.description,
      merchant: transactions.merchant,
      status: transactions.status,
      source: transactions.source,
      sourceId: transactions.sourceId,
    })
    .from(transactions)
    .orderBy(asc(transactions.date));

const expectStored = async (
  connectionId: string,
  backfillStatus: "in_progress" | "complete",
  syncCursor: string | null,
) => {
  const [row] = await adminDb()
    .select({ backfillStatus: connections.backfillStatus, syncCursor: connections.syncCursor })
    .from(connections)
    .where(eq(connections.id, connectionId));
  expect(row).toEqual({ backfillStatus, syncCursor });
};

const rewind = (connectionId: string) =>
  adminDb().update(connections).set({ backfillStatus: "in_progress", syncCursor: null }).where(eq(connections.id, connectionId));

const pushHistory = (accessToken: string, ...added: SandboxTransaction[]) =>
  pushSyncUpdates(accessToken, { added, updateStatus: "HISTORICAL_UPDATE_COMPLETE" });

test("backfill inverts Plaid signs into net-worth amounts, faithfully across waves, statuses, and currencies", async () => {
  const start = new Date();
  const { connectionId, accessToken, accountId, body, sync } = await connect();
  expect(body.connection.backfillStatus).toBe("in_progress");
  await expectStored(connectionId, "in_progress", null);

  const payroll = sandboxTransaction(CHECKING, -2500, "ACME CORP PAYROLL", "2026-08-20", { merchant_name: "Acme Corp" });
  const coffee = sandboxTransaction(CHECKING, 12.5, "BEAN BARREL COFFEE", "2026-08-22", { pending: true, merchant_name: "Bean Barrel" });
  const flight = sandboxTransaction(CARD, 500, "UNITED AIRLINES", "2026-08-19", { merchant_name: "United Airlines" });
  pushSyncUpdates(accessToken, { added: [payroll, coffee, flight], updateStatus: "INITIAL_UPDATE_COMPLETE" });

  const first = await sync();
  expect(first.status).toBe(200);
  await expect(first.json()).resolves.toEqual({ backfillStatus: "in_progress", added: 3 });

  const refund = sandboxTransaction(CARD, -18.99, "SKYLINE AIR REFUND", "2026-07-01", { merchant_name: "Skyline Air" });
  const groceries = sandboxTransaction(CHECKING, 67.42, "MAPLE MARKET #204", "2026-06-15", { merchant_name: "Maple Market" });
  const halfCent = sandboxTransaction(CHECKING, 0.615, "PENNY ROUNDER", "2026-06-14");
  const bahn = sandboxTransaction(CHECKING, 56.5, "BAHN TICKET", "2026-06-10", { iso_currency_code: "EUR" });
  const rail = sandboxTransaction(CHECKING, 1234, "TOKYO RAIL", "2026-06-05", { iso_currency_code: "JPY" });
  const points = sandboxTransaction(CHECKING, 10, "POINTS REDEEM", "2026-06-04", { iso_currency_code: null, unofficial_currency_code: "GBP" });
  pushSyncUpdates(accessToken, {
    added: [refund, groceries, halfCent, bahn, rail, points],
    updateStatus: "HISTORICAL_UPDATE_COMPLETE",
    balances: { [CHECKING]: { available: 1234.56, current: 1300.02 }, [CARD]: { current: 892.4 } },
  });

  const second = await sync();
  await expect(second.json()).resolves.toEqual({ backfillStatus: "complete", added: 6 });

  const row = (
    txn: SandboxTransaction,
    plaidAccount: string,
    amountMinor: number,
    currency: string,
    merchant: string | null = null,
    status: "pending" | "posted" = "posted",
  ) => ({
    accountId: accountId.get(plaidAccount), amountMinor, currency, date: txn.date,
    description: txn.name, merchant, status, source: "plaid", sourceId: txn.transaction_id,
  });
  await expect(ledgerRows()).resolves.toEqual([
    row(points, CHECKING, -1000, "GBP"),
    row(rail, CHECKING, -1234, "JPY"),
    row(bahn, CHECKING, -5650, "EUR"),
    row(halfCent, CHECKING, -62, "USD"),
    row(groceries, CHECKING, -6742, "USD", "Maple Market"),
    row(refund, CARD, 1899, "USD", "Skyline Air"),
    row(flight, CARD, -50000, "USD", "United Airlines"),
    row(payroll, CHECKING, 250000, "USD", "Acme Corp"),
    row(coffee, CHECKING, -1250, "USD", "Bean Barrel", "pending"),
  ]);

  await expectStored(connectionId, "complete", "sync-cursor-9");

  const balances = await adminDb().select().from(accountBalances);
  expect(balances).toHaveLength(2);
  const byAccount = new Map(balances.map((balance) => [balance.accountId, balance]));
  expect(byAccount.get(accountId.get(CHECKING)!)).toMatchObject({ availableMinor: 123456, currentMinor: 130002, limitMinor: null });
  expect(byAccount.get(accountId.get(CARD)!)).toMatchObject({ availableMinor: null, currentMinor: 89240, limitMinor: 200000 });
  for (const balance of balances) expect(+balance.asOf).toBeGreaterThanOrEqual(+start);
});

test("initial pagination walks every page at the bounded page size and commits once", async () => {
  const { accessToken, sync } = await connect();
  pushHistory(accessToken, ...[1, 2, 3, 4, 5].map((n) => sandboxTransaction(CHECKING, n, `PAGED ${n}`, `2026-05-0${n}`)));
  capSyncPageSize(2);

  const response = await sync();
  await expect(response.json()).resolves.toEqual({ backfillStatus: "complete", added: 5 });
  expect(syncRequests).toEqual([
    { cursor: undefined, count: 500 },
    { cursor: "sync-cursor-2", count: 500 },
    { cursor: "sync-cursor-4", count: 500 },
  ]);
  expect((await ledgerRows()).map((r) => [r.description, r.amountMinor])).toEqual([
    ["PAGED 1", -100],
    ["PAGED 2", -200],
    ["PAGED 3", -300],
    ["PAGED 4", -400],
    ["PAGED 5", -500],
  ]);
});

test("re-running the backfill never duplicates a transaction", async () => {
  const { connectionId, accessToken, sync } = await connect();
  pushHistory(
    accessToken,
    sandboxTransaction(CHECKING, 20, "ONCE ONLY", "2026-05-01"),
    sandboxTransaction(CARD, 30, "TWICE NEVER", "2026-05-02"),
  );

  await sync();
  const again = await sync();
  await expect(again.json()).resolves.toEqual({ backfillStatus: "complete", added: 0 });

  await rewind(connectionId);
  const rerun = await sync();
  await expect(rerun.json()).resolves.toEqual({ backfillStatus: "complete", added: 0 });
  await expect(adminDb().$count(transactions)).resolves.toBe(2);
});

test("a failure mid-pagination commits nothing and the next run resumes without loss or duplicates", async () => {
  const { connectionId, accessToken, sync } = await connect();
  pushHistory(accessToken, ...[1, 2, 3, 4, 5].map((n) => sandboxTransaction(CHECKING, n, `FRAGILE ${n}`, `2026-05-0${n}`)));
  capSyncPageSize(2);
  failNextSync("API_ERROR", "INTERNAL_SERVER_ERROR", 1);

  const failed = await sync();
  expect(failed.status).toBe(502);
  await expect(failed.json()).resolves.toEqual({ error: "provider_error", message: null });
  await expect(adminDb().$count(transactions)).resolves.toBe(0);
  await expectStored(connectionId, "in_progress", null);

  const retried = await sync();
  await expect(retried.json()).resolves.toEqual({ backfillStatus: "complete", added: 5 });
  await expect(adminDb().$count(transactions)).resolves.toBe(5);
});

test("a mutation during pagination restarts the whole sequence from its origin cursor", async () => {
  const { accessToken, sync } = await connect();
  pushHistory(accessToken, ...[1, 2, 3, 4].map((n) => sandboxTransaction(CHECKING, n, `SHIFTING ${n}`, `2026-05-0${n}`)));
  capSyncPageSize(2);
  failNextSync("TRANSACTIONS_ERROR", "TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION", 1);

  const response = await sync();
  await expect(response.json()).resolves.toEqual({ backfillStatus: "complete", added: 4 });
  expect(syncRequests.map((request) => request.cursor)).toEqual([undefined, "sync-cursor-2", undefined, "sync-cursor-2"]);
  await expect(adminDb().$count(transactions)).resolves.toBe(4);
});

test("user B can never advance or read user A's backfill", async () => {
  const clerkB = fakeClerkUserId();
  const { connectionId, accessToken, sync } = await connect();
  pushHistory(accessToken, sandboxTransaction(CHECKING, 5, "PRIVATE", "2026-05-01"));

  await withAuth(clerkB, () => postExchange(mintSandboxItem().publicToken));
  const plaidCalls = syncRequests.length;
  const denied = await withAuth(clerkB, () => postSync(connectionId));
  expect(denied.status).toBe(404);
  await expect(denied.json()).resolves.toEqual({ error: "not_found" });
  expect(syncRequests).toHaveLength(plaidCalls);
  await expectStored(connectionId, "in_progress", null);

  await sync();
  const visibleToB = await withRequestScope(clerkB, (tx) => tx.select().from(transactions));
  expect(visibleToB).toEqual([]);
  await expect(adminDb().$count(transactions)).resolves.toBe(1);
});

test("signed-out and cross-origin sync requests are rejected before any Plaid call", async () => {
  const { connectionId, sync } = await connect();
  expect((await postSync(connectionId)).status).toBe(401);
  expect((await sync({ origin: "https://evil.example" })).status).toBe(403);
  expect(syncRequests).toHaveLength(0);
});

test("malformed, unknown, and disconnected connections are refused without touching Plaid", async () => {
  const { clerkUserId, connectionId, sync } = await connect();
  for (const bogus of ["not-a-uuid", "1'; drop table users--", crypto.randomUUID()]) {
    const response = await withAuth(clerkUserId, () => postSync(bogus));
    expect(response.status).toBe(404);
  }
  await adminDb().update(connections).set({ status: "disconnected" }).where(eq(connections.id, connectionId));
  expect((await sync()).status).toBe(404);
  expect(syncRequests).toHaveLength(0);
});

test("connect before Plaid has any data: backfill stays in progress and stores no cursor", async () => {
  const { connectionId, accessToken, sync } = await connect();

  const notReady = await sync();
  await expect(notReady.json()).resolves.toEqual({ backfillStatus: "in_progress", added: 0 });
  await expectStored(connectionId, "in_progress", null);

  pushHistory(accessToken, sandboxTransaction(CHECKING, 3.5, "LATE ARRIVAL", "2026-05-01"));
  const ready = await sync();
  await expect(ready.json()).resolves.toEqual({ backfillStatus: "complete", added: 1 });
});

test("rows for unregistered accounts are skipped and invalid provider rows fail the run whole", async () => {
  const { clerkUserId, connectionId, accessToken, sync } = await connect();
  pushHistory(
    accessToken,
    sandboxTransaction(CHECKING, 1, "KEPT", "2026-05-01"),
    sandboxTransaction("acct-never-registered", 2, "HOMELESS", "2026-05-02"),
  );
  const response = await sync();
  await expect(response.json()).resolves.toEqual({ backfillStatus: "complete", added: 1 });
  expect((await ledgerRows()).map((r) => r.description)).toEqual(["KEPT"]);

  await rewind(connectionId);
  pushSyncUpdates(accessToken, { added: [sandboxTransaction(CHECKING, 3, "BAD DATE", "2026-02-30")] });
  const poisoned = await sync();
  expect(poisoned.status).toBe(502);
  await expect(adminDb().$count(transactions)).resolves.toBe(1);

  const thrown = await withAuth(clerkUserId, () =>
    advanceBackfill(connectionId).catch((error: unknown) => error),
  );
  expect(thrown).toBeInstanceOf(ProviderError);
  expect(inspect(thrown, { depth: null })).not.toContain(SUBSTITUTE_SECRET);
});
