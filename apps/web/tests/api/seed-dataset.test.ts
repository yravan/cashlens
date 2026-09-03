import { and, count, eq, sql } from "drizzle-orm";
import { expect, test } from "vitest";

import { EXPECTED, SEED_ACCOUNTS, SEED_BALANCES, SEED_CATEGORIES, SEED_PERSONAS, SEED_TRANSACTIONS, SEED_USERS, type ExpectedPersona } from "@/db/seed/dataset";
import { assertLocalDatabaseUrl } from "@/db/seed/local-only";
import { seedDataset } from "@/db/seed/seed";
import { ledgerCounts } from "@/lib/data/ledger";
import { requireUser } from "@/lib/data/users";
import { accountBalances, accounts, categories, transactions, users } from "@/lib/db/schema";
import { DEFAULT_CATEGORIES } from "@/lib/ledger/default-categories";
import { fakeClerkUserId, withAuth } from "../harness/clerk";
import { adminDb } from "../harness/db";

test("the dataset's exported totals match the hand-verified anchors", () => {
  expect(EXPECTED.demo).toEqual({
    accounts: 5,
    transactions: 16,
    balances: 5,
    pendingCount: 1,
    categories: 80,
    assigned: {
      Paycheck: 2,
      Groceries: 1,
      "Restaurants & Bars": 1,
      "Coffee Shops": 1,
      "Streaming & Music": 1,
      "Public Transit": 1,
    },
    posted: {
      USD: { inflowMinor: 727112, outflowMinor: -239278, netMinor: 487834, count: 13 },
      EUR: { inflowMinor: 20000, outflowMinor: -5650, netMinor: 14350, count: 2 },
    },
    overview: {
      accounts: [
        { name: "Berlin Checking", type: "depository", subtype: "checking", mask: "0300", currency: "EUR", currentMinor: 120450 },
        { name: "Everyday Checking", type: "depository", subtype: "checking", mask: "0100", currency: "USD", currentMinor: 235370 },
        { name: "Rainy Day Savings", type: "depository", subtype: "savings", mask: "0200", currency: "USD", currentMinor: 1500000 },
        { name: "Cash Rewards Card", type: "credit", subtype: "credit card", mask: "4321", currency: "USD", currentMinor: 51245 },
        { name: "Cash Wallet", type: "other", subtype: null, mask: null, currency: "USD", currentMinor: 8600 },
      ],
      cashOnHand: { EUR: 120450, USD: 1735370 },
      creditOwed: { USD: 51245 },
    },
    history: { order: expect.any(Array), currencies: ["EUR", "USD"] },
  });
  expect(EXPECTED.neighbor).toEqual({
    accounts: 1,
    transactions: 2,
    balances: 1,
    pendingCount: 0,
    categories: 80,
    assigned: { Electronics: 1 },
    posted: { USD: { inflowMinor: 75000, outflowMinor: -12345, netMinor: 62655, count: 2 } },
    overview: {
      accounts: [
        { name: "Neighbor Checking", type: "depository", subtype: "checking", mask: "0900", currency: "USD", currentMinor: 50000 },
      ],
      cashOnHand: { USD: 50000 },
      creditOwed: {},
    },
    history: { order: expect.any(Array), currencies: ["USD"] },
  });
  expect(EXPECTED.empty).toEqual({
    accounts: 0,
    transactions: 0,
    balances: 0,
    pendingCount: 0,
    categories: 0,
    assigned: {},
    posted: {},
    overview: { accounts: [], cashOnHand: {}, creditOwed: {} },
    history: { order: [], currencies: [] },
  });
});

test("the history chronology matches the hand-verified order, ties resolved newest-id-first", () => {
  const label = new Map(SEED_TRANSACTIONS.map((t) => [t.id, `${t.date} ${t.description}`]));
  expect(EXPECTED.demo.history.order.map((id) => label.get(id))).toEqual([
    "2026-03-31 INTEREST PAYMENT",
    "2026-03-29 STREAMFLIX",
    "2026-03-27 ACME CORP PAYROLL",
    "2026-03-16 BEAN BARREL COFFEE",
    "2026-03-14 FARMERS MARKET CASH",
    "2026-03-12 SKYLINE AIR REFUND",
    "2026-03-11 AIRBNB PAYOUT",
    "2026-03-10 BAHN TICKET BERLIN",
    "2026-03-08 MAPLE MARKET #204",
    "2026-03-07 PAYMENT RECEIVED - THANK YOU",
    "2026-03-05 CASH REWARDS CARD PAYMENT",
    "2026-03-03 NOODLE HOUSE",
    "2026-03-02 TRANSFER FROM EVERYDAY CHECKING",
    "2026-03-02 TRANSFER TO RAINY DAY SAVINGS",
    "2026-02-27 ACME CORP PAYROLL",
    "2026-02-21 SKYLINE AIR TICKETS",
  ]);
  expect(EXPECTED.neighbor.history.order.map((id) => label.get(id))).toEqual([
    "2026-03-09 ELECTRONICS EMPORIUM",
    "2026-03-06 NEIGHBOR PAYCHECK",
  ]);
});

