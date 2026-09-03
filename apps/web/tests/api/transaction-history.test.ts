import { expect, test } from "vitest";

import {
  EXPECTED,
  SEED_ACCOUNTS,
  SEED_CATEGORIES,
  SEED_TRANSACTIONS,
  SEED_USERS,
  type SeedPersona,
} from "@/db/seed/dataset";
import { seedDataset } from "@/db/seed/seed";
import { transactionHistory } from "@/lib/data/ledger";
import { requireUser } from "@/lib/data/users";
import { withRequestScope } from "@/lib/db/client";
import { accounts, categories, transactions } from "@/lib/db/schema";
import { DEFAULT_CATEGORIES } from "@/lib/ledger/default-categories";
import { parseHistoryQuery } from "@/lib/ledger/history-query";
import { fakeClerkUserId, withAuth } from "../harness/clerk";
import { adminDb } from "../harness/db";

const filters = (params: Record<string, string> = {}) => {
  const parsed = parseHistoryQuery(params);
  if (!parsed.ok) throw new Error("test filters must parse");
  return parsed;
};

const history = (persona: SeedPersona, params: Record<string, string> = {}) =>
  withAuth(SEED_USERS[persona].clerkUserId, () => transactionHistory(filters(params)));

const ACCOUNT_NAME = new Map(SEED_ACCOUNTS.map((a) => [a.id, a.name]));
const CATEGORY_NAME = new Map(SEED_CATEGORIES.map((c) => [c.id, c.name]));

const seedRow = (id: string) => {
  const t = SEED_TRANSACTIONS.find((row) => row.id === id)!;
  return {
    id: t.id,
    date: t.date,
    description: t.description,
    merchant: t.merchant ?? null,
    amountMinor: t.amountMinor,
    currency: t.currency,
    status: t.status,
    source: t.source,
    accountId: t.accountId,
    accountName: ACCOUNT_NAME.get(t.accountId)!,
    categoryId: t.categoryId ?? null,
    categoryName: t.categoryId ? CATEGORY_NAME.get(t.categoryId)! : null,
    categorySource: t.categorySource ?? null,
    categoryConfidence: t.categoryConfidence ?? null,
    categoryReason: t.categoryReason ?? null,
  };
};

type SeedRow = ReturnType<typeof seedRow>;

const expectedRows = (persona: SeedPersona, matches: (row: SeedRow) => boolean = () => true) =>
  EXPECTED[persona].history.order.map(seedRow).filter(matches);

