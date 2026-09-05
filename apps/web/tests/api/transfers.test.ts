import { and, eq, isNull } from "drizzle-orm";
import { beforeEach, expect, test } from "vitest";

import { POST as matchRoute } from "@/app/api/transfers/match/route";
import { POST as unlinkRoute } from "@/app/api/transfers/[pairId]/unlink/route";
import { EXPECTED, SEED_USERS } from "@/db/seed/dataset";
import { seedDataset } from "@/db/seed/seed";
import { autoCategorizeBatch, uncategorizedCount } from "@/lib/data/auto-categorize";
import { transactionHistory } from "@/lib/data/ledger";
import { matchTransfers, unlinkTransferPair } from "@/lib/data/transfers";
import { requireUser } from "@/lib/data/users";
import { parseHistoryQuery } from "@/lib/ledger/history-query";
import { withRequestScope } from "@/lib/db/client";
import { accounts, transactions, transferPairs } from "@/lib/db/schema";
import {
  classificationRequests,
  onceBeforeClassificationResponse,
  primeClassification,
  resetAnthropicSubstitute,
} from "../harness/anthropic";
import { fakeClerkUserId, withAuth } from "../harness/clerk";
import { adminDb } from "../harness/db";
import { backfilled, CARD, CHECKING } from "./plaid-helpers";
import { sandboxTransaction } from "../harness/plaid";

beforeEach(resetAnthropicSubstitute);

type Row = {
  account: number;
  amountMinor: number;
  date: string;
  status?: "pending" | "posted";
  currency?: string;
  description?: string;
};

async function provision(clerkUserId: string, accountCount: number, rows: Row[]) {
  const user = await withAuth(clerkUserId, () => requireUser());
  const created = await adminDb()
    .insert(accounts)
    .values(
      Array.from({ length: accountCount }, (_, i) => ({
        userId: user.id,
        name: `Probe Account ${i}`,
        type: "depository" as const,
        currency: "USD",
        source: "manual" as const,
      })),
    )
    .returning({ id: accounts.id });
  const accountIds = created.map((row) => row.id);
  const inserted = rows.length
    ? await adminDb()
        .insert(transactions)
        .values(
          rows.map((row, i) => ({
            userId: user.id,
            accountId: accountIds[row.account],
            amountMinor: row.amountMinor,
            currency: row.currency ?? "USD",
            date: row.date,
            description: row.description ?? `PROBE ROW ${i}`,
            status: row.status ?? ("posted" as const),
            source: "manual" as const,
          })),
        )
        .returning({ id: transactions.id })
    : [];
  return { user, accountIds, ids: inserted.map((row) => row.id) };
}

const pairsOf = (userId: string) =>
  adminDb()
    .select({
      id: transferPairs.id,
      outflowId: transferPairs.outflowTransactionId,
      inflowId: transferPairs.inflowTransactionId,
      dismissedAt: transferPairs.dismissedAt,
    })
    .from(transferPairs)
    .where(eq(transferPairs.userId, userId))
    .orderBy(transferPairs.outflowTransactionId);

const activePairsOf = async (userId: string) =>
  (await pairsOf(userId)).filter((pair) => pair.dismissedAt === null);

const transactionSnapshot = (id: string) =>
  adminDb().select().from(transactions).where(eq(transactions.id, id));

test("the seeded demo ledger pairs exactly its two known transfers, idempotently", async () => {
  const ids = await seedDataset(adminDb());
  const clerkUserId = SEED_USERS.demo.clerkUserId;

  const first = await withAuth(clerkUserId, () => matchTransfers());
  expect(first).toEqual({ paired: 2, dissolved: 0 });

  const stored = (await activePairsOf(ids.demo)).map(({ outflowId, inflowId }) => ({
    outflowId,
    inflowId,
  }));
  expect(stored).toEqual(
    [...EXPECTED.demo.transfers.pairs].sort((a, b) => a.outflowId.localeCompare(b.outflowId)),
  );

  const again = await withAuth(clerkUserId, () => matchTransfers());
  expect(again).toEqual({ paired: 0, dissolved: 0 });
  expect(await activePairsOf(ids.demo)).toHaveLength(2);
});

