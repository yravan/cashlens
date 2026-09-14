import { and, eq, isNotNull, sql } from "drizzle-orm";
import { expect, test } from "vitest";

import { POST as editRoute } from "@/app/api/categories/[categoryId]/route";
import { POST as createRoute } from "@/app/api/categories/route";
import { POST as categoryRoute } from "@/app/api/transactions/[transactionId]/category/route";
import { EXPECTED, SEED_CATEGORIES, SEED_TRANSACTIONS, SEED_USERS } from "@/db/seed/dataset";
import { seedDataset } from "@/db/seed/seed";
import {
  createCategory,
  listCategoryGroups,
  listCategoryTree,
  resolveAssignableCategory,
  setTransactionCategory,
  updateCategory,
} from "@/lib/data/categories";
import { spendingByCategory, transactionHistory } from "@/lib/data/ledger";
import { matchTransfers } from "@/lib/data/transfers";
import { requireUser } from "@/lib/data/users";
import { withRequestScope } from "@/lib/db/client";
import { accounts, categories, transactions } from "@/lib/db/schema";
import { DEFAULT_CATEGORIES } from "@/lib/ledger/default-categories";
import { parseHistoryQuery } from "@/lib/ledger/history-query";
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

const provenanceOf = async (transactionId: string) => {
  const [row] = await adminDb()
    .select({
      categoryId: transactions.categoryId,
      source: transactions.categorySource,
      confidence: transactions.categoryConfidence,
      reason: transactions.categoryReason,
    })
    .from(transactions)
    .where(eq(transactions.id, transactionId));
  return row;
};

test("manual assignment stamps user provenance and wipes auto fields; clearing wipes everything", async () => {
  const clerkUserId = fakeClerkUserId();
  const { transactionId } = await provision(clerkUserId);
  const groups = await withAuth(clerkUserId, () => listCategoryGroups());
  const coffee = leafNamed(groups, "Coffee Shops");
  const groceries = leafNamed(groups, "Groceries");

  await withAuth(clerkUserId, () => setTransactionCategory(transactionId, coffee));
  expect(await provenanceOf(transactionId)).toEqual({
    categoryId: coffee,
    source: "user",
    confidence: null,
    reason: null,
  });

  await adminDb()
    .update(transactions)
    .set({
      categorySource: "auto",
      categoryConfidence: "low",
      categoryReason: "Machine guess",
    })
    .where(eq(transactions.id, transactionId));

  await withAuth(clerkUserId, () => setTransactionCategory(transactionId, groceries));
  expect(await provenanceOf(transactionId)).toEqual({
    categoryId: groceries,
    source: "user",
    confidence: null,
    reason: null,
  });

  await withAuth(clerkUserId, () => setTransactionCategory(transactionId, null));
  expect(await provenanceOf(transactionId)).toEqual({
    categoryId: null,
    source: null,
    confidence: null,
    reason: null,
  });
});

