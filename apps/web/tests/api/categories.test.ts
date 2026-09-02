import { eq } from "drizzle-orm";
import { expect, test } from "vitest";

import { POST as categoryRoute } from "@/app/api/transactions/[transactionId]/category/route";
import { SEED_CATEGORIES, SEED_USERS } from "@/db/seed/dataset";
import { seedDataset } from "@/db/seed/seed";
import { listCategoryGroups, setTransactionCategory } from "@/lib/data/categories";
import { requireUser } from "@/lib/data/users";
import { withRequestScope } from "@/lib/db/client";
import { accounts, categories, transactions } from "@/lib/db/schema";
import { DEFAULT_CATEGORIES } from "@/lib/ledger/default-categories";
import { fakeClerkUserId, withAuth } from "../harness/clerk";
import { adminDb } from "../harness/db";

const pgError = (code: string) => ({ cause: expect.objectContaining({ code }) });

const DEFAULT_TREE = DEFAULT_CATEGORIES.map(({ group, categories: names }) => ({
  id: expect.any(String),
  name: group,
  categories: names.map((name) => ({ id: expect.any(String), name })),
}));

const TREE_SIZE = DEFAULT_CATEGORIES.reduce((n, { categories }) => n + 1 + categories.length, 0);

async function provision(clerkUserId: string) {
  const user = await withAuth(clerkUserId, () => requireUser());
  const [account] = await adminDb()
    .insert(accounts)
    .values({ userId: user.id, name: "Checking", type: "depository", currency: "USD", source: "manual" })
    .returning({ id: accounts.id });
  const [txn] = await adminDb()
    .insert(transactions)
    .values({
      userId: user.id,
      accountId: account.id,
      amountMinor: -1234,
      currency: "USD",
      date: "2026-03-01",
      description: "COFFEE SHOP",
      status: "posted",
      source: "manual",
    })
    .returning({ id: transactions.id });
  return { user, transactionId: txn.id };
}

const leafNamed = (groups: Awaited<ReturnType<typeof listCategoryGroups>>, name: string) => {
  for (const group of groups) {
    const leaf = group.categories.find((category) => category.name === name);
    if (leaf) return leaf.id;
  }
  throw new Error(`no default leaf named ${name}`);
};

const categoryOf = async (transactionId: string) => {
  const [row] = await adminDb()
    .select({ categoryId: transactions.categoryId })
    .from(transactions)
    .where(eq(transactions.id, transactionId));
  return row.categoryId;
};

test("the first category read plants exactly the default tree, and only once", async () => {
  const clerkUserId = fakeClerkUserId();
  const { user } = await provision(clerkUserId);

  const groups = await withAuth(clerkUserId, () => listCategoryGroups());
  expect(groups).toEqual(DEFAULT_TREE);

  const again = await withAuth(clerkUserId, () => listCategoryGroups());
  expect(again).toEqual(groups);

  expect(await adminDb().$count(categories, eq(categories.userId, user.id))).toBe(TREE_SIZE);
});

test("concurrent first reads race to exactly one default tree, never a duplicate", async () => {
  const clerkUserId = fakeClerkUserId();
  const { user } = await provision(clerkUserId);

  const [first, second] = await Promise.all([
    withAuth(clerkUserId, () => listCategoryGroups()),
    withAuth(clerkUserId, () => listCategoryGroups()),
  ]);

  expect(first).toEqual(DEFAULT_TREE);
  expect(second).toEqual(first);
  expect(await adminDb().$count(categories, eq(categories.userId, user.id))).toBe(TREE_SIZE);
});

test("planted categories are per-user rows, invisible to anyone else", async () => {
  const clerkA = fakeClerkUserId();
  const clerkB = fakeClerkUserId();
  await provision(clerkA);
  await provision(clerkB);

  const groupsA = await withAuth(clerkA, () => listCategoryGroups());
  const groupsB = await withAuth(clerkB, () => listCategoryGroups());
  expect(groupsA).toEqual(DEFAULT_TREE);
  expect(groupsB).toEqual(DEFAULT_TREE);

  const ids = (groups: typeof groupsA) =>
    groups.flatMap((group) => [group.id, ...group.categories.map((category) => category.id)]);
  expect(ids(groupsA).filter((id) => ids(groupsB).includes(id))).toEqual([]);

  const visibleToB = await withRequestScope(clerkB, (tx) =>
    tx.select({ id: categories.id }).from(categories),
  );
  expect(new Set(visibleToB.map((row) => row.id))).toEqual(new Set(ids(groupsB)));
});

test("assignment persists, reassigns, and clears back to uncategorized", async () => {
  const clerkUserId = fakeClerkUserId();
  const { transactionId } = await provision(clerkUserId);
  const groups = await withAuth(clerkUserId, () => listCategoryGroups());
  const coffee = leafNamed(groups, "Coffee Shops");
  const groceries = leafNamed(groups, "Groceries");

  await expect(
    withAuth(clerkUserId, () => setTransactionCategory(transactionId, coffee)),
  ).resolves.toEqual({ transactionId, categoryId: coffee });
  expect(await categoryOf(transactionId)).toBe(coffee);

  await expect(
    withAuth(clerkUserId, () => setTransactionCategory(transactionId, groceries)),
  ).resolves.toEqual({ transactionId, categoryId: groceries });
  expect(await categoryOf(transactionId)).toBe(groceries);

  await expect(
    withAuth(clerkUserId, () => setTransactionCategory(transactionId, null)),
  ).resolves.toEqual({ transactionId, categoryId: null });
  expect(await categoryOf(transactionId)).toBeNull();
});