test("cross-user isolation: a neighbor's closer counterpart never pairs with the demo ledger", async () => {
  const ids = await seedDataset(adminDb());
  const clerkB = fakeClerkUserId();
  // Same magnitude as demo's card payment, dated closer (03-05 vs the card's 03-07).
  const b = await provision(clerkB, 1, [
    { account: 0, amountMinor: 85000, date: "2026-03-05", description: "B DECOY INFLOW" },
  ]);

  const step = await withAuth(SEED_USERS.demo.clerkUserId, () => matchTransfers());
  expect(step).toEqual({ paired: 2, dissolved: 0 });

  const demoPairs = await activePairsOf(ids.demo);
  const touched = demoPairs.flatMap((pair) => [pair.outflowId, pair.inflowId]);
  expect(touched).not.toContain(b.ids[0]);
  expect(
    (await activePairsOf(ids.demo)).map(({ outflowId, inflowId }) => ({ outflowId, inflowId })),
  ).toEqual(
    [...EXPECTED.demo.transfers.pairs].sort((a, b) => a.outflowId.localeCompare(b.outflowId)),
  );

  expect(await withAuth(clerkB, () => matchTransfers())).toEqual({ paired: 0, dissolved: 0 });
  expect(await pairsOf(b.user.id)).toEqual([]);
});

test("unlink dismisses losslessly: no re-pair of the combo, both rows byte-identical and free", async () => {
  const clerkUserId = fakeClerkUserId();
  const { user, accountIds, ids } = await provision(clerkUserId, 3, [
    { account: 0, amountMinor: -5000, date: "2026-03-10" },
    { account: 1, amountMinor: 5000, date: "2026-03-10" },
  ]);
  await withAuth(clerkUserId, () => matchTransfers());
  const [pair] = await activePairsOf(user.id);
  expect(pair).toMatchObject({ outflowId: ids[0], inflowId: ids[1] });

  const before = [await transactionSnapshot(ids[0]), await transactionSnapshot(ids[1])];
  expect(await withAuth(clerkUserId, () => unlinkTransferPair(pair.id))).toBe(true);
  expect(await activePairsOf(user.id)).toEqual([]);
  const [stored] = await pairsOf(user.id);
  expect(stored.dismissedAt).not.toBeNull();
  expect([await transactionSnapshot(ids[0]), await transactionSnapshot(ids[1])]).toEqual(before);

  expect(await withAuth(clerkUserId, () => matchTransfers())).toEqual({
    paired: 0,
    dissolved: 0,
  });

  const [fresh] = await adminDb()
    .insert(transactions)
    .values({
      userId: user.id,
      accountId: accountIds[2],
      amountMinor: 5000,
      currency: "USD",
      date: "2026-03-11",
      description: "REPLACEMENT INFLOW",
      status: "posted",
      source: "manual",
    })
    .returning({ id: transactions.id });
  expect(await withAuth(clerkUserId, () => matchTransfers())).toEqual({
    paired: 1,
    dissolved: 0,
  });
  const active = await activePairsOf(user.id);
  expect(active).toHaveLength(1);
  expect(active[0]).toMatchObject({ outflowId: ids[0], inflowId: fresh.id });
});

test("unlinking an unknown, malformed, or foreign pair id changes nothing", async () => {
  const clerkA = fakeClerkUserId();
  const clerkB = fakeClerkUserId();
  const a = await provision(clerkA, 2, [
    { account: 0, amountMinor: -700, date: "2026-03-01" },
    { account: 1, amountMinor: 700, date: "2026-03-01" },
  ]);
  await withAuth(clerkA, () => matchTransfers());
  const [pair] = await activePairsOf(a.user.id);
  await provision(clerkB, 1, []);

  expect(await withAuth(clerkB, () => unlinkTransferPair(pair.id))).toBe(false);
  expect(await withAuth(clerkA, () => unlinkTransferPair("not-a-uuid"))).toBe(false);
  expect(
    await withAuth(clerkA, () => unlinkTransferPair("00000000-0000-4000-8000-00000000dead")),
  ).toBe(false);
  expect(await activePairsOf(a.user.id)).toHaveLength(1);
});