test("the dataset spans every ledger shape the schema supports today", () => {
  expect(new Set(SEED_TRANSACTIONS.map((t) => t.status))).toEqual(new Set(["pending", "posted"]));
  expect(new Set(SEED_TRANSACTIONS.map((t) => t.source))).toEqual(new Set(["plaid", "manual", "import"]));
  expect(new Set(SEED_TRANSACTIONS.map((t) => t.currency))).toEqual(new Set(["USD", "EUR"]));
  expect(SEED_TRANSACTIONS.some((t) => t.amountMinor > 0)).toBe(true);
  expect(SEED_TRANSACTIONS.some((t) => t.amountMinor < 0)).toBe(true);
  expect(SEED_TRANSACTIONS.some((t) => t.sourceId === null)).toBe(true);
  expect(SEED_TRANSACTIONS.some((t) => t.merchant === null)).toBe(true);

  expect(new Set(SEED_ACCOUNTS.map((a) => a.type))).toEqual(
    new Set(["depository", "credit", "other"]),
  );
  expect(SEED_ACCOUNTS.some((a) => a.sourceId === null)).toBe(true);
  expect(SEED_BALANCES.some((b) => b.limitMinor !== null)).toBe(true);
  expect(SEED_BALANCES.some((b) => b.availableMinor === null)).toBe(true);

  expect(SEED_ACCOUNTS.some((a) => a.persona === "neighbor")).toBe(true);
  expect(SEED_ACCOUNTS.some((a) => a.persona === "empty")).toBe(false);

  expect(SEED_TRANSACTIONS.some((t) => t.categoryId)).toBe(true);
  expect(SEED_TRANSACTIONS.some((t) => !t.categoryId)).toBe(true);
  expect(SEED_TRANSACTIONS.find((t) => t.status === "pending")?.categoryId).toBeTruthy();
  expect(
    new Set(SEED_TRANSACTIONS.filter((t) => t.categoryId).map((t) => t.source)).size,
  ).toBeGreaterThan(1);
  expect(SEED_TRANSACTIONS.filter((t) => t.categoryId && t.persona === "neighbor")).toHaveLength(1);

  const leafIds = new Set(SEED_CATEGORIES.filter((c) => c.parentId !== null).map((c) => c.id));
  for (const t of SEED_TRANSACTIONS) {
    if (t.categoryId) expect(leafIds.has(t.categoryId)).toBe(true);
  }
  for (const persona of ["demo", "neighbor"] as const) {
    const own = new Set(
      SEED_CATEGORIES.filter((c) => c.persona === persona).map((c) => c.id),
    );
    for (const t of SEED_TRANSACTIONS.filter((t) => t.persona === persona && t.categoryId)) {
      expect(own.has(t.categoryId!)).toBe(true);
    }
  }
  expect(SEED_CATEGORIES.some((c) => c.persona === "empty")).toBe(false);
});

test("the seeded taxonomy is exactly the default tree, per persona", () => {
  for (const persona of ["demo", "neighbor"] as const) {
    const mine = SEED_CATEGORIES.filter((c) => c.persona === persona);
    const roots = mine.filter((c) => c.parentId === null);
    expect(roots.map((c) => c.name)).toEqual(DEFAULT_CATEGORIES.map((d) => d.group));
    for (const root of roots) {
      expect(mine.filter((c) => c.parentId === root.id).map((c) => c.name)).toEqual(
        DEFAULT_CATEGORIES.find((d) => d.group === root.name)!.categories,
      );
    }
  }
});

test("the dataset's transfer-pair rows stay uncategorized (3.3.1 owns transfers)", () => {
  for (const sourceId of ["seed-txn-2", "seed-txn-3", "seed-txn-4", "seed-txn-5"]) {
    expect(SEED_TRANSACTIONS.find((t) => t.sourceId === sourceId)?.categoryId).toBeFalsy();
  }
});

test("the dataset's transfer pairs cancel exactly", () => {
  const bySourceId = new Map(SEED_TRANSACTIONS.map((t) => [t.sourceId, t.amountMinor]));
  for (const [out, back] of [
    ["seed-txn-2", "seed-txn-3"],
    ["seed-txn-4", "seed-txn-5"],
  ]) {
    expect(bySourceId.get(out)! + bySourceId.get(back)!).toBe(0);
  }
});

