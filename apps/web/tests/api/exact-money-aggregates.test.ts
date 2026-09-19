import { expect, test } from "vitest";

import { accountOverview, cashFlowSummary, spendingByCategory } from "@/lib/data/ledger";
import { categories, transactions } from "@/lib/db/schema";
import { withAuth } from "../harness/clerk";
import { adminDb } from "../harness/db";
import { anchoredAccount, provisionedUser } from "./offline-helpers";

const MAX_SAFE = Number.MAX_SAFE_INTEGER;
const exact = (value: number | bigint) => BigInt(value);

const posted = (
  userId: string,
  accountId: string,
  amounts: number[],
  currency = "KWD",
  categoryIds: (string | null)[] = [],
) =>
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
      categoryId: categoryIds[index] ?? null,
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
  const [group] = await adminDb().insert(categories).values({
    userId: owner.id,
    name: "Exact group",
    sortOrder: 0,
  }).returning({ id: categories.id });
  const leaves = await adminDb().insert(categories).values([
    { userId: owner.id, parentId: group.id, name: "Large net", sortOrder: 0 },
    { userId: owner.id, parentId: group.id, name: "Small net", sortOrder: 1 },
  ]).returning({ id: categories.id });
  await posted(owner.id, mine, [MAX_SAFE, 2, -MAX_SAFE, -2], "KWD", [
    leaves[0].id, leaves[1].id, leaves[1].id, leaves[0].id,
  ]);
  await posted(owner.id, dollars, [11], "USD");
  await posted(neighbor.id, theirs, [7]);

  const flow = await withAuth(owner.clerkUserId, () => cashFlowSummary());
  const month = flow.currencies.find(({ currency }) => currency === "KWD")!.months[0];
  expect.soft(exact(month.inflowMinor)).toBe(BigInt("9007199254740993"));
  expect.soft(exact(month.outflowMinor)).toBe(BigInt("-9007199254740993"));
  expect.soft(exact(month.netMinor)).toBe(BigInt("0"));
  const dollarsMonth = flow.currencies.find(({ currency }) => currency === "USD")!.months[0];
  expect.soft(exact(dollarsMonth.netMinor)).toBe(BigInt("11"));

  const spending = await withAuth(owner.clerkUserId, () =>
    spendingByCategory({ ok: true, query: { from: null, to: null, currency: "KWD" } }),
  );
  expect.soft(spending.currencies).toHaveLength(1);
  const section = spending.currencies[0];
  expect.soft(exact(section.totals.receivedMinor)).toBe(BigInt("9007199254740993"));
  expect.soft(exact(section.totals.spentMinor)).toBe(BigInt("-9007199254740993"));
  expect.soft(exact(section.totals.netMinor)).toBe(BigInt("0"));
  expect.soft(section.groups).toHaveLength(1);
  expect.soft(exact(section.groups[0].receivedMinor)).toBe(BigInt("9007199254740993"));
  expect.soft(exact(section.groups[0].spentMinor)).toBe(BigInt("-9007199254740993"));
  expect.soft(section.groups[0].categories.map(({ name }) => name)).toEqual([
    "Small net",
    "Large net",
  ]);
  expect.soft(section.uncategorized).toBeNull();

  const neighborFlow = await withAuth(neighbor.clerkUserId, () => cashFlowSummary());
  const neighborMonth = neighborFlow.currencies.find(({ currency }) => currency === "KWD")!.months[0];
  expect.soft(exact(neighborMonth.netMinor)).toBe(BigInt("7"));
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
  expect.soft(exact(current(held))).toBe(BigInt("9007199254740993"));
  expect.soft(exact(current(owed))).toBe(BigInt("9007199254740993"));
  expect.soft(exact(overview.cashOnHand.KWD)).toBe(BigInt("9007199254740994"));
  expect.soft(exact(overview.creditOwed.KWD)).toBe(BigInt("9007199254740993"));
});
