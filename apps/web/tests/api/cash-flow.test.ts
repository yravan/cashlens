import { and, eq, sql } from "drizzle-orm";
import { expect, test } from "vitest";

import { EXPECTED, SEED_PERSONAS, SEED_TRANSACTIONS, SEED_USERS } from "@/db/seed/dataset";
import { seedDataset } from "@/db/seed/seed";
import { cashFlowSummary } from "@/lib/data/ledger";
import { matchTransfers, unlinkTransferPair } from "@/lib/data/transfers";
import { withRequestScope } from "@/lib/db/client";
import { transactions, transferPairs } from "@/lib/db/schema";
import { withAuth } from "../harness/clerk";
import { adminDb } from "../harness/db";

const expectedSummary = (persona: (typeof SEED_PERSONAS)[number]) => ({
  currencies: EXPECTED[persona].flow,
  pendingCount: EXPECTED[persona].pendingCount,
  transferRows: EXPECTED[persona].transfers.pairedRows,
});

const monthsOf = (
  summary: Awaited<ReturnType<typeof cashFlowSummary>>,
  currency: string,
) => summary.currencies.find((entry) => entry.currency === currency)?.months ?? [];

test("the summary is exact per persona once transfers are matched, unlike currencies never combined", async () => {
  await seedDataset(adminDb());

  for (const persona of SEED_PERSONAS) {
    await withAuth(SEED_USERS[persona].clerkUserId, () => matchTransfers());
    const summary = await withAuth(SEED_USERS[persona].clerkUserId, () => cashFlowSummary());
    expect(summary).toEqual(expectedSummary(persona));
  }
});

test("exclusion is pair membership, not description: unmatched transfer legs count until a pair exists", async () => {
  await seedDataset(adminDb());
  const clerkUserId = SEED_USERS.demo.clerkUserId;

  const before = await withAuth(clerkUserId, () => cashFlowSummary());
  expect(before.transferRows).toBe(0);
  expect(monthsOf(before, "USD")[0]).toEqual({
    month: "2026-03",
    inflowMinor: 477112,
    outflowMinor: -220279,
    netMinor: 256833,
  });

  await withAuth(clerkUserId, () => matchTransfers());
  const after = await withAuth(clerkUserId, () => cashFlowSummary());
  expect(after).toEqual(expectedSummary("demo"));
});

test("a dismissed pair's legs count again, and net is invariant to pairing either way", async () => {
  const ids = await seedDataset(adminDb());
  const clerkUserId = SEED_USERS.demo.clerkUserId;
  await withAuth(clerkUserId, () => matchTransfers());

  const [savingsPair] = await adminDb()
    .select({ id: transferPairs.id })
    .from(transferPairs)
    .where(
      and(
        eq(transferPairs.userId, ids.demo),
        eq(transferPairs.outflowTransactionId, EXPECTED.demo.transfers.pairs[0].outflowId),
      ),
    );
  expect(await withAuth(clerkUserId, () => unlinkTransferPair(savingsPair.id))).toBe(true);

  const summary = await withAuth(clerkUserId, () => cashFlowSummary());
  expect(summary.transferRows).toBe(2);
  expect(monthsOf(summary, "USD")[0]).toEqual({
    month: "2026-03",
    inflowMinor: 392112,
    outflowMinor: -135279,
    netMinor: 256833,
  });
  expect(monthsOf(summary, "EUR")).toEqual(EXPECTED.demo.flow[0].months);
});

test("a pending row is disclosed, not counted, and joins the flow only when it posts", async () => {
  await seedDataset(adminDb());
  const clerkUserId = SEED_USERS.demo.clerkUserId;
  await withAuth(clerkUserId, () => matchTransfers());

  const pendingId = SEED_TRANSACTIONS.find(
    (t) => t.persona === "demo" && t.status === "pending",
  )!.id;
  await adminDb()
    .update(transactions)
    .set({ status: "posted" })
    .where(eq(transactions.id, pendingId));

  const summary = await withAuth(clerkUserId, () => cashFlowSummary());
  expect(summary.pendingCount).toBe(0);
  expect(monthsOf(summary, "USD")[0]).toEqual({
    month: "2026-03",
    inflowMinor: 272112,
    outflowMinor: -16529,
    netMinor: 255583,
  });
});

test("cross-user isolation: the raw month aggregation under B's scope sees none of A's rows", async () => {
  await seedDataset(adminDb());

  const month = sql<string>`to_char(${transactions.date}, 'YYYY-MM')`;
  const rows = await withRequestScope(SEED_USERS.neighbor.clerkUserId, (tx) =>
    tx
      .select({
        currency: transactions.currency,
        month,
        netMinor: sql`sum(${transactions.amountMinor})`.mapWith(Number),
      })
      .from(transactions)
      .where(eq(transactions.status, "posted"))
      .groupBy(transactions.currency, month),
  );
  expect(rows).toEqual([{ currency: "USD", month: "2026-03", netMinor: 62655 }]);
});

test("the summary requires a signed-in user", async () => {
  await expect(cashFlowSummary()).rejects.toMatchObject({
    digest: expect.stringContaining("/sign-in"),
  });
});