test("a category group is never assignable", async () => {
  const clerkUserId = fakeClerkUserId();
  const { transactionId } = await provision(clerkUserId);
  const groups = await withAuth(clerkUserId, () => listCategoryGroups());

  await expect(
    withAuth(clerkUserId, () => setTransactionCategory(transactionId, groups[0].id)),
  ).resolves.toEqual({ error: "category_not_assignable" });
  expect(await categoryOf(transactionId)).toBeNull();
});

test("cross-user transaction and category ids disclose nothing and change nothing", async () => {
  const clerkA = fakeClerkUserId();
  const clerkB = fakeClerkUserId();
  const a = await provision(clerkA);
  const b = await provision(clerkB);
  const groupsA = await withAuth(clerkA, () => listCategoryGroups());
  const groupsB = await withAuth(clerkB, () => listCategoryGroups());

  await expect(
    withAuth(clerkA, () => setTransactionCategory(b.transactionId, leafNamed(groupsA, "Groceries"))),
  ).resolves.toEqual({ error: "transaction_not_found" });
  expect(await categoryOf(b.transactionId)).toBeNull();

  const foreign = await withAuth(clerkA, () =>
    setTransactionCategory(a.transactionId, leafNamed(groupsB, "Groceries")),
  );
  const unknown = await withAuth(clerkA, () =>
    setTransactionCategory(a.transactionId, "00000000-0000-4000-8000-00000000dead"),
  );
  expect(foreign).toEqual({ error: "category_not_found" });
  expect(unknown).toEqual(foreign);
  expect(await categoryOf(a.transactionId)).toBeNull();

  await expect(
    withAuth(clerkA, () => setTransactionCategory("not-a-uuid", null)),
  ).resolves.toEqual({ error: "transaction_not_found" });
});

test("seeded personas read exactly their own seeded taxonomy, and nothing is replanted", async () => {
  await seedDataset(adminDb());

  for (const persona of ["demo", "neighbor"] as const) {
    const mine = SEED_CATEGORIES.filter((row) => row.persona === persona);
    const expected = mine
      .filter((row) => row.parentId === null)
      .map((root) => ({
        id: root.id,
        name: root.name,
        categories: mine
          .filter((row) => row.parentId === root.id)
          .map(({ id, name }) => ({ id, name })),
      }));

    const groups = await withAuth(SEED_USERS[persona].clerkUserId, () => listCategoryGroups());
    expect(groups).toEqual(expected);
    expect(await adminDb().$count(categories, eq(categories.userId, SEED_USERS[persona].id))).toBe(
      mine.length,
    );
  }
});

test("category reads and writes require a signed-in user", async () => {
  const signedIn = expect.objectContaining({ digest: expect.stringContaining("/sign-in") });
  await expect(listCategoryGroups()).rejects.toEqual(signedIn);
  await expect(setTransactionCategory("00000000-0000-4000-8000-000000000001", null)).rejects.toEqual(
    signedIn,
  );
});

test("the app role has no update or delete path on categories", async () => {
  const clerkUserId = fakeClerkUserId();
  await provision(clerkUserId);
  await withAuth(clerkUserId, () => listCategoryGroups());

  await expect(
    withRequestScope(clerkUserId, (tx) => tx.update(categories).set({ name: "Hacked" })),
  ).rejects.toMatchObject(pgError("42501"));
  await expect(
    withRequestScope(clerkUserId, (tx) => tx.delete(categories)),
  ).rejects.toMatchObject(pgError("42501"));
});

const post = (
  transactionId: string,
  body: unknown,
  headers: Record<string, string> = {},
) =>
  categoryRoute(
    new Request(`http://localhost/api/transactions/${transactionId}/category`, {
      method: "POST",
      headers: { host: "localhost", "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ transactionId }) },
  );

test("the category route assigns and clears through the boundary", async () => {
  const clerkUserId = fakeClerkUserId();
  const { transactionId } = await provision(clerkUserId);
  const groups = await withAuth(clerkUserId, () => listCategoryGroups());
  const coffee = leafNamed(groups, "Coffee Shops");

  const assigned = await withAuth(clerkUserId, () => post(transactionId, { categoryId: coffee }));
  expect(assigned.status).toBe(200);
  expect(await assigned.json()).toEqual({ transactionId, categoryId: coffee });
  expect(await categoryOf(transactionId)).toBe(coffee);

  const cleared = await withAuth(clerkUserId, () => post(transactionId, { categoryId: null }));
  expect(cleared.status).toBe(200);
  expect(await cleared.json()).toEqual({ transactionId, categoryId: null });
  expect(await categoryOf(transactionId)).toBeNull();
});

test("the category route rejects bad callers and bad bodies without touching rows", async () => {
  const clerkUserId = fakeClerkUserId();
  const { transactionId } = await provision(clerkUserId);
  const groups = await withAuth(clerkUserId, () => listCategoryGroups());
  const coffee = leafNamed(groups, "Coffee Shops");

  expect((await post(transactionId, { categoryId: coffee })).status).toBe(401);

  const crossOrigin = await withAuth(clerkUserId, () =>
    post(transactionId, { categoryId: coffee }, { origin: "https://evil.example" }),
  );
  expect(crossOrigin.status).toBe(403);

  for (const body of [{}, { categoryId: 5 }, { categoryId: undefined }, "categoryId"]) {
    const response = await withAuth(clerkUserId, () => post(transactionId, body));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_request" });
  }

  const unknownTransaction = await withAuth(clerkUserId, () =>
    post("00000000-0000-4000-8000-00000000beef", { categoryId: coffee }),
  );
  expect(unknownTransaction.status).toBe(404);
  expect(await unknownTransaction.json()).toEqual({ error: "transaction_not_found" });

  const group = await withAuth(clerkUserId, () =>
    post(transactionId, { categoryId: groups[0].id }),
  );
  expect(group.status).toBe(422);

  expect(await categoryOf(transactionId)).toBeNull();
});