test("deleting one half unpairs by cascade and frees the survivor — the 2.1.4 removed path", async () => {
  const clerkUserId = fakeClerkUserId();
  const { user, accountIds, ids } = await provision(clerkUserId, 2, [
    { account: 0, amountMinor: -3200, date: "2026-03-04" },
    { account: 1, amountMinor: 3200, date: "2026-03-04" },
  ]);
  await withAuth(clerkUserId, () => matchTransfers());
  expect(await activePairsOf(user.id)).toHaveLength(1);

  await adminDb().delete(transactions).where(eq(transactions.id, ids[1]));
  expect(await pairsOf(user.id)).toEqual([]);

  const [replacement] = await adminDb()
    .insert(transactions)
    .values({
      userId: user.id,
      accountId: accountIds[1],
      amountMinor: 3200,
      currency: "USD",
      date: "2026-03-05",
      description: "REIMPORTED INFLOW",
      status: "posted",
      source: "manual",
    })
    .returning({ id: transactions.id });
  expect(await withAuth(clerkUserId, () => matchTransfers())).toEqual({
    paired: 1,
    dissolved: 0,
  });
  expect((await activePairsOf(user.id))[0]).toMatchObject({
    outflowId: ids[0],
    inflowId: replacement.id,
  });
});

test("a re-synced half that breaks the invariant dissolves the pair on the next run", async () => {
  const clerkUserId = fakeClerkUserId();
  const { user, ids } = await provision(clerkUserId, 2, [
    { account: 0, amountMinor: -4400, date: "2026-03-08" },
    { account: 1, amountMinor: 4400, date: "2026-03-08" },
  ]);
  await withAuth(clerkUserId, () => matchTransfers());
  expect(await activePairsOf(user.id)).toHaveLength(1);

  await adminDb()
    .update(transactions)
    .set({ amountMinor: 4401 })
    .where(eq(transactions.id, ids[1]));
  expect(await withAuth(clerkUserId, () => matchTransfers())).toEqual({
    paired: 0,
    dissolved: 1,
  });
  expect(await pairsOf(user.id)).toEqual([]);
});

test("a dissolved-and-still-valid combination may re-pair after the data heals", async () => {
  const clerkUserId = fakeClerkUserId();
  const { user, ids } = await provision(clerkUserId, 2, [
    { account: 0, amountMinor: -900, date: "2026-03-02" },
    { account: 1, amountMinor: 900, date: "2026-03-02" },
  ]);
  await withAuth(clerkUserId, () => matchTransfers());
  await adminDb().update(transactions).set({ amountMinor: 901 }).where(eq(transactions.id, ids[1]));
  await withAuth(clerkUserId, () => matchTransfers());
  expect(await pairsOf(user.id)).toEqual([]);

  await adminDb().update(transactions).set({ amountMinor: 900 }).where(eq(transactions.id, ids[1]));
  expect(await withAuth(clerkUserId, () => matchTransfers())).toEqual({
    paired: 1,
    dissolved: 0,
  });
});

test("a pending half stays unmatched until it posts", async () => {
  const clerkUserId = fakeClerkUserId();
  const { user, ids } = await provision(clerkUserId, 2, [
    { account: 0, amountMinor: -1500, date: "2026-03-06" },
    { account: 1, amountMinor: 1500, date: "2026-03-06", status: "pending" },
  ]);
  expect(await withAuth(clerkUserId, () => matchTransfers())).toEqual({
    paired: 0,
    dissolved: 0,
  });

  await adminDb()
    .update(transactions)
    .set({ status: "posted" })
    .where(eq(transactions.id, ids[1]));
  expect(await withAuth(clerkUserId, () => matchTransfers())).toEqual({
    paired: 1,
    dissolved: 0,
  });
  expect(await activePairsOf(user.id)).toHaveLength(1);
});

