import { and, count, eq, sql } from "drizzle-orm";
import { expect, test } from "vitest";

import { EXPECTED, SEED_ACCOUNTS, SEED_BALANCES, SEED_PERSONAS, SEED_TRANSACTIONS, SEED_USERS, type ExpectedPersona } from "@/db/seed/dataset";
import { assertLocalDatabaseUrl } from "@/db/seed/local-only";
import { seedDataset } from "@/db/seed/seed";
import { ledgerCounts } from "@/lib/data/ledger";
import { requireUser } from "@/lib/data/users";
import { accountBalances, accounts, transactions, users } from "@/lib/db/schema";
import { fakeClerkUserId, withAuth } from "../harness/clerk";
import { adminDb } from "../harness/db";

test("the dataset's exported totals match the hand-verified anchors", () => {
  expect(EXPECTED.demo).toEqual({
    accounts: 5,
    transactions: 16,
    balances: 5,
    pendingCount: 1,
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
  });
  expect(EXPECTED.neighbor).toEqual({
    accounts: 1,
    transactions: 2,
    balances: 1,
    pendingCount: 0,
    posted: { USD: { inflowMinor: 75000, outflowMinor: -12345, netMinor: 62655, count: 2 } },
    overview: {
      accounts: [
        { name: "Neighbor Checking", type: "depository", subtype: "checking", mask: "0900", currency: "USD", currentMinor: 50000 },
      ],
      cashOnHand: { USD: 50000 },
      creditOwed: {},
    },
  });
  expect(EXPECTED.empty).toEqual({
    accounts: 0,
    transactions: 0,
    balances: 0,
    pendingCount: 0,
    posted: {},
    overview: { accounts: [], cashOnHand: {}, creditOwed: {} },
  });
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

async function personaInDb(userId: string): Promise<Omit<ExpectedPersona, "overview">> {
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

  return {
    accounts: await db.$count(accounts, eq(accounts.userId, userId)),
    transactions: await db.$count(transactions, mine),
    balances: await db.$count(accountBalances, eq(accountBalances.userId, userId)),
    pendingCount: await db.$count(transactions, and(mine, eq(transactions.status, "pending"))),
    posted: Object.fromEntries(posted.map(({ currency, ...totals }) => [currency, totals])),
  };
}

function ledgerExpected(persona: (typeof SEED_PERSONAS)[number]): Omit<ExpectedPersona, "overview"> {
  const { accounts, transactions, balances, pendingCount, posted } = EXPECTED[persona];
  return { accounts, transactions, balances, pendingCount, posted };
}

test("seeding lands every persona's ledger in the database exactly, and reseeding is idempotent", async () => {
  await seedDataset(adminDb());
  const ids = await seedDataset(adminDb());

  for (const persona of SEED_PERSONAS) {
    expect(await personaInDb(ids[persona])).toEqual(ledgerExpected(persona));
  }

  expect(await adminDb().$count(users, eq(users.clerkUserId, SEED_USERS.demo.clerkUserId))).toBe(1);
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