test("provenance invariants hold at the schema level, even for privileged writers", async () => {
  const clerkUserId = fakeClerkUserId();
  const { transactionId } = await provision(clerkUserId);
  const groups = await withAuth(clerkUserId, () => listCategoryGroups());
  const violations: Partial<typeof transactions.$inferInsert>[] = [
    { categorySource: "auto" },
    { categoryId: leafNamed(groups, "Groceries"), categorySource: "user", categoryConfidence: "high" },
    { categoryId: leafNamed(groups, "Groceries"), categorySource: "user", categoryReason: "why" },
    {
      categoryId: leafNamed(groups, "Groceries"),
      categorySource: "auto",
      categoryConfidence: "low",
      categoryReason: "x".repeat(201),
    },
  ];
  for (const set of violations) {
    await expect(
      adminDb().update(transactions).set(set).where(eq(transactions.id, transactionId)),
    ).rejects.toMatchObject(pgError("23514"));
  }
  expect(await provenanceOf(transactionId)).toEqual({
    categoryId: null,
    source: null,
    confidence: null,
    reason: null,
  });
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

test("the transaction-scoped resolver distinguishes leaves, groups, and hidden categories", async () => {
  const clerkA = fakeClerkUserId();
  const clerkB = fakeClerkUserId();
  const a = await provision(clerkA);
  await provision(clerkB);
  const groupsA = await withAuth(clerkA, () => listCategoryGroups());
  const groupsB = await withAuth(clerkB, () => listCategoryGroups());
  const leaf = leafNamed(groupsA, "Groceries");

  await withRequestScope(clerkA, async (tx) => {
    await expect(resolveAssignableCategory(tx, a.user.id, null)).resolves.toEqual({
      ok: true,
      categoryId: null,
    });
    await expect(resolveAssignableCategory(tx, a.user.id, leaf)).resolves.toEqual({
      ok: true,
      categoryId: leaf,
    });
    await expect(resolveAssignableCategory(tx, a.user.id, groupsA[0].id)).resolves.toEqual({
      ok: false,
      error: "category_not_assignable",
    });

    const hidden = { ok: false, error: "category_not_found" };
    await expect(resolveAssignableCategory(tx, a.user.id, "not-a-uuid")).resolves.toEqual(hidden);
    await expect(
      resolveAssignableCategory(tx, a.user.id, "00000000-0000-4000-8000-00000000dead"),
    ).resolves.toEqual(hidden);
    await expect(
      resolveAssignableCategory(tx, a.user.id, leafNamed(groupsB, "Groceries")),
    ).resolves.toEqual(hidden);
  });
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
  await expect(listCategoryTree()).rejects.toEqual(signedIn);
  await expect(setTransactionCategory("00000000-0000-4000-8000-000000000001", null)).rejects.toEqual(
    signedIn,
  );
  await expect(createCategory({ name: "Pets", parentId: null })).rejects.toEqual(signedIn);
  await expect(
    updateCategory("00000000-0000-4000-8000-000000000001", {
      name: "Pets",
      parentId: null,
      retired: false,
    }),
  ).rejects.toEqual(signedIn);
});

test("the app role's categories write surface is a column-scoped, RLS-scoped update and no delete", async () => {
  const clerkA = fakeClerkUserId();
  const clerkB = fakeClerkUserId();
  const a = await provision(clerkA);
  const b = await provision(clerkB);
  await withAuth(clerkA, () => listCategoryGroups());
  await withAuth(clerkB, () => listCategoryGroups());

  for (const set of [{ userId: b.user.id }, { sortOrder: 0 }, { createdAt: sql`now()` }]) {
    await expect(
      withRequestScope(clerkA, (tx) => tx.update(categories).set(set)),
    ).rejects.toMatchObject(pgError("42501"));
  }
  await expect(
    withRequestScope(clerkA, (tx) => tx.delete(categories)),
  ).rejects.toMatchObject(pgError("42501"));

  const retired = await withRequestScope(clerkA, (tx) =>
    tx
      .update(categories)
      .set({ retiredAt: sql`now()` })
      .returning({ userId: categories.userId }),
  );
  expect(retired).toHaveLength(TREE_SIZE);
  expect(new Set(retired.map((row) => row.userId))).toEqual(new Set([a.user.id]));
  expect(
    await adminDb().$count(
      categories,
      and(eq(categories.userId, b.user.id), isNotNull(categories.retiredAt)),
    ),
  ).toBe(0);
});

const request = (url: string, body: unknown, headers: Record<string, string> = {}) =>
  new Request(url, {
    method: "POST",
    headers: { host: "localhost", "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });

const post = (transactionId: string, body: unknown, headers: Record<string, string> = {}) =>
  categoryRoute(
    request(`http://localhost/api/transactions/${transactionId}/category`, body, headers),
    { params: Promise.resolve({ transactionId }) },
  );

const postCreate = (body: unknown, headers: Record<string, string> = {}) =>
  createRoute(request("http://localhost/api/categories", body, headers));

const postEdit = (categoryId: string, body: unknown, headers: Record<string, string> = {}) =>
  editRoute(request(`http://localhost/api/categories/${categoryId}`, body, headers), {
    params: Promise.resolve({ categoryId }),
  });

const bytes = async (response: Response) => ({
  status: response.status,
  body: await response.text(),
});

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

const rootNamed = (tree: Awaited<ReturnType<typeof listCategoryTree>>, name: string) => {
  const root = tree.find((node) => node.name === name);
  if (!root) throw new Error(`no default group named ${name}`);
  return root;
};

test("create appends a group and then its leaves, last among their siblings, through the boundary", async () => {
  const clerkUserId = fakeClerkUserId();
  await provision(clerkUserId);

  const group = await withAuth(clerkUserId, () => postCreate({ name: "  Pets  ", parentId: null }));
  expect(group.status).toBe(201);
  const { categoryId: petsId } = await group.json();
  const leaf = await withAuth(clerkUserId, () => postCreate({ name: "Vet", parentId: petsId }));
  expect(leaf.status).toBe(201);
  const { categoryId: vetId } = await leaf.json();

  const tree = await withAuth(clerkUserId, () => listCategoryTree());
  expect(tree).toHaveLength(DEFAULT_CATEGORIES.length + 1);
  expect(tree.at(-1)).toEqual({
    id: petsId,
    name: "Pets",
    retiredAt: null,
    categories: [{ id: vetId, name: "Vet", retiredAt: null }],
  });
  expect(await withAuth(clerkUserId, () => listCategoryGroups())).toEqual([
    ...DEFAULT_TREE,
    { id: petsId, name: "Pets", categories: [{ id: vetId, name: "Vet" }] },
  ]);

  expect((await withAuth(clerkUserId, () => postCreate({ name: "Groomer", parentId: petsId }))).status).toBe(201);
  const again = await withAuth(clerkUserId, () => listCategoryTree());
  expect(again.at(-1)!.categories.map((category) => category.name)).toEqual(["Vet", "Groomer"]);
});

test("create refuses a name already used at that level, retired or not, and allows it elsewhere", async () => {
  const clerkUserId = fakeClerkUserId();
  const { user } = await provision(clerkUserId);
  const tree = await withAuth(clerkUserId, () => listCategoryTree());
  const food = rootNamed(tree, "Food & Drink");
  const groceries = food.categories.find((category) => category.name === "Groceries")!;
  const taken = { status: 409, body: '{"error":"name_taken"}' };

  expect(await bytes(await withAuth(clerkUserId, () => postCreate({ name: "Food & Drink", parentId: null })))).toEqual(taken);
  expect(await bytes(await withAuth(clerkUserId, () => postCreate({ name: "Groceries", parentId: food.id })))).toEqual(taken);

  expect(
    (await withAuth(clerkUserId, () => postEdit(groceries.id, { name: "Groceries", parentId: food.id, retired: true }))).status,
  ).toBe(200);
  expect(await bytes(await withAuth(clerkUserId, () => postCreate({ name: "Groceries", parentId: food.id })))).toEqual(taken);

  const elsewhere = await withAuth(clerkUserId, () =>
    postCreate({ name: "Groceries", parentId: rootNamed(tree, "Entertainment").id }),
  );
  expect(elsewhere.status).toBe(201);
  expect(await adminDb().$count(categories, eq(categories.userId, user.id))).toBe(TREE_SIZE + 1);
});

test("create rejects bad callers and bodies, and a leaf, unknown, malformed, or foreign parent is one 404", async () => {
  const clerkA = fakeClerkUserId();
  const clerkB = fakeClerkUserId();
  const a = await provision(clerkA);
  const b = await provision(clerkB);
  const treeA = await withAuth(clerkA, () => listCategoryTree());
  const treeB = await withAuth(clerkB, () => listCategoryTree());
  const pets = { name: "Pets", parentId: null };

  expect(await bytes(await postCreate(pets))).toEqual({ status: 401, body: '{"error":"unauthorized"}' });
  expect(await bytes(await withAuth(clerkA, () => postCreate(pets, { origin: "https://evil.example" })))).toEqual({
    status: 403,
    body: '{"error":"cross_origin"}',
  });
  for (const body of [
    {},
    { name: "Pets" },
    { name: "", parentId: null },
    { name: "x".repeat(61), parentId: null },
    { name: "Pets", parentId: 5 },
    { name: "Pets", parentId: null, retired: false },
    [],
    null,
    "Pets",
  ]) {
    expect(await bytes(await withAuth(clerkA, () => postCreate(body)))).toEqual({
      status: 400,
      body: '{"error":"invalid_request"}',
    });
  }

  const notFound = { status: 404, body: '{"error":"parent_not_found"}' };
  for (const parentId of [
    rootNamed(treeA, "Food & Drink").categories[0].id,
    "00000000-0000-4000-8000-00000000dead",
    "not-a-uuid",
    treeB[0].id,
  ]) {
    expect(await bytes(await withAuth(clerkA, () => postCreate({ name: "Pets", parentId })))).toEqual(notFound);
  }
  expect(await adminDb().$count(categories, eq(categories.userId, a.user.id))).toBe(TREE_SIZE);
  expect(await adminDb().$count(categories, eq(categories.userId, b.user.id))).toBe(TREE_SIZE);
});

const demoCategory = (name: string, kind: "group" | "leaf") =>
  SEED_CATEGORIES.find(
    (c) => c.persona === "demo" && c.name === name && (c.parentId === null) === (kind === "group"),
  )!.id;

const demoSpendingUsd = async () => {
  const summary = await withAuth(SEED_USERS.demo.clerkUserId, () =>
    spendingByCategory({ ok: true, query: { from: null, to: null, currency: null } }),
  );
  return summary.currencies.find((section) => section.currency === "USD")!.groups;
};

const EXPECTED_USD_GROUPS = EXPECTED.demo.spending.find((section) => section.currency === "USD")!.groups;

test("rename is a pointer edit: history rows and spending follow the new names with the same numbers", async () => {
  await seedDataset(adminDb());
  const clerkUserId = SEED_USERS.demo.clerkUserId;
  await withAuth(clerkUserId, () => matchTransfers());
  const food = demoCategory("Food & Drink", "group");
  const restaurants = demoCategory("Restaurants & Bars", "leaf");

  const leaf = await withAuth(clerkUserId, () =>
    postEdit(restaurants, { name: " Eating Out ", parentId: food, retired: false }),
  );
  expect(leaf.status).toBe(200);
  expect(await leaf.json()).toEqual({ categoryId: restaurants });
  expect(
    (await withAuth(clerkUserId, () => postEdit(food, { name: "Food", parentId: null, retired: false }))).status,
  ).toBe(200);

  const renamed = (name: string) =>
    ({ "Restaurants & Bars": "Eating Out", "Food & Drink": "Food" })[name] ?? name;
  expect(await demoSpendingUsd()).toEqual(
    EXPECTED_USD_GROUPS.map((group) => ({
      ...group,
      name: renamed(group.name),
      categories: group.categories.map((category) => ({ ...category, name: renamed(category.name) })),
    })),
  );

  const noodleHouse = SEED_TRANSACTIONS.find((t) => t.description === "NOODLE HOUSE")!.id;
  const history = await withAuth(clerkUserId, () => transactionHistory(parseHistoryQuery({ q: "noodle" })));
  expect(history.rows.map((row) => [row.id, row.categoryId, row.categoryName])).toEqual([
    [noodleHouse, restaurants, "Eating Out"],
  ]);

  expect(
    (await withAuth(clerkUserId, () => postEdit(restaurants, { name: "Eating Out", parentId: food, retired: false }))).status,
  ).toBe(200);
  const groceries = demoCategory("Groceries", "leaf");
  expect(
    await bytes(await withAuth(clerkUserId, () => postEdit(groceries, { name: "Eating Out", parentId: food, retired: false }))),
  ).toEqual({ status: 409, body: '{"error":"name_taken"}' });
  const tree = await withAuth(clerkUserId, () => listCategoryTree());
  expect(tree.find((node) => node.id === food)!.categories.find((c) => c.id === groceries)!.name).toBe("Groceries");
});

test("move relocates a leaf's totals between groups, nests a childless root, and promotes a leaf", async () => {
  await seedDataset(adminDb());
  const clerkUserId = SEED_USERS.demo.clerkUserId;
  await withAuth(clerkUserId, () => matchTransfers());
  const food = demoCategory("Food & Drink", "group");
  const entertainment = demoCategory("Entertainment", "group");
  const restaurants = demoCategory("Restaurants & Bars", "leaf");
  const groceries = demoCategory("Groceries", "leaf");

  const moved = await withAuth(clerkUserId, () =>
    postEdit(restaurants, { name: "Restaurants & Bars", parentId: entertainment, retired: false }),
  );
  expect(moved.status).toBe(200);

  const foodBefore = EXPECTED_USD_GROUPS.find((group) => group.id === food)!;
  const entertainmentBefore = EXPECTED_USD_GROUPS.find((group) => group.id === entertainment)!;
  const leaf = foodBefore.categories.find((category) => category.id === restaurants)!;
  const shifted = (group: typeof foodBefore, sign: 1 | -1) => ({
    spentMinor: group.spentMinor + sign * leaf.spentMinor,
    receivedMinor: group.receivedMinor + sign * leaf.receivedMinor,
    netMinor: group.netMinor + sign * leaf.netMinor,
  });
  const entertainmentAfter = {
    ...entertainmentBefore,
    ...shifted(entertainmentBefore, 1),
    categories: [...entertainmentBefore.categories, leaf],
  };
  const others = EXPECTED_USD_GROUPS.filter((group) => group.id !== food && group.id !== entertainment);
  expect(await demoSpendingUsd()).toEqual([
    entertainmentAfter,
    {
      ...foodBefore,
      ...shifted(foodBefore, -1),
      categories: foodBefore.categories.filter((category) => category.id !== restaurants),
    },
    ...others,
  ]);

  const pets = await withAuth(clerkUserId, () => createCategory({ name: "Pets", parentId: null }));
  if ("error" in pets) throw new Error(pets.error);
  expect(
    await withAuth(clerkUserId, () => updateCategory(pets.categoryId, { name: "Pets", parentId: food, retired: false })),
  ).toEqual({ categoryId: pets.categoryId });
  expect(
    await withAuth(clerkUserId, () => updateCategory(groceries, { name: "Groceries", parentId: null, retired: false })),
  ).toEqual({ categoryId: groceries });

  const tree = await withAuth(clerkUserId, () => listCategoryTree());
  expect(tree.some((node) => node.id === pets.categoryId)).toBe(false);
  expect(tree.find((node) => node.id === food)!.categories.map((c) => c.id)).toContain(pets.categoryId);
  expect(tree.find((node) => node.id === food)!.categories.map((c) => c.id)).not.toContain(groceries);
  expect(tree.find((node) => node.id === groceries)).toEqual({
    id: groceries,
    name: "Groceries",
    retiredAt: null,
    categories: [],
  });

  const groceriesLeaf = foodBefore.categories.find((category) => category.id === groceries)!;
  expect(await demoSpendingUsd()).toEqual([
    entertainmentAfter,
    { ...groceriesLeaf, categories: [] },
    ...others,
  ]);
});

test("move refuses a group with leaves, any parent that is not an own group, and a name collision, changing nothing", async () => {
  const clerkA = fakeClerkUserId();
  const clerkB = fakeClerkUserId();
  await provision(clerkA);
  await provision(clerkB);
  const treeA = await withAuth(clerkA, () => listCategoryTree());
  const treeB = await withAuth(clerkB, () => listCategoryTree());
  const food = rootNamed(treeA, "Food & Drink");
  const entertainment = rootNamed(treeA, "Entertainment");
  const groceries = food.categories.find((category) => category.name === "Groceries")!;

  expect(
    await bytes(
      await withAuth(clerkA, () =>
        postEdit(food.id, { name: "Food & Drink", parentId: entertainment.id, retired: false }),
      ),
    ),
  ).toEqual({ status: 409, body: '{"error":"has_children"}' });

  const notFound = { status: 404, body: '{"error":"parent_not_found"}' };
  for (const parentId of [
    food.categories[1].id,
    groceries.id,
    "00000000-0000-4000-8000-00000000dead",
    "not-a-uuid",
    treeB[0].id,
  ]) {
    expect(
      await bytes(
        await withAuth(clerkA, () => postEdit(groceries.id, { name: "Groceries", parentId, retired: false })),
      ),
    ).toEqual(notFound);
  }

  const pets = await withAuth(clerkA, () => createCategory({ name: "Pets", parentId: null }));
  if ("error" in pets) throw new Error(pets.error);
  expect(
    await bytes(
      await withAuth(clerkA, () =>
        postEdit(pets.categoryId, { name: "Pets", parentId: pets.categoryId, retired: false }),
      ),
    ),
  ).toEqual(notFound);

  const clash = await withAuth(clerkA, () => createCategory({ name: "Groceries", parentId: entertainment.id }));
  if ("error" in clash) throw new Error(clash.error);
  expect(
    await bytes(
      await withAuth(clerkA, () =>
        postEdit(clash.categoryId, { name: "Groceries", parentId: food.id, retired: false }),
      ),
    ),
  ).toEqual({ status: 409, body: '{"error":"name_taken"}' });

  const after = await withAuth(clerkA, () => listCategoryTree());
  const except = (tree: typeof treeA, id: string) => tree.filter((node) => node.id !== id);
  expect(except(after, entertainment.id)).toEqual([
    ...except(treeA, entertainment.id),
    { id: pets.categoryId, name: "Pets", retiredAt: null, categories: [] },
  ]);
  expect(after.find((node) => node.id === entertainment.id)!.categories).toEqual([
    ...entertainment.categories,
    { id: clash.categoryId, name: "Groceries", retiredAt: null },
  ]);
  expect(await withAuth(clerkB, () => listCategoryTree())).toEqual(treeB);
});

test("retire and restore are stored on the row idempotently, and edited defaults are never re-planted", async () => {
  const clerkUserId = fakeClerkUserId();
  const { user } = await provision(clerkUserId);
  const food = rootNamed(await withAuth(clerkUserId, () => listCategoryTree()), "Food & Drink");
  const coffee = food.categories.find((category) => category.name === "Coffee Shops")!;
  const coffeeNow = async () =>
    rootNamed(await withAuth(clerkUserId, () => listCategoryTree()), "Food & Drink").categories.find(
      (category) => category.id === coffee.id,
    );
  const edit = (retired: boolean) =>
    withAuth(clerkUserId, () => updateCategory(coffee.id, { name: "Cafés", parentId: food.id, retired }));

  expect(await edit(true)).toEqual({ categoryId: coffee.id });
  const retired = await coffeeNow();
  expect(retired).toEqual({ id: coffee.id, name: "Cafés", retiredAt: expect.any(Date) });
  expect(await edit(true)).toEqual({ categoryId: coffee.id });
  expect(await coffeeNow()).toEqual(retired);
  expect(await edit(false)).toEqual({ categoryId: coffee.id });
  expect(await coffeeNow()).toEqual({ id: coffee.id, name: "Cafés", retiredAt: null });

  expect(
    await withAuth(clerkUserId, () =>
      updateCategory(food.id, { name: "Food & Drink", parentId: null, retired: true }),
    ),
  ).toEqual({ categoryId: food.id });
  const group = rootNamed(await withAuth(clerkUserId, () => listCategoryTree()), "Food & Drink");
  expect(group.retiredAt).toEqual(expect.any(Date));
  expect(group.categories.map((category) => category.retiredAt)).toEqual(food.categories.map(() => null));

  const groups = await withAuth(clerkUserId, () => listCategoryGroups());
  expect(groups.flatMap((g) => g.categories.map((c) => c.name))).not.toContain("Coffee Shops");
  expect(await adminDb().$count(categories, eq(categories.userId, user.id))).toBe(TREE_SIZE);
});

test("edit rejects bad callers and bodies, and a foreign, unknown, or malformed category id is one 404 that changes nothing", async () => {
  const clerkA = fakeClerkUserId();
  const clerkB = fakeClerkUserId();
  await provision(clerkA);
  await provision(clerkB);
  const treeA = await withAuth(clerkA, () => listCategoryTree());
  const treeB = await withAuth(clerkB, () => listCategoryTree());
  const food = rootNamed(treeA, "Food & Drink");
  const groceries = food.categories.find((category) => category.name === "Groceries")!;
  const edit = { name: "Groceries", parentId: food.id, retired: false };

  expect(await bytes(await postEdit(groceries.id, edit))).toEqual({ status: 401, body: '{"error":"unauthorized"}' });
  expect(
    await bytes(await withAuth(clerkA, () => postEdit(groceries.id, edit, { origin: "https://evil.example" }))),
  ).toEqual({ status: 403, body: '{"error":"cross_origin"}' });
  const badBody = { status: 400, body: '{"error":"invalid_request"}' };
  for (const body of [
    {},
    { name: "Groceries", parentId: food.id },
    { ...edit, retired: "true" },
    { ...edit, extra: 1 },
    { ...edit, name: "   " },
    null,
    [],
  ]) {
    expect(await bytes(await withAuth(clerkA, () => postEdit(groceries.id, body)))).toEqual(badBody);
  }
  expect(await bytes(await withAuth(clerkA, () => postEdit("not-a-uuid", {})))).toEqual(badBody);

  const notFound = { status: 404, body: '{"error":"category_not_found"}' };
  const hijack = { name: "Hacked", parentId: null, retired: true };
  for (const categoryId of [groceries.id, food.id, "00000000-0000-4000-8000-00000000dead", "not-a-uuid"]) {
    expect(await bytes(await withAuth(clerkB, () => postEdit(categoryId, hijack)))).toEqual(notFound);
  }
  expect(
    await bytes(await withAuth(clerkA, () => postEdit("not-a-uuid", { name: "x", parentId: "also-bad", retired: false }))),
  ).toEqual(notFound);
  expect(await bytes(await withAuth(clerkB, () => postCreate({ name: "Sneaky", parentId: food.id })))).toEqual({
    status: 404,
    body: '{"error":"parent_not_found"}',
  });

  expect(await withAuth(clerkA, () => listCategoryTree())).toEqual(treeA);
  expect(await withAuth(clerkB, () => listCategoryTree())).toEqual(treeB);
});