test("a committed sync run pairs freshly ingested halves inline", async () => {
  const clerkUserId = fakeClerkUserId();
  const item = await backfilled(
    clerkUserId,
    sandboxTransaction(CHECKING, 850, "CARD PAYMENT SENT", "2026-03-05"),
    sandboxTransaction(CARD, -850, "PAYMENT RECEIVED - THANK YOU", "2026-03-07"),
    sandboxTransaction(CHECKING, 64.2, "GROCERY RUN", "2026-03-06"),
  );
  const user = await withAuth(clerkUserId, () => requireUser());

  const pairs = await activePairsOf(user.id);
  expect(pairs).toHaveLength(1);
  const [row] = await adminDb()
    .select({ amountMinor: transactions.amountMinor, accountId: transactions.accountId })
    .from(transactions)
    .where(eq(transactions.id, pairs[0].outflowId));
  expect(row.amountMinor).toBe(-85000);
  expect(row.accountId).toBe(item.accountId.get(CHECKING));
});

test("matched transfers leave the auto-categorize queue and return on unlink", async () => {
  await seedDataset(adminDb());
  const clerkUserId = SEED_USERS.demo.clerkUserId;
  const user = await withAuth(clerkUserId, () => requireUser());

  expect(await withAuth(clerkUserId, () => uncategorizedCount())).toBe(
    EXPECTED.demo.uncategorized,
  );
  await withAuth(clerkUserId, () => matchTransfers());
  expect(await withAuth(clerkUserId, () => uncategorizedCount())).toBe(
    EXPECTED.demo.transfers.autoQueue,
  );

  primeClassification(
    Array.from({ length: EXPECTED.demo.transfers.autoQueue }, (_, i) => ({
      item: i,
      category: 0,
      confidence: "low",
      reason: "queue probe",
    })),
  );
  const step = await withAuth(clerkUserId, () => autoCategorizeBatch());
  expect(step).toEqual({
    attempted: EXPECTED.demo.transfers.autoQueue,
    categorized: EXPECTED.demo.transfers.autoQueue,
    remaining: 0,
  });
  const sent = JSON.stringify(classificationRequests);
  expect(sent).not.toContain("TRANSFER TO RAINY DAY SAVINGS");
  expect(sent).not.toContain("PAYMENT RECEIVED - THANK YOU");

  const [pair] = await activePairsOf(user.id);
  await withAuth(clerkUserId, () => unlinkTransferPair(pair.id));
  expect(await withAuth(clerkUserId, () => uncategorizedCount())).toBe(2);
});

test("rows paired while a classification is in flight are skipped by the write", async () => {
  const clerkUserId = fakeClerkUserId();
  const { user, ids } = await provision(clerkUserId, 2, [
    { account: 0, amountMinor: -5000, date: "2026-03-10", description: "MOVE OUT HALF" },
    { account: 1, amountMinor: 5000, date: "2026-03-10", description: "MOVE IN HALF" },
    { account: 0, amountMinor: -999, date: "2026-03-11", description: "PLAIN SPEND" },
  ]);
  primeClassification([
    { item: 0, category: 0, confidence: "high", reason: "race probe" },
    { item: 1, category: 0, confidence: "high", reason: "race probe" },
    { item: 2, category: 0, confidence: "high", reason: "race probe" },
  ]);
  onceBeforeClassificationResponse(async () => {
    await withAuth(clerkUserId, () => matchTransfers());
  });

  const step = await withAuth(clerkUserId, () => autoCategorizeBatch());
  expect(step).toEqual({ attempted: 3, categorized: 1, remaining: 0 });
  const rows = await adminDb()
    .select({ id: transactions.id, categoryId: transactions.categoryId })
    .from(transactions)
    .where(and(eq(transactions.userId, user.id), isNull(transactions.categoryId)));
  expect(rows.map((row) => row.id).sort()).toEqual([ids[0], ids[1]].sort());
});

