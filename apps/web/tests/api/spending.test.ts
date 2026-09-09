import { asc, eq, sql } from "drizzle-orm";
import { expect, test } from "vitest";

import { EXPECTED, SEED_CATEGORIES, SEED_PERSONAS, SEED_TRANSACTIONS, SEED_USERS } from "@/db/seed/dataset";
import { seedDataset } from "@/db/seed/seed";
import { setTransactionCategory } from "@/lib/data/categories";
import { spendingByCategory } from "@/lib/data/ledger";
import { matchTransfers } from "@/lib/data/transfers";
import { withRequestScope } from "@/lib/db/client";
import { transactions } from "@/lib/db/schema";
import type { SpendingQuery } from "@/lib/ledger/history-query";
import { withAuth } from "../harness/clerk";
import { adminDb } from "../harness/db";

const parsed = (query: Partial<SpendingQuery> = {}) => ({
  ok: true as const,
  query: { from: null, to: null, currency: null, ...query },
});

const demoCategory = (name: string, kind: "group" | "leaf") =>
  SEED_CATEGORIES.find(
    (c) => c.persona === "demo" && c.name === name && (c.parentId === null) === (kind === "group"),
  )!.id;

const spendingAs = (
  persona: (typeof SEED_PERSONAS)[number],
  query: Partial<SpendingQuery> = {},
) => withAuth(SEED_USERS[persona].clerkUserId, () => spendingByCategory(parsed(query)));

const usd = (summary: Awaited<ReturnType<typeof spendingByCategory>>) =>
  summary.currencies.find((section) => section.currency === "USD")!;

test("totals per category are exact per persona once transfers are matched", async () => {
  await seedDataset(adminDb());

  for (const persona of SEED_PERSONAS) {
    await withAuth(SEED_USERS[persona].clerkUserId, () => matchTransfers());
    expect(await spendingAs(persona)).toEqual({
      currencies: EXPECTED[persona].spending,
      pendingCount: EXPECTED[persona].pendingCount,
      transferRows: EXPECTED[persona].transfers.pairedRows,
      options: { currencies: EXPECTED[persona].history.currencies },
    });
  }
});

test("a period narrows every number and disclosure count exactly", async () => {
  await seedDataset(adminDb());
  await withAuth(SEED_USERS.demo.clerkUserId, () => matchTransfers());

  const streaming = (netMinor: number) => ({
    id: demoCategory("Entertainment", "group"),
    name: "Entertainment",
    spentMinor: netMinor,
    receivedMinor: 0,
    netMinor,
    categories: [
      { id: demoCategory("Streaming & Music", "leaf"), name: "Streaming & Music", spentMinor: netMinor, receivedMinor: 0, netMinor },
    ],
  });
  const paycheck = (netMinor: number) => ({
    id: demoCategory("Income", "group"),
    name: "Income",
    spentMinor: 0,
    receivedMinor: netMinor,
    netMinor,
    categories: [
      { id: demoCategory("Paycheck", "leaf"), name: "Paycheck", spentMinor: 0, receivedMinor: netMinor, netMinor },
    ],
  });

  const march = await spendingAs("demo", { from: "2026-03-01", to: "2026-03-31" });
  expect(march.currencies).toEqual([
    EXPECTED.demo.spending[0],
    {
      currency: "USD",
      totals: { spentMinor: -15279, receivedMinor: 272112, netMinor: 256833 },
      groups: [EXPECTED.demo.spending[1].groups[0], streaming(-2300), paycheck(250000)],
      uncategorized: { spentMinor: -1800, receivedMinor: 22112, netMinor: 20312 },
    },
  ]);
  expect(march.pendingCount).toBe(1);
  expect(march.transferRows).toBe(4);

  const february = await spendingAs("demo", { from: "2026-02-01", to: "2026-02-28" });
  expect(february.currencies).toEqual([
    {
      currency: "USD",
      totals: { spentMinor: -21299, receivedMinor: 250000, netMinor: 228701 },
      groups: [streaming(-2300), paycheck(250000)],
      uncategorized: { spentMinor: -18999, receivedMinor: 0, netMinor: -18999 },
    },
  ]);
  expect(february.pendingCount).toBe(0);
  expect(february.transferRows).toBe(0);
});

test("a currency pin keeps one section, and the disclosures follow it", async () => {
  await seedDataset(adminDb());
  await withAuth(SEED_USERS.demo.clerkUserId, () => matchTransfers());

  const eur = await spendingAs("demo", { currency: "EUR" });
  expect(eur.currencies).toEqual([EXPECTED.demo.spending[0]]);
  expect(eur.pendingCount).toBe(0);
  expect(eur.transferRows).toBe(0);
  expect(eur.options.currencies).toEqual(["EUR", "USD"]);
});

test("exclusion is pair membership: unmatched legs sit in uncategorized, and net is invariant", async () => {
  await seedDataset(adminDb());

  const before = await spendingAs("demo");
  expect(before.transferRows).toBe(0);
  expect(usd(before).uncategorized).toEqual({
    spentMinor: -225799,
    receivedMinor: 227112,
    netMinor: 1313,
  });
  expect(usd(before).totals).toEqual({
    spentMinor: -243878,
    receivedMinor: 977112,
    netMinor: 733234,
  });
  expect(usd(before).groups).toEqual(EXPECTED.demo.spending[1].groups);

  await withAuth(SEED_USERS.demo.clerkUserId, () => matchTransfers());
  expect((await spendingAs("demo")).currencies).toEqual(EXPECTED.demo.spending);
});

