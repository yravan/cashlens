import { and, count, eq, sql } from "drizzle-orm";
import { expect, test } from "vitest";

import { EXPECTED, SEED_ACCOUNTS, SEED_BALANCES, SEED_TRANSACTIONS, SEED_USERS, type SeedPersona } from "@/db/seed/dataset";
import { assertLocalDatabaseUrl } from "@/db/seed/local-only";
import { seedDataset } from "@/db/seed/seed";
import { ledgerCounts } from "@/lib/data/ledger";
import { requireUser } from "@/lib/data/users";
import { accounts, transactions, users } from "@/lib/db/schema";
import { fakeClerkUserId, withAuth } from "../harness/clerk";
import { adminDb } from "../harness/db";

const PERSONAS = Object.keys(SEED_USERS) as SeedPersona[];

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
  });
  expect(EXPECTED.neighbor).toEqual({
    accounts: 1,
    transactions: 2,
    balances: 1,
    pendingCount: 0,
    posted: { USD: { inflowMinor: 75000, outflowMinor: -12345, netMinor: 62655, count: 2 } },
  });
  expect(EXPECTED.empty).toEqual({
    accounts: 0,
    transactions: 0,
    balances: 0,
    pendingCount: 0,
    posted: {},
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

async function postedTotalsInDb(userId: string) {
  const rows = await adminDb()
    .select({
      currency: transactions.currency,
      inflowMinor: sql<number>`sum(${transactions.amountMinor}) filter (where ${transactions.amountMinor} >= 0)::int`,
      outflowMinor: sql<number>`sum(${transactions.amountMinor}) filter (where ${transactions.amountMinor} < 0)::int`,
      netMinor: sql<number>`sum(${transactions.amountMinor})::int`,
      count: count(),
    })
    .from(transactions)
    .where(and(eq(transactions.userId, userId), eq(transactions.status, "posted")))
    .groupBy(transactions.currency);
  return Object.fromEntries(
    rows.map(({ currency, ...totals }) => [
      currency,
      { ...totals, inflowMinor: totals.inflowMinor ?? 0, outflowMinor: totals.outflowMinor ?? 0 },
    ]),
  );
}

test("seeding lands the dataset in the database exactly, and reseeding is idempotent", async () => {
  await seedDataset(adminDb());
  const ids = await seedDataset(adminDb());

  for (const persona of PERSONAS) {
    await expect(
      withAuth(SEED_USERS[persona].clerkUserId, () => ledgerCounts()),
    ).resolves.toEqual({
      accounts: EXPECTED[persona].accounts,
      transactions: EXPECTED[persona].transactions,
    });
    expect(await postedTotalsInDb(ids[persona])).toEqual(EXPECTED[persona].posted);
  }

  const [{ n }] = await adminDb()
    .select({ n: count() })
    .from(users)
    .where(eq(users.clerkUserId, SEED_USERS.demo.clerkUserId));
  expect(n).toBe(1);
});

test("seedDataset attaches persona ledgers to caller-provided users", async () => {
  const clerkUserId = fakeClerkUserId();
  const realUser = await withAuth(clerkUserId, () => requireUser());

  const ids = await seedDataset(adminDb(), { demo: realUser.id });
  expect(ids.demo).toBe(realUser.id);

  await expect(withAuth(clerkUserId, () => ledgerCounts())).resolves.toEqual({
    accounts: EXPECTED.demo.accounts,
    transactions: EXPECTED.demo.transactions,
  });
  expect(await postedTotalsInDb(realUser.id)).toEqual(EXPECTED.demo.posted);

  const demoPersonaUsers = await adminDb()
    .select()
    .from(users)
    .where(eq(users.clerkUserId, SEED_USERS.demo.clerkUserId));
  expect(demoPersonaUsers).toEqual([]);

  const [{ n }] = await adminDb()
    .select({ n: count() })
    .from(accounts)
    .where(eq(accounts.userId, SEED_USERS.neighbor.id));
  expect(n).toBe(EXPECTED.neighbor.accounts);
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
];

test("the seed guard accepts loopback database URLs", () => {
  for (const url of LOCAL_URLS) {
    expect(assertLocalDatabaseUrl("DATABASE_URL", url)).toBe(url);
  }
});

test("the seed guard refuses any non-local database URL", () => {
  for (const url of REMOTE_URLS) {
    expect(() => assertLocalDatabaseUrl("DATABASE_URL", url)).toThrowError(
      /only ever seeds a local database/,
    );
  }
});

test("the seed guard refuses non-local URLs without echoing the URL or its password", () => {
  const url = REMOTE_URLS[0];
  let thrown: unknown;
  try {
    assertLocalDatabaseUrl("DATABASE_URL", url);
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(Error);
  const message = (thrown as Error).message;
  expect(message).not.toContain(url);
  expect(message).not.toContain("secret");
});

test("the seed guard fails closed on a missing or malformed URL", () => {
  expect(() => assertLocalDatabaseUrl("DATABASE_URL", undefined)).toThrowError(/DATABASE_URL/);
  expect(() => assertLocalDatabaseUrl("DATABASE_URL", "")).toThrowError(/DATABASE_URL/);
  expect(() => assertLocalDatabaseUrl("DATABASE_URL", "not a url")).toThrowError(/DATABASE_URL/);
});