test("history rows carry the pair id and counterpart account, without fan-out, until unlinked", async () => {
  const ids = await seedDataset(adminDb());
  const clerkUserId = SEED_USERS.demo.clerkUserId;
  await withAuth(clerkUserId, () => matchTransfers());

  const parsed = parseHistoryQuery({});
  if (!parsed.ok) throw new Error("empty query must parse");
  const view = await withAuth(clerkUserId, () => transactionHistory(parsed));
  expect(view.rows).toHaveLength(EXPECTED.demo.transactions);
  expect(view.total).toBe(EXPECTED.demo.transactions);

  const byDescription = new Map(view.rows.map((row) => [row.description, row]));
  expect(byDescription.get("TRANSFER TO RAINY DAY SAVINGS")).toMatchObject({
    transferPairId: expect.any(String),
    transferCounterpart: "Rainy Day Savings",
  });
  expect(byDescription.get("TRANSFER FROM EVERYDAY CHECKING")).toMatchObject({
    transferCounterpart: "Everyday Checking",
  });
  expect(byDescription.get("CASH REWARDS CARD PAYMENT")).toMatchObject({
    transferCounterpart: "Cash Rewards Card",
  });
  expect(byDescription.get("PAYMENT RECEIVED - THANK YOU")).toMatchObject({
    transferCounterpart: "Everyday Checking",
  });
  expect(byDescription.get("SKYLINE AIR REFUND")).toMatchObject({
    transferPairId: null,
    transferCounterpart: null,
  });

  const savingsPair = (await activePairsOf(ids.demo)).find(
    (pair) => pair.outflowId === EXPECTED.demo.transfers.pairs[0].outflowId,
  )!;
  await withAuth(clerkUserId, () => unlinkTransferPair(savingsPair.id));
  const after = await withAuth(clerkUserId, () => transactionHistory(parsed));
  const afterBy = new Map(after.rows.map((row) => [row.description, row]));
  expect(afterBy.get("TRANSFER TO RAINY DAY SAVINGS")).toMatchObject({ transferPairId: null });
  expect(afterBy.get("TRANSFER FROM EVERYDAY CHECKING")).toMatchObject({ transferPairId: null });
  expect(afterBy.get("CASH REWARDS CARD PAYMENT")).toMatchObject({
    transferCounterpart: "Cash Rewards Card",
  });
});

const postMatch = (headers: Record<string, string> = {}) =>
  matchRoute(
    new Request("http://localhost/api/transfers/match", {
      method: "POST",
      headers: { host: "localhost", ...headers },
    }),
  );

const postUnlink = (pairId: string, headers: Record<string, string> = {}) =>
  unlinkRoute(
    new Request(`http://localhost/api/transfers/${pairId}/unlink`, {
      method: "POST",
      headers: { host: "localhost", ...headers },
    }),
    { params: Promise.resolve({ pairId }) },
  );

test("the match route runs for the signed-in user and reports the step", async () => {
  await seedDataset(adminDb());
  const response = await withAuth(SEED_USERS.demo.clerkUserId, () => postMatch());
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ paired: 2, dissolved: 0 });
});

test("the unlink route dismisses an owned pair and 404s anything else", async () => {
  const ids = await seedDataset(adminDb());
  const clerkUserId = SEED_USERS.demo.clerkUserId;
  await withAuth(clerkUserId, () => postMatch());
  const [pair] = await activePairsOf(ids.demo);

  const foreign = await withAuth(SEED_USERS.neighbor.clerkUserId, () => postUnlink(pair.id));
  expect(foreign.status).toBe(404);

  const response = await withAuth(clerkUserId, () => postUnlink(pair.id));
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ ok: true });
  expect(await activePairsOf(ids.demo)).toHaveLength(1);

  expect((await withAuth(clerkUserId, () => postUnlink(pair.id))).status).toBe(404);
  expect((await withAuth(clerkUserId, () => postUnlink("junk"))).status).toBe(404);
});

test("both routes reject signed-out and cross-origin callers before any work", async () => {
  await seedDataset(adminDb());
  expect((await postMatch()).status).toBe(401);
  expect((await postUnlink("00000000-0000-4000-8000-00000000beef")).status).toBe(401);

  const crossMatch = await withAuth(SEED_USERS.demo.clerkUserId, () =>
    postMatch({ origin: "https://evil.example" }),
  );
  expect(crossMatch.status).toBe(403);
  const crossUnlink = await withAuth(SEED_USERS.demo.clerkUserId, () =>
    postUnlink("00000000-0000-4000-8000-00000000beef", { origin: "https://evil.example" }),
  );
  expect(crossUnlink.status).toBe(403);
});

