import { eq } from "drizzle-orm";
import { expect, test } from "vitest";

import { POST as deleteRoute } from "@/app/api/transactions/[transactionId]/manual/delete/route";
import { POST as updateRoute } from "@/app/api/transactions/[transactionId]/manual/route";
import { POST as createRoute } from "@/app/api/transactions/manual/route";
import { requireUser } from "@/lib/data/users";
import { accountBalances, accounts, categories, transactions } from "@/lib/db/schema";
import { fakeClerkUserId, withAuth } from "../harness/clerk";
import { adminDb } from "../harness/db";

const manualInput = (accountId: string, categoryId: string | null = null) => ({
  accountId,
  direction: "outflow",
  amount: "12.34",
  date: "2026-09-11",
  description: "  Cash lunch  ",
  merchant: "   ",
  categoryId,
});

const postCreate = (body: unknown) =>
  createRoute(
    new Request("http://localhost/api/transactions/manual", {
      method: "POST",
      headers: { host: "localhost", "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );

const postUpdate = (transactionId: string, body: unknown) =>
  updateRoute(
    new Request(`http://localhost/api/transactions/${transactionId}/manual`, {
      method: "POST",
      headers: { host: "localhost", "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ transactionId }) },
  );

const postDelete = (transactionId: string, body: unknown = {}) =>
  deleteRoute(
    new Request(`http://localhost/api/transactions/${transactionId}/manual/delete`, {
      method: "POST",
      headers: { host: "localhost", "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ transactionId }) },
  );

test("create writes one canonical posted manual row without changing its account balance", async () => {
  const clerkUserId = fakeClerkUserId();
  const user = await withAuth(clerkUserId, () => requireUser());
  const [account] = await adminDb()
    .insert(accounts)
    .values({
      userId: user.id,
      name: "Cash-backed checking",
      type: "depository",
      currency: "USD",
      source: "plaid",
    })
    .returning({ id: accounts.id });
  await adminDb().insert(accountBalances).values({
    accountId: account.id,
    userId: user.id,
    currentMinor: 54321,
    asOf: new Date("2026-09-11T12:00:00Z"),
  });
  const [group] = await adminDb()
    .insert(categories)
    .values({ userId: user.id, name: "Food", sortOrder: 0 })
    .returning({ id: categories.id });
  const [leaf] = await adminDb()
    .insert(categories)
    .values({ userId: user.id, parentId: group.id, name: "Dining", sortOrder: 0 })
    .returning({ id: categories.id });
  const [balanceBefore] = await adminDb()
    .select()
    .from(accountBalances)
    .where(eq(accountBalances.accountId, account.id));

  const response = await withAuth(clerkUserId, () => postCreate(manualInput(account.id, leaf.id)));
  expect(response.status).toBe(201);
  const body = await response.json();
  expect(body).toEqual({ transactionId: expect.any(String) });

  const [row] = await adminDb()
    .select()
    .from(transactions)
    .where(eq(transactions.id, body.transactionId));
  expect(row).toMatchObject({
    userId: user.id,
    accountId: account.id,
    categoryId: leaf.id,
    categorySource: "user",
    categoryConfidence: null,
    categoryReason: null,
    categoryRunId: null,
    categoryRevision: 0,
    amountMinor: -1234,
    currency: "USD",
    date: "2026-09-11",
    description: "Cash lunch",
    merchant: null,
    status: "posted",
    source: "manual",
    sourceId: null,
  });
  const [balanceAfter] = await adminDb()
    .select()
    .from(accountBalances)
    .where(eq(accountBalances.accountId, account.id));
  expect(balanceAfter).toEqual(balanceBefore);
});

test("edit atomically replaces denomination and fields without changing balances", async () => {
  const clerkUserId = fakeClerkUserId();
  const user = await withAuth(clerkUserId, () => requireUser());
  const [usdAccount, jpyAccount] = await adminDb()
    .insert(accounts)
    .values([
      {
        userId: user.id,
        name: "USD checking",
        type: "depository",
        currency: "USD",
        source: "plaid",
      },
      {
        userId: user.id,
        name: "JPY cash",
        type: "depository",
        currency: "JPY",
        source: "manual",
      },
    ])
    .returning({ id: accounts.id });
  await adminDb().insert(accountBalances).values([
    {
      accountId: usdAccount.id,
      userId: user.id,
      currentMinor: 50000,
      asOf: new Date("2026-09-11T12:00:00Z"),
    },
    {
      accountId: jpyAccount.id,
      userId: user.id,
      currentMinor: 70000,
      asOf: new Date("2026-09-11T12:00:00Z"),
    },
  ]);
  const [group] = await adminDb()
    .insert(categories)
    .values({ userId: user.id, name: "Food", sortOrder: 0 })
    .returning({ id: categories.id });
  const [leaf] = await adminDb()
    .insert(categories)
    .values({ userId: user.id, parentId: group.id, name: "Dining", sortOrder: 0 })
    .returning({ id: categories.id });
  const [transaction] = await adminDb()
    .insert(transactions)
    .values({
      userId: user.id,
      accountId: usdAccount.id,
      categoryId: leaf.id,
      categorySource: "user",
      amountMinor: -1234,
      currency: "USD",
      date: "2026-09-10",
      description: "Old lunch",
      merchant: "Old merchant",
      status: "posted",
      source: "manual",
      sourceId: null,
    })
    .returning({ id: transactions.id });
  const balancesBefore = await adminDb()
    .select()
    .from(accountBalances)
    .orderBy(accountBalances.accountId);

  const response = await withAuth(clerkUserId, () =>
    postUpdate(transaction.id, {
      ...manualInput(jpyAccount.id),
      direction: "inflow",
      amount: "1250",
      date: "2026-09-12",
      description: "  Cash correction  ",
      merchant: "  Counterparty  ",
    }),
  );
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ transactionId: transaction.id });

  const [row] = await adminDb()
    .select()
    .from(transactions)
    .where(eq(transactions.id, transaction.id));
  expect(row).toMatchObject({
    accountId: jpyAccount.id,
    categoryId: null,
    categorySource: null,
    categoryConfidence: null,
    categoryReason: null,
    categoryRunId: null,
    categoryRevision: 1,
    amountMinor: 1250,
    currency: "JPY",
    date: "2026-09-12",
    description: "Cash correction",
    merchant: "Counterparty",
    status: "posted",
    source: "manual",
    sourceId: null,
  });
  expect(await adminDb().select().from(accountBalances).orderBy(accountBalances.accountId)).toEqual(
    balancesBefore,
  );
});

test("delete removes only manual targets and repeats as the same not-found result", async () => {
  const clerkUserId = fakeClerkUserId();
  const user = await withAuth(clerkUserId, () => requireUser());
  const [account] = await adminDb()
    .insert(accounts)
    .values({
      userId: user.id,
      name: "Checking",
      type: "depository",
      currency: "USD",
      source: "plaid",
    })
    .returning({ id: accounts.id });
  const inserted = await adminDb()
    .insert(transactions)
    .values([
      {
        userId: user.id,
        accountId: account.id,
        amountMinor: -500,
        currency: "USD",
        date: "2026-09-11",
        description: "Cash",
        status: "posted",
        source: "manual",
      },
      {
        userId: user.id,
        accountId: account.id,
        amountMinor: -900,
        currency: "USD",
        date: "2026-09-11",
        description: "Provider",
        status: "posted",
        source: "plaid",
        sourceId: "provider-row",
      },
    ])
    .returning({ id: transactions.id, source: transactions.source });
  const manual = inserted.find((row) => row.source === "manual")!;
  const provider = inserted.find((row) => row.source === "plaid")!;

  const deleted = await withAuth(clerkUserId, () => postDelete(manual.id));
  expect(deleted.status).toBe(200);
  expect(await deleted.json()).toEqual({ transactionId: manual.id });
  expect(
    await adminDb().select({ id: transactions.id }).from(transactions).where(eq(transactions.id, manual.id)),
  ).toEqual([]);

  for (const transactionId of [manual.id, provider.id]) {
    const missing = await withAuth(clerkUserId, () => postDelete(transactionId));
    expect(missing.status).toBe(404);
    expect(await missing.text()).toBe('{"error":"transaction_not_found"}');
  }
  expect(
    await adminDb()
      .select({ id: transactions.id })
      .from(transactions)
      .where(eq(transactions.id, provider.id)),
  ).toEqual([{ id: provider.id }]);
});