const expectedOptions = (persona: SeedPersona) => {
  const mine = SEED_CATEGORIES.filter((c) => c.persona === persona);
  return {
    accounts: SEED_ACCOUNTS.filter((a) => a.persona === persona)
      .map(({ id, name }) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    categoryGroups: mine
      .filter((c) => c.parentId === null)
      .map((root) => ({
        id: root.id,
        name: root.name,
        categories: mine
          .filter((c) => c.parentId === root.id)
          .map(({ id, name }) => ({ id, name })),
      })),
    currencies: EXPECTED[persona].history.currencies,
  };
};

const leaf = (persona: SeedPersona, name: string) =>
  SEED_CATEGORIES.find((c) => c.persona === persona && c.name === name && c.parentId !== null)!.id;

test("the default view is each persona's exact ledger, newest first, with full row context", async () => {
  await seedDataset(adminDb());

  for (const persona of ["demo", "neighbor", "empty"] as const) {
    const result = await history(persona);
    expect(result.rows).toEqual(expectedRows(persona));
    expect(result.total).toBe(EXPECTED[persona].transactions);
    expect(result.page).toBe(1);
    expect(result.pageCount).toBe(EXPECTED[persona].transactions === 0 ? 0 : 1);
    expect(result.options).toEqual(
      persona === "empty"
        ? // A category surface read plants the 4.1.1 default tree for a fresh user.
          {
            accounts: [],
            categoryGroups: DEFAULT_CATEGORIES.map(({ group, categories: names }) => ({
              id: expect.any(String),
              name: group,
              categories: names.map((name) => ({ id: expect.any(String), name })),
            })),
            currencies: [],
          }
        : expectedOptions(persona),
    );
  }
});

test("search is a case-insensitive literal over merchant and description, wildcards included", async () => {
  await seedDataset(adminDb());
  const matching = (q: string) => (row: SeedRow) =>
    [row.description, row.merchant ?? ""].some((s) => s.toLowerCase().includes(q.toLowerCase()));

  for (const q of ["acme", "ACME", "Market"]) {
    const result = await history("demo", { q });
    expect(result.rows).toEqual(expectedRows("demo", matching(q)));
    expect(result.rows.length).toBeGreaterThan(0);
    expect(result.total).toBe(result.rows.length);
  }

  expect((await history("demo", { q: "#204" })).rows).toEqual(
    expectedRows("demo", matching("#204")),
  );
  expect((await history("demo", { q: "%" })).total).toBe(0);
  expect((await history("demo", { q: "_" })).total).toBe(0);
});

test("account and category filters narrow to exactly the referenced rows", async () => {
  await seedDataset(adminDb());
  const card = SEED_ACCOUNTS.find((a) => a.persona === "demo" && a.name === "Cash Rewards Card")!;
  const groceries = leaf("demo", "Groceries");

  const byAccount = await history("demo", { account: card.id });
  expect(byAccount.rows).toEqual(expectedRows("demo", (row) => row.accountId === card.id));
  expect(byAccount.rows.length).toBeGreaterThan(1);

  const byCategory = await history("demo", { category: groceries });
  expect(byCategory.rows).toEqual(expectedRows("demo", (row) => row.categoryId === groceries));
  expect(byCategory.rows.length).toBe(1);
});

test("a cross-user id yields the same empty result as an unknown id", async () => {
  await seedDataset(adminDb());
  const foreignAccount = SEED_ACCOUNTS.find((a) => a.persona === "neighbor")!.id;
  const foreignCategory = leaf("neighbor", "Electronics");
  const unknown = "00000000-0000-4000-8000-00000000dead";

  expect(await history("demo", { account: foreignAccount })).toEqual(
    await history("demo", { account: unknown }),
  );
  expect((await history("demo", { account: foreignAccount })).total).toBe(0);

  expect(await history("demo", { category: foreignCategory })).toEqual(
    await history("demo", { category: unknown }),
  );
  expect((await history("demo", { category: foreignCategory })).total).toBe(0);
});

test("the date range is inclusive on both edges", async () => {
  await seedDataset(adminDb());

  const windowed = await history("demo", { from: "2026-03-02", to: "2026-03-07" });
  expect(windowed.rows).toEqual(
    expectedRows("demo", (row) => row.date >= "2026-03-02" && row.date <= "2026-03-07"),
  );
  expect(windowed.rows.map((row) => row.date)).toContain("2026-03-02");
  expect(windowed.rows.map((row) => row.date)).toContain("2026-03-07");

  const fromOnly = await history("demo", { from: "2026-03-27" });
  expect(fromOnly.rows).toEqual(expectedRows("demo", (row) => row.date >= "2026-03-27"));
  const toOnly = await history("demo", { to: "2026-02-27" });
  expect(toOnly.rows).toEqual(expectedRows("demo", (row) => row.date <= "2026-02-27"));
});

test("amount filters compare absolute magnitude inside one currency only", async () => {
  await seedDataset(adminDb());

  const large = await history("demo", { currency: "USD", min: "850" });
  expect(large.rows).toEqual(
    expectedRows("demo", (row) => row.currency === "USD" && Math.abs(row.amountMinor) >= 85000),
  );
  expect(large.rows.some((row) => row.amountMinor < 0)).toBe(true);
  expect(large.rows.some((row) => row.amountMinor > 0)).toBe(true);

  const window = await history("demo", { currency: "USD", min: "100", max: "500" });
  expect(window.rows).toEqual(
    expectedRows(
      "demo",
      (row) =>
        row.currency === "USD" &&
        Math.abs(row.amountMinor) >= 10000 &&
        Math.abs(row.amountMinor) <= 50000,
    ),
  );

  const euros = await history("demo", { currency: "EUR", min: "60" });
  expect(euros.rows).toEqual(
    expectedRows("demo", (row) => row.currency === "EUR" && Math.abs(row.amountMinor) >= 6000),
  );
  expect(euros.total).toBe(1);
});

test("filters combine as one AND query", async () => {
  await seedDataset(adminDb());
  const card = SEED_ACCOUNTS.find((a) => a.persona === "demo" && a.name === "Cash Rewards Card")!;

  const result = await history("demo", {
    q: "skyline",
    account: card.id,
    from: "2026-03-01",
    currency: "USD",
    min: "100",
  });
  expect(result.rows).toEqual(
    expectedRows(
      "demo",
      (row) =>
        [row.description, row.merchant ?? ""].some((s) => s.toLowerCase().includes("skyline")) &&
        row.accountId === card.id &&
        row.date >= "2026-03-01" &&
        row.currency === "USD" &&
        Math.abs(row.amountMinor) >= 10000,
    ),
  );
  expect(result.total).toBe(1);
});

async function provisionLedger(rowCount: number) {
  const clerkUserId = fakeClerkUserId();
  const user = await withAuth(clerkUserId, () => requireUser());
  const [account] = await adminDb()
    .insert(accounts)
    .values({ userId: user.id, name: "Paged", type: "depository", currency: "USD", source: "manual" })
    .returning({ id: accounts.id });
  const rows = Array.from({ length: rowCount }, (_, i) => ({
    userId: user.id,
    accountId: account.id,
    amountMinor: -(i + 1) * 100,
    currency: "USD",
    date: new Date(Date.UTC(2025, 0, 1 + i)).toISOString().slice(0, 10),
    description: `PAGE ROW ${String(i).padStart(2, "0")}`,
    status: "posted" as const,
    source: "manual" as const,
  }));
  if (rows.length) await adminDb().insert(transactions).values(rows);
  return { clerkUserId, userId: user.id, accountId: account.id, rows };
}

test("pagination serves fixed 50-row pages with honest totals, filters intact", async () => {
  const { clerkUserId, rows } = await provisionLedger(55);
  const newestFirst = [...rows].reverse();

  const page1 = await withAuth(clerkUserId, () => transactionHistory(filters()));
  expect(page1.rows.map((row) => row.description)).toEqual(
    newestFirst.slice(0, 50).map((row) => row.description),
  );
  expect(page1).toMatchObject({ total: 55, page: 1, pageCount: 2 });

  const page2 = await withAuth(clerkUserId, () => transactionHistory(filters({ page: "2" })));
  expect(page2.rows.map((row) => row.description)).toEqual(
    newestFirst.slice(50).map((row) => row.description),
  );
  expect(page2).toMatchObject({ total: 55, page: 2, pageCount: 2 });

  const beyond = await withAuth(clerkUserId, () => transactionHistory(filters({ page: "3" })));
  expect(beyond).toMatchObject({ rows: [], total: 55, page: 3, pageCount: 2 });

  const filtered = await withAuth(clerkUserId, () =>
    transactionHistory(filters({ q: "PAGE ROW 0", page: "1" })),
  );
  expect(filtered.rows.map((row) => row.description)).toEqual(
    newestFirst.filter((row) => row.description.includes("PAGE ROW 0")).map((row) => row.description),
  );
  expect(filtered).toMatchObject({ total: 10, pageCount: 1 });
});

test("date ties order by created_at then id, newest first", async () => {
  const { clerkUserId, userId, accountId } = await provisionLedger(0);
  const base = {
    userId,
    accountId,
    currency: "USD",
    date: "2026-04-01",
    status: "posted" as const,
    source: "manual" as const,
  };

  const [earlier] = await adminDb()
    .insert(transactions)
    .values({ ...base, amountMinor: -100, description: "EARLIER", createdAt: new Date("2026-04-01T10:00:00Z") })
    .returning({ id: transactions.id });
  const [later] = await adminDb()
    .insert(transactions)
    .values({ ...base, amountMinor: -200, description: "LATER", createdAt: new Date("2026-04-01T11:00:00Z") })
    .returning({ id: transactions.id });
  const twins = await adminDb()
    .insert(transactions)
    .values([
      { ...base, amountMinor: -300, description: "TWIN", createdAt: new Date("2026-04-01T09:00:00Z") },
      { ...base, amountMinor: -400, description: "TWIN", createdAt: new Date("2026-04-01T09:00:00Z") },
    ])
    .returning({ id: transactions.id });

  const result = await withAuth(clerkUserId, () => transactionHistory(filters()));
  expect(result.rows.map((row) => row.id)).toEqual([
    later.id,
    earlier.id,
    ...twins.map((row) => row.id).sort((a, b) => b.localeCompare(a)),
  ]);
});

test("an invalid parse returns the form's options and nothing else", async () => {
  await seedDataset(adminDb());

  const result = await withAuth(SEED_USERS.demo.clerkUserId, () =>
    transactionHistory({ ok: false }),
  );
  expect(result).toEqual({
    rows: [],
    total: 0,
    page: 1,
    pageCount: 0,
    options: expectedOptions("demo"),
  });
});

test("neither persona's rows or filter options ever surface for the other", async () => {
  await seedDataset(adminDb());

  const demo = await history("demo");
  const neighbor = await history("neighbor");

  const neighborIds = new Set([
    ...neighbor.rows.map((row) => row.id),
    ...neighbor.options.accounts.map((a) => a.id),
    ...neighbor.options.categoryGroups.flatMap((g) => [g.id, ...g.categories.map((c) => c.id)]),
  ]);
  const demoIds = [
    ...demo.rows.map((row) => row.id),
    ...demo.options.accounts.map((a) => a.id),
    ...demo.options.categoryGroups.flatMap((g) => [g.id, ...g.categories.map((c) => c.id)]),
  ];
  expect(demoIds.filter((id) => neighborIds.has(id))).toEqual([]);
  expect(JSON.stringify(demo)).not.toContain("Neighbor");
  expect(JSON.stringify(neighbor)).not.toContain("ACME");
});

test("every table the history page reads enforces the signed-in scope without DAL predicates", async () => {
  await seedDataset(adminDb());
  const ownIds = (rows: { id: string }[]) => rows.map((row) => row.id).sort();

  const seen = await withRequestScope(SEED_USERS.neighbor.clerkUserId, async (tx) => ({
    transactions: await tx.select({ id: transactions.id }).from(transactions),
    accounts: await tx.select({ id: accounts.id }).from(accounts),
    categories: await tx.select({ id: categories.id }).from(categories),
  }));

  expect(ownIds(seen.transactions)).toEqual([...EXPECTED.neighbor.history.order].sort());
  expect(ownIds(seen.accounts)).toEqual(
    SEED_ACCOUNTS.filter((a) => a.persona === "neighbor").map((a) => a.id),
  );
  expect(ownIds(seen.categories)).toEqual(
    SEED_CATEGORIES.filter((c) => c.persona === "neighbor")
      .map((c) => c.id)
      .sort(),
  );
});

test("history reads require a signed-in user", async () => {
  await expect(transactionHistory(filters())).rejects.toEqual(
    expect.objectContaining({ digest: expect.stringContaining("/sign-in") }),
  );
});