test("RLS: another user can neither read, forge, dismiss, nor delete a pair row", async () => {
  const clerkA = fakeClerkUserId();
  const clerkB = fakeClerkUserId();
  const a = await provision(clerkA, 2, [
    { account: 0, amountMinor: -2600, date: "2026-03-03" },
    { account: 1, amountMinor: 2600, date: "2026-03-03" },
  ]);
  await withAuth(clerkA, () => matchTransfers());
  const [pair] = await activePairsOf(a.user.id);
  await provision(clerkB, 1, []);

  const visible = await withRequestScope(clerkB, (tx) =>
    tx.select({ id: transferPairs.id }).from(transferPairs),
  );
  expect(visible).toEqual([]);

  await expect(
    withRequestScope(clerkB, (tx) =>
      tx.insert(transferPairs).values({
        userId: a.user.id,
        outflowTransactionId: a.ids[0],
        inflowTransactionId: a.ids[1],
      }),
    ),
  ).rejects.toMatchObject({ cause: expect.objectContaining({ code: "42501" }) });

  const dismissed = await withRequestScope(clerkB, (tx) =>
    tx
      .update(transferPairs)
      .set({ dismissedAt: new Date() })
      .where(eq(transferPairs.id, pair.id)),
  );
  expect(dismissed.rowCount).toBe(0);

  const deleted = await withRequestScope(clerkB, (tx) =>
    tx.delete(transferPairs).where(eq(transferPairs.id, pair.id)),
  );
  expect(deleted.rowCount).toBe(0);

  expect((await activePairsOf(a.user.id))[0]).toMatchObject({ id: pair.id, dismissedAt: null });
});

test("the app role cannot rewrite a pair's identity columns even on its own rows", async () => {
  const clerkUserId = fakeClerkUserId();
  const { user, ids } = await provision(clerkUserId, 2, [
    { account: 0, amountMinor: -1100, date: "2026-03-09" },
    { account: 1, amountMinor: 1100, date: "2026-03-09" },
  ]);
  await withAuth(clerkUserId, () => matchTransfers());
  const [pair] = await activePairsOf(user.id);

  await expect(
    withRequestScope(clerkUserId, (tx) =>
      tx
        .update(transferPairs)
        .set({ outflowTransactionId: ids[1] })
        .where(eq(transferPairs.id, pair.id)),
    ),
  ).rejects.toMatchObject({ cause: expect.objectContaining({ code: "42501" }) });
  await expect(
    withRequestScope(clerkUserId, (tx) =>
      tx.update(transferPairs).set({ userId: user.id }).where(eq(transferPairs.id, pair.id)),
    ),
  ).rejects.toMatchObject({ cause: expect.objectContaining({ code: "42501" }) });
});

test("the database itself enforces one active pair per transaction and one row per combination", async () => {
  const clerkUserId = fakeClerkUserId();
  const { user, ids } = await provision(clerkUserId, 3, [
    { account: 0, amountMinor: -8000, date: "2026-03-12" },
    { account: 1, amountMinor: 8000, date: "2026-03-12" },
    { account: 2, amountMinor: 8000, date: "2026-03-13" },
  ]);
  await withAuth(clerkUserId, () => matchTransfers());
  const [pair] = await activePairsOf(user.id);
  expect(pair).toMatchObject({ outflowId: ids[0], inflowId: ids[1] });

  await expect(
    adminDb().insert(transferPairs).values({
      userId: user.id,
      outflowTransactionId: ids[0],
      inflowTransactionId: ids[2],
    }),
  ).rejects.toMatchObject({ cause: expect.objectContaining({ code: "23505" }) });

  await adminDb()
    .update(transferPairs)
    .set({ dismissedAt: new Date() })
    .where(eq(transferPairs.id, pair.id));
  await expect(
    adminDb().insert(transferPairs).values({
      userId: user.id,
      outflowTransactionId: ids[0],
      inflowTransactionId: ids[1],
    }),
  ).rejects.toMatchObject({ cause: expect.objectContaining({ code: "23505" }) });

  await expect(
    adminDb().insert(transferPairs).values({
      userId: user.id,
      outflowTransactionId: ids[0],
      inflowTransactionId: ids[0],
    }),
  ).rejects.toMatchObject({ cause: expect.objectContaining({ code: "23514" }) });
});