test("rollup is leaf arithmetic: recategorizing moves leaves between groups, totals invariant", async () => {
  await seedDataset(adminDb());
  const clerkUserId = SEED_USERS.demo.clerkUserId;
  await withAuth(clerkUserId, () => matchTransfers());
  const noodleHouse = SEED_TRANSACTIONS.find((t) => t.description === "NOODLE HOUSE")!.id;

  await withAuth(clerkUserId, () =>
    setTransactionCategory(noodleHouse, demoCategory("Groceries", "leaf")),
  );
  const merged = await spendingAs("demo");
  expect(usd(merged).groups[0]).toEqual({
    id: demoCategory("Food & Drink", "group"),
    name: "Food & Drink",
    spentMinor: -11179,
    receivedMinor: 0,
    netMinor: -11179,
    categories: [
      { id: demoCategory("Groceries", "leaf"), name: "Groceries", spentMinor: -11179, receivedMinor: 0, netMinor: -11179 },
    ],
  });

  await withAuth(clerkUserId, () =>
    setTransactionCategory(noodleHouse, demoCategory("Hobbies", "leaf")),
  );
  const moved = await spendingAs("demo");
  expect(usd(moved).groups.map((group) => [group.name, group.netMinor])).toEqual([
    ["Entertainment", -11337],
    ["Food & Drink", -6742],
    ["Income", 750000],
  ]);
  expect(usd(moved).groups[0].categories).toEqual([
    { id: demoCategory("Streaming & Music", "leaf"), name: "Streaming & Music", spentMinor: -6900, receivedMinor: 0, netMinor: -6900 },
    { id: demoCategory("Hobbies", "leaf"), name: "Hobbies", spentMinor: -4437, receivedMinor: 0, netMinor: -4437 },
  ]);
  expect(usd(moved).totals).toEqual(EXPECTED.demo.spending[1].totals);
});

test("a pending row is disclosed, not counted, and joins its category when it posts", async () => {
  await seedDataset(adminDb());
  await withAuth(SEED_USERS.demo.clerkUserId, () => matchTransfers());
  const pendingId = SEED_TRANSACTIONS.find(
    (t) => t.persona === "demo" && t.status === "pending",
  )!.id;

  await adminDb().update(transactions).set({ status: "posted" }).where(eq(transactions.id, pendingId));

  const summary = await spendingAs("demo");
  expect(summary.pendingCount).toBe(0);
  expect(usd(summary).groups[0]).toEqual({
    id: demoCategory("Food & Drink", "group"),
    name: "Food & Drink",
    spentMinor: -12429,
    receivedMinor: 0,
    netMinor: -12429,
    categories: [
      { id: demoCategory("Groceries", "leaf"), name: "Groceries", spentMinor: -6742, receivedMinor: 0, netMinor: -6742 },
      { id: demoCategory("Restaurants & Bars", "leaf"), name: "Restaurants & Bars", spentMinor: -4437, receivedMinor: 0, netMinor: -4437 },
      { id: demoCategory("Coffee Shops", "leaf"), name: "Coffee Shops", spentMinor: -1250, receivedMinor: 0, netMinor: -1250 },
    ],
  });
  expect(usd(summary).totals).toEqual({
    spentMinor: -40128,
    receivedMinor: 772112,
    netMinor: 731984,
  });
});

test("rejected filters return the empty summary with live options, never partial numbers", async () => {
  await seedDataset(adminDb());
  const summary = await withAuth(SEED_USERS.demo.clerkUserId, () =>
    spendingByCategory({ ok: false }),
  );
  expect(summary).toEqual({
    currencies: [],
    pendingCount: 0,
    transferRows: 0,
    options: { currencies: ["EUR", "USD"] },
  });
});

test("cross-user isolation: the raw category aggregation under B's scope sees none of A's rows", async () => {
  await seedDataset(adminDb());

  const rows = await withRequestScope(SEED_USERS.neighbor.clerkUserId, (tx) =>
    tx
      .select({
        categoryId: transactions.categoryId,
        netMinor: sql`sum(${transactions.amountMinor})`.mapWith(Number),
      })
      .from(transactions)
      .where(eq(transactions.status, "posted"))
      .groupBy(transactions.categoryId)
      .orderBy(asc(sql`sum(${transactions.amountMinor})`)),
  );
  expect(rows).toEqual([
    {
      categoryId: SEED_CATEGORIES.find(
        (c) => c.persona === "neighbor" && c.name === "Electronics",
      )!.id,
      netMinor: -12345,
    },
    { categoryId: null, netMinor: 75000 },
  ]);
});

test("the summary requires a signed-in user", async () => {
  await expect(spendingByCategory(parsed())).rejects.toMatchObject({
    digest: expect.stringContaining("/sign-in"),
  });
});
