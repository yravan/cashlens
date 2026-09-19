import { expect, test } from "vitest";

import { accountOverview, cashFlowSummary, spendingByCategory } from "@/lib/data/ledger";
import { transactions } from "@/lib/db/schema";
import { withAuth } from "../harness/clerk";
import { adminDb } from "../harness/db";
import { anchoredAccount, provisionedUser } from "./offline-helpers";

const MAX_SAFE = Number.MAX_SAFE_INTEGER;
const exact = (value: number | bigint) => BigInt(value);

const posted = (userId: string, accountId: string, amounts: number[], currency = "KWD") =>
  adminDb().insert(transactions).values(
    amounts.map((amountMinor, index) => ({
      userId,
      accountId,
      amountMinor,
      currency,
      date: "2026-04-02",
      description: `EXACT AGGREGATE ${index}`,
      status: "posted" as const,
      source: "manual" as const,
      sourceId: null,
    })),
  );

test("cash-flow and spending preserve signed odd sums beyond the safe boundary", async () => {
  const owner = await provisionedUser();
  const neighbor = await provisionedUser();
  const mine = await anchoredAccount({
    userId: owner.id,
    name: "Exact wallet",
    type: "other",
    currency: "KWD",
    currentMinor: 0,
  });
  const theirs = await anchoredAccount({
    userId: neighbor.id,
    name: "Neighbor wallet",
    type: "other",
    currency: "KWD",
    currentMinor: 0,
  });
  const dollars = await anchoredAccount({
    userId: owner.id,
    name: "Dollar wallet",
    type: "other",
    currency: "USD",
    currentMinor: 0,
  });
  await posted(owner.id, mine, [MAX_SAFE, 2, -MAX_SAFE, -2]);
  await posted(owner.id, dollars, [11], "USD");
  await posted(neighbor.id, theirs, [7]);

  const flow = await withAuth(owner.clerkUserId, () => cashFlowSummary());
  const month = flow.currencies.find(({ currency }) => currency === "KWD")!.months[0];
  expect.soft(exact(month.inflowMinor)).toBe(9007199254740993n);
  expect.soft(exact(month.outflowMinor)).toBe(-9007199254740993n);
  expect.soft(exact(month.netMinor)).toBe(0n);
  const dollarsMonth = flow.currencies.find(({ currency }) => currency === "USD")!.months[0];
  expect.soft(exact(dollarsMonth.netMinor)).toBe(11n);

  const spending = await withAuth(owner.clerkUserId, () =>
    spendingByCategory({ ok: true, query: { from: null, to: null, currency: "KWD" } }),
  );
  expect.soft(spending.currencies).toHaveLength(1);
  const section = spending.currencies[0];
  expect.soft(exact(section.totals.receivedMinor)).toBe(9007199254740993n);
  expect.soft(exact(section.totals.spentMinor)).toBe(-9007199254740993n);
  expect.soft(exact(section.totals.netMinor)).toBe(0n);
  expect.soft(section.groups).toEqual([]);
  expect.soft(exact(section.uncategorized!.receivedMinor)).toBe(9007199254740993n);

  const neighborFlow = await withAuth(neighbor.clerkUserId, () => cashFlowSummary());
  const neighborMonth = neighborFlow.currencies.find(({ currency }) => currency === "KWD")!.months[0];
  expect.soft(exact(neighborMonth.netMinor)).toBe(7n);
});

test("account overview preserves held and owed post-anchor arithmetic and cross-account totals", async () => {
  const owner = await provisionedUser();
  const held = await anchoredAccount({
    userId: owner.id,
    name: "Vault",
    type: "depository",
    currency: "KWD",
    currentMinor: MAX_SAFE,
  });
  await anchoredAccount({
    userId: owner.id,
    name: "Pocket",
    type: "depository",
    currency: "KWD",
    currentMinor: 1,
  });
  const owed = await anchoredAccount({
    userId: owner.id,
    name: "Card",
    type: "credit",
    currency: "KWD",
    currentMinor: MAX_SAFE,
  });
  await posted(owner.id, held, [2]);
  await posted(owner.id, owed, [-2]);

  const overview = await withAuth(owner.clerkUserId, () => accountOverview());
  const current = (id: string) => overview.accounts.find((account) => account.id === id)!.currentMinor!;
  expect.soft(exact(current(held))).toBe(9007199254740993n);
  expect.soft(exact(current(owed))).toBe(9007199254740993n);
  expect.soft(exact(overview.cashOnHand.KWD)).toBe(9007199254740994n);
  expect.soft(exact(overview.creditOwed.KWD)).toBe(9007199254740993n);
});