async function personaInDb(userId: string): Promise<Omit<ExpectedPersona, "overview" | "history">> {
  const db = adminDb();
  const mine = eq(transactions.userId, userId);
  const posted = await db
    .select({
      currency: transactions.currency,
      inflowMinor: sql<number>`coalesce(sum(${transactions.amountMinor}) filter (where ${transactions.amountMinor} >= 0), 0)::int`,
      outflowMinor: sql<number>`coalesce(sum(${transactions.amountMinor}) filter (where ${transactions.amountMinor} < 0), 0)::int`,
      netMinor: sql<number>`sum(${transactions.amountMinor})::int`,
      count: count(),
    })
    .from(transactions)
    .where(and(mine, eq(transactions.status, "posted")))
    .groupBy(transactions.currency);

  const assignedRows = await db
    .select({ name: categories.name, n: count() })
    .from(transactions)
    .innerJoin(categories, eq(categories.id, transactions.categoryId))
    .where(mine)
    .groupBy(categories.name);

  return {
    accounts: await db.$count(accounts, eq(accounts.userId, userId)),
    transactions: await db.$count(transactions, mine),
    balances: await db.$count(accountBalances, eq(accountBalances.userId, userId)),
    pendingCount: await db.$count(transactions, and(mine, eq(transactions.status, "pending"))),
    categories: await db.$count(categories, eq(categories.userId, userId)),
    assigned: Object.fromEntries(assignedRows.map(({ name, n }) => [name, n])),
    posted: Object.fromEntries(posted.map(({ currency, ...totals }) => [currency, totals])),
  };
}

function ledgerExpected(persona: (typeof SEED_PERSONAS)[number]): Omit<ExpectedPersona, "overview" | "history"> {
  const { accounts, transactions, balances, pendingCount, categories, assigned, posted } =
    EXPECTED[persona];
  return { accounts, transactions, balances, pendingCount, categories, assigned, posted };
}

test("seeding lands every persona's ledger in the database exactly, and reseeding is idempotent", async () => {
  await seedDataset(adminDb());
  const ids = await seedDataset(adminDb());

  for (const persona of SEED_PERSONAS) {
    expect(await personaInDb(ids[persona])).toEqual(ledgerExpected(persona));
  }

  expect(await adminDb().$count(users, eq(users.clerkUserId, SEED_USERS.demo.clerkUserId))).toBe(1);
});

test("re-seeding with personas remapped to different users never collides", async () => {
  const x = await withAuth(fakeClerkUserId(), () => requireUser());
  const y = await withAuth(fakeClerkUserId(), () => requireUser());

  await seedDataset(adminDb(), { demo: x.id, neighbor: y.id });
  const ids = await seedDataset(adminDb(), { demo: x.id });

  expect(await personaInDb(x.id)).toEqual(ledgerExpected("demo"));
  expect(await personaInDb(ids.neighbor)).toEqual(ledgerExpected("neighbor"));
  expect(await adminDb().$count(categories, eq(categories.userId, y.id))).toBe(0);
});

test("seedDataset attaches persona ledgers to caller-provided users", async () => {
  const clerkUserId = fakeClerkUserId();
  const realUser = await withAuth(clerkUserId, () => requireUser());

  const ids = await seedDataset(adminDb(), { demo: realUser.id });

  expect(ids.demo).toBe(realUser.id);
  expect(await personaInDb(realUser.id)).toEqual(ledgerExpected("demo"));
  expect(await personaInDb(SEED_USERS.neighbor.id)).toEqual(ledgerExpected("neighbor"));
  await expect(withAuth(clerkUserId, () => ledgerCounts())).resolves.toEqual({
    accounts: EXPECTED.demo.accounts,
    transactions: EXPECTED.demo.transactions,
  });
  expect(await adminDb().$count(users, eq(users.clerkUserId, SEED_USERS.demo.clerkUserId))).toBe(0);
});

const LOCAL_URLS = [
  "postgresql://postgres:postgres@localhost:5433/postgres",
  "postgresql://postgres:postgres@127.0.0.1:5433/postgres",
  "postgresql://postgres:postgres@[::1]:5433/postgres",
];

const REMOTE_URLS = [
  "postgresql://owner:secret@ep-late-dust-123456.us-east-2.aws.neon.tech/cashlens?sslmode=verify-full",
  "postgresql://postgres:postgres@192.168.1.20:5433/postgres",
  "postgresql://postgres:postgres@db:5432/postgres",
  "postgresql://postgres:postgres@host.docker.internal:5433/postgres",
  "postgresql://postgres:postgres@localhost.evil.example:5433/postgres",
  "postgresql://postgres:postgres@evil.localhost:5433/postgres",
];

function refusalFor(value: string | undefined): string {
  try {
    assertLocalDatabaseUrl("DATABASE_URL", value);
  } catch (error) {
    return (error as Error).message;
  }
  return "accepted, no refusal";
}

test("the seed guard accepts loopback database URLs", () => {
  for (const url of LOCAL_URLS) expect(assertLocalDatabaseUrl("DATABASE_URL", url)).toBe(url);
});

test("the seed guard refuses every non-local database URL", () => {
  for (const url of REMOTE_URLS) expect(refusalFor(url)).toContain("only ever seeds a local database");
});

test("the seed guard never echoes a refused URL or its password", () => {
  for (const url of REMOTE_URLS) {
    const message = refusalFor(url);
    expect(message).not.toContain(url);
    expect(message).not.toContain(new URL(url).password);
  }
});

test("the seed guard fails closed on a missing or malformed URL", () => {
  for (const value of [undefined, "", "not a url"]) expect(refusalFor(value)).toContain("DATABASE_URL");
});
