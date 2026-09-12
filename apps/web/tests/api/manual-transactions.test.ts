import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { expect, test, vi } from "vitest";

import { POST as deleteRoute } from "@/app/api/transactions/[transactionId]/manual/delete/route";
import { POST as updateRoute } from "@/app/api/transactions/[transactionId]/manual/route";
import { POST as createRoute } from "@/app/api/transactions/manual/route";
import { requireUser } from "@/lib/data/users";
import { matchTransfers } from "@/lib/data/transfers";
import {
  accountBalances,
  accounts,
  categories,
  classificationRuns,
  transactions,
  transferPairs,
} from "@/lib/db/schema";
import { fakeClerkUserId, withAuth } from "../harness/clerk";
import { adminDb, appQuery, appQueryScopedAs } from "../harness/db";

const manualInput = (accountId: string, categoryId: string | null = null) => ({
  accountId,
  direction: "outflow",
  amount: "12.34",
  date: "2026-09-11",
  description: "  Cash lunch  ",
  merchant: "   ",
  categoryId,
});

type RequestBody = BodyInit | null;

const request = (url: string, body: RequestBody, origin?: string) =>
  new Request(url, {
    method: "POST",
    headers: {
      host: "localhost",
      "content-type": "application/json",
      ...(origin ? { origin } : {}),
    },
    body,
    duplex: "half",
  } as RequestInit);

const postCreateRaw = (body: RequestBody, origin?: string) =>
  createRoute(request("http://localhost/api/transactions/manual", body, origin));

const postUpdateRaw = (transactionId: string, body: RequestBody, origin?: string) =>
  updateRoute(
    request(`http://localhost/api/transactions/${transactionId}/manual`, body, origin),
    { params: Promise.resolve({ transactionId }) },
  );

const postDeleteRaw = (transactionId: string, body: RequestBody, origin?: string) =>
  deleteRoute(
    request(
      `http://localhost/api/transactions/${transactionId}/manual/delete`,
      body,
      origin,
    ),
    { params: Promise.resolve({ transactionId }) },
  );

const postCreate = (body: unknown) => postCreateRaw(JSON.stringify(body));
const postUpdate = (transactionId: string, body: unknown) =>
  postUpdateRaw(transactionId, JSON.stringify(body));
const postDelete = (transactionId: string, body: unknown = {}) =>
  postDeleteRaw(transactionId, JSON.stringify(body));

const responseBytes = async (response: Response) => ({
  status: response.status,
  contentType: response.headers.get("content-type"),
  body: await response.text(),
});

async function authorityFixture() {
  const ownerClerkUserId = fakeClerkUserId();
  const neighborClerkUserId = fakeClerkUserId();
  const [owner, neighbor] = await Promise.all([
    withAuth(ownerClerkUserId, () => requireUser()),
    withAuth(neighborClerkUserId, () => requireUser()),
  ]);
  const [ownerAccount, neighborAccount] = await adminDb()
    .insert(accounts)
    .values([
      {
        userId: owner.id,
        name: "Owner cash",
        type: "depository",
        currency: "USD",
        source: "manual",
      },
      {
        userId: neighbor.id,
        name: "Neighbor cash",
        type: "depository",
        currency: "USD",
        source: "manual",
      },
    ])
    .returning({ id: accounts.id, userId: accounts.userId });
  const [ownerGroup, neighborGroup] = await adminDb()
    .insert(categories)
    .values([
      { userId: owner.id, name: "Owner group", sortOrder: 0 },
      { userId: neighbor.id, name: "Neighbor group", sortOrder: 0 },
    ])
    .returning({ id: categories.id, userId: categories.userId });
  const [ownerLeaf, neighborLeaf] = await adminDb()
    .insert(categories)
    .values([
      {
        userId: owner.id,
        parentId: ownerGroup.id,
        name: "Owner leaf",
        sortOrder: 0,
      },
      {
        userId: neighbor.id,
        parentId: neighborGroup.id,
        name: "Neighbor leaf",
        sortOrder: 0,
      },
    ])
    .returning({ id: categories.id, userId: categories.userId });
  const inserted = await adminDb()
    .insert(transactions)
    .values([
      {
        userId: owner.id,
        accountId: ownerAccount.id,
        amountMinor: -100,
        currency: "USD",
        date: "2026-09-11",
        description: "Owner manual",
        status: "posted",
        source: "manual",
      },
      {
        userId: owner.id,
        accountId: ownerAccount.id,
        amountMinor: -200,
        currency: "USD",
        date: "2026-09-11",
        description: "Owner Plaid",
        status: "posted",
        source: "plaid",
        sourceId: "owner-plaid",
      },
      {
        userId: owner.id,
        accountId: ownerAccount.id,
        amountMinor: -300,
        currency: "USD",
        date: "2026-09-11",
        description: "Owner import",
        status: "posted",
        source: "import",
        sourceId: "owner-import",
      },
      {
        userId: neighbor.id,
        accountId: neighborAccount.id,
        amountMinor: -400,
        currency: "USD",
        date: "2026-09-11",
        description: "Neighbor manual",
        status: "posted",
        source: "manual",
      },
    ])
    .returning({ id: transactions.id, userId: transactions.userId, source: transactions.source });
  const transaction = (userId: string, source: "manual" | "plaid" | "import") =>
    inserted.find((row) => row.userId === userId && row.source === source)!.id;

  return {
    ownerClerkUserId,
    neighborClerkUserId,
    owner,
    neighbor,
    ownerAccount: ownerAccount.id,
    neighborAccount: neighborAccount.id,
    ownerGroup: ownerGroup.id,
    ownerLeaf: ownerLeaf.id,
    neighborLeaf: neighborLeaf.id,
    ownerManual: transaction(owner.id, "manual"),
    ownerPlaid: transaction(owner.id, "plaid"),
    ownerImport: transaction(owner.id, "import"),
    neighborManual: transaction(neighbor.id, "manual"),
  };
}

async function addInitialClassificationRun(userId: string) {
  const [run] = await adminDb()
    .insert(classificationRuns)
    .values({
      ownerUserId: userId,
      kind: "automatic_initial",
      status: "succeeded",
      requestedModel: "test/model",
      promptVersion: "test-prompt",
      assignmentSchemaVersion: "test-schema",
      taxonomyFingerprint: "a".repeat(64),
      providerPolicyFingerprint: "b".repeat(64),
      batchSize: 1,
      attempted: 1,
      applied: 1,
      inferenceLeaseUntil: new Date("2026-09-11T00:00:00Z"),
    })
    .returning({ id: classificationRuns.id });
  return run.id;
}

type TransferFixtureRow = {
  account: number;
  amountMinor: number;
  date: string;
};

async function transferFixture(rows: TransferFixtureRow[]) {
  const clerkUserId = fakeClerkUserId();
  const user = await withAuth(clerkUserId, () => requireUser());
  const accountIds = Array.from(
    { length: Math.max(...rows.map((row) => row.account)) + 1 },
    () => randomUUID(),
  );
  await adminDb().insert(accounts).values(
    accountIds.map((id, index) => ({
      id,
      userId: user.id,
      name: `Transfer account ${index}`,
      type: "depository" as const,
      currency: "USD",
      source: "manual" as const,
    })),
  );
  const ids = rows.map(() => randomUUID());
  await adminDb().insert(transactions).values(
    rows.map((row, index) => ({
      id: ids[index],
      userId: user.id,
      accountId: accountIds[row.account],
      amountMinor: row.amountMinor,
      currency: "USD",
      date: row.date,
      description: `Transfer row ${index}`,
      status: "posted" as const,
      source: "manual" as const,
    })),
  );
  return { clerkUserId, user, accountIds, ids };
}

const transferPairsFor = (userId: string) =>
  adminDb()
    .select({
      id: transferPairs.id,
      outflowId: transferPairs.outflowTransactionId,
      inflowId: transferPairs.inflowTransactionId,
      dismissedAt: transferPairs.dismissedAt,
    })
    .from(transferPairs)
    .where(eq(transferPairs.userId, userId));

async function updatePrivilegeColumns(table: string) {
  const result = await appQuery(
    `select column_name
     from information_schema.column_privileges
     where grantee = current_user
       and table_schema = 'public'
       and table_name = $1
       and privilege_type = 'UPDATE'
     order by column_name`,
    [table],
  );
  return result.rows.map((row) => row.column_name as string);
}

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

test("closed request bodies reject malformed shape and typed resource IDs before mutation", async () => {
  const data = await authorityFixture();
  const before = await adminDb().$count(transactions, eq(transactions.userId, data.owner.id));
  const valid = manualInput(data.ownerAccount, data.ownerLeaf);
  const missingKey: Record<string, unknown> = { ...valid };
  delete missingKey.categoryId;
  const cases: Array<() => Promise<Response>> = [
    () => postCreateRaw("{"),
    () => postCreate(null),
    () => postCreate([]),
    () => postCreate({ ...valid, currency: "EUR" }),
    () => postCreate(missingKey),
    () => postCreate({ ...valid, accountId: 7 }),
    () => postCreate({ ...valid, categoryId: 7 }),
  ];

  for (const call of cases) {
    await expect(withAuth(data.ownerClerkUserId, call).then(responseBytes)).resolves.toEqual({
      status: 400,
      contentType: "application/json",
      body: '{"error":"invalid_request"}',
    });
  }
  await expect(
    adminDb().$count(transactions, eq(transactions.userId, data.owner.id)),
  ).resolves.toBe(before);
});

test("create resolves account, amount, then category", async () => {
  const data = await authorityFixture();
  const input = manualInput("not-a-uuid", data.neighborLeaf);
  const cases = [
    {
      input: { ...input, amount: "0" },
      want: { status: 404, body: '{"error":"account_not_found"}' },
    },
    {
      input: { ...input, accountId: data.ownerAccount, amount: "0" },
      want: { status: 400, body: '{"error":"invalid_request"}' },
    },
    {
      input: { ...input, accountId: data.ownerAccount },
      want: { status: 404, body: '{"error":"category_not_found"}' },
    },
    {
      input: { ...input, accountId: data.ownerAccount, categoryId: data.ownerGroup },
      want: { status: 422, body: '{"error":"category_not_assignable"}' },
    },
  ];

  for (const { input: body, want } of cases) {
    const response = await withAuth(data.ownerClerkUserId, () => postCreate(body));
    expect(await responseBytes(response)).toEqual({
      ...want,
      contentType: "application/json",
    });
  }
});

test("edit resolves its manual target, destination account, amount, then category", async () => {
  const data = await authorityFixture();
  const input = manualInput("not-a-uuid", data.neighborLeaf);
  const cases = [
    {
      transactionId: randomUUID(),
      input: { ...input, amount: "0" },
      want: { status: 404, body: '{"error":"transaction_not_found"}' },
    },
    {
      transactionId: data.ownerManual,
      input: { ...input, amount: "0" },
      want: { status: 404, body: '{"error":"account_not_found"}' },
    },
    {
      transactionId: data.ownerManual,
      input: { ...input, accountId: data.ownerAccount, amount: "0" },
      want: { status: 400, body: '{"error":"invalid_request"}' },
    },
    {
      transactionId: data.ownerManual,
      input: { ...input, accountId: data.ownerAccount },
      want: { status: 404, body: '{"error":"category_not_found"}' },
    },
    {
      transactionId: data.ownerManual,
      input: { ...input, accountId: data.ownerAccount, categoryId: data.ownerGroup },
      want: { status: 422, body: '{"error":"category_not_assignable"}' },
    },
  ];

  for (const { transactionId, input: body, want } of cases) {
    const response = await withAuth(data.ownerClerkUserId, () =>
      postUpdate(transactionId, body),
    );
    expect(await responseBytes(response)).toEqual({
      ...want,
      contentType: "application/json",
    });
  }
});

test("delete validates an exact empty object before resolving its target", async () => {
  const data = await authorityFixture();
  await expect(
    withAuth(data.ownerClerkUserId, () =>
      postDelete(randomUUID(), { confirmed: true }),
    ).then(responseBytes),
  ).resolves.toEqual({
    status: 400,
    contentType: "application/json",
    body: '{"error":"invalid_request"}',
  });
  await expect(
    withAuth(data.ownerClerkUserId, () => postDelete(randomUUID())).then(
      responseBytes,
    ),
  ).resolves.toEqual({
    status: 404,
    contentType: "application/json",
    body: '{"error":"transaction_not_found"}',
  });
});

test("edit and delete conceal malformed, missing, foreign, and provider targets identically", async () => {
  const data = await authorityFixture();
  const before = await adminDb()
    .select()
    .from(transactions)
    .orderBy(transactions.id);
  const concealed = [
    "not-a-uuid",
    randomUUID(),
    data.neighborManual,
    data.ownerPlaid,
    data.ownerImport,
  ];
  const expected = {
    status: 404,
    contentType: "application/json",
    body: '{"error":"transaction_not_found"}',
  };

  for (const transactionId of concealed) {
    await expect(
      withAuth(data.ownerClerkUserId, () =>
        postUpdate(transactionId, manualInput(data.ownerAccount, data.ownerLeaf)),
      ).then(responseBytes),
    ).resolves.toEqual(expected);
    await expect(
      withAuth(data.ownerClerkUserId, () => postDelete(transactionId)).then(
        responseBytes,
      ),
    ).resolves.toEqual(expected);
  }
  await expect(adminDb().select().from(transactions).orderBy(transactions.id)).resolves.toEqual(
    before,
  );
});

test("unknown and neighboring accounts and categories are byte-equivalent", async () => {
  const data = await authorityFixture();
  const unknownAccount = randomUUID();
  const unknownCategory = randomUUID();
  const accountResponses = await Promise.all(
    [unknownAccount, data.neighborAccount].map((accountId) =>
      withAuth(data.ownerClerkUserId, () =>
        postCreate(manualInput(accountId, data.ownerLeaf)),
      ).then(responseBytes),
    ),
  );
  expect(accountResponses).toEqual([
    {
      status: 404,
      contentType: "application/json",
      body: '{"error":"account_not_found"}',
    },
    accountResponses[0],
  ]);

  const categoryResponses = await Promise.all(
    [unknownCategory, data.neighborLeaf].map((categoryId) =>
      withAuth(data.ownerClerkUserId, () =>
        postCreate(manualInput(data.ownerAccount, categoryId)),
      ).then(responseBytes),
    ),
  );
  expect(categoryResponses).toEqual([
    {
      status: 404,
      contentType: "application/json",
      body: '{"error":"category_not_found"}',
    },
    categoryResponses[0],
  ]);
  await expect(
    adminDb().$count(transactions, eq(transactions.userId, data.neighbor.id)),
  ).resolves.toBe(1);
});

test("authentication and origin guards run before malformed and unreadable bodies", async () => {
  const clerkUserId = fakeClerkUserId();
  const transactionId = randomUUID();
  const routes = [
    (body: RequestBody, origin?: string) => postCreateRaw(body, origin),
    (body: RequestBody, origin?: string) =>
      postUpdateRaw(transactionId, body, origin),
    (body: RequestBody, origin?: string) =>
      postDeleteRaw(transactionId, body, origin),
  ];

  for (const route of routes) {
    await expect(route("{").then(responseBytes)).resolves.toEqual({
      status: 401,
      contentType: "application/json",
      body: '{"error":"unauthorized"}',
    });
    await expect(
      withAuth(clerkUserId, () => route("{", "https://evil.example")).then(
        responseBytes,
      ),
    ).resolves.toEqual({
      status: 403,
      contentType: "application/json",
      body: '{"error":"cross_origin"}',
    });
  }

  const bodyProbes = [
    {
      url: "http://localhost/api/transactions/manual",
      invoke: (probe: Request) => createRoute(probe),
    },
    {
      url: `http://localhost/api/transactions/${transactionId}/manual`,
      invoke: (probe: Request) =>
        updateRoute(probe, { params: Promise.resolve({ transactionId }) }),
    },
    {
      url: `http://localhost/api/transactions/${transactionId}/manual/delete`,
      invoke: (probe: Request) =>
        deleteRoute(probe, { params: Promise.resolve({ transactionId }) }),
    },
  ];
  for (const { url, invoke } of bodyProbes) {
    for (const origin of [undefined, "https://evil.example"]) {
      const probe = request(url, "{}", origin);
      const json = vi
        .spyOn(probe, "json")
        .mockRejectedValue(new Error("synthetic-private-body-detail"));
      const response = await (origin
        ? withAuth(clerkUserId, () => invoke(probe))
        : invoke(probe));
      expect(await responseBytes(response)).toEqual(
        origin
          ? {
              status: 403,
              contentType: "application/json",
              body: '{"error":"cross_origin"}',
            }
          : {
              status: 401,
              contentType: "application/json",
              body: '{"error":"unauthorized"}',
            },
      );
      expect(json).not.toHaveBeenCalled();
      json.mockRestore();
    }
  }
});

test("category transitions preserve or reset provenance and increment revision once", async () => {
  const data = await authorityFixture();
  const runId = await addInitialClassificationRun(data.owner.id);
  const [replacement] = await adminDb()
    .insert(categories)
    .values({
      userId: data.owner.id,
      parentId: data.ownerGroup,
      name: "Replacement leaf",
      sortOrder: 1,
    })
    .returning({ id: categories.id });
  const [target] = await adminDb()
    .insert(transactions)
    .values({
      userId: data.owner.id,
      accountId: data.ownerAccount,
      categoryId: data.ownerLeaf,
      categorySource: "auto",
      categoryConfidence: "low",
      categoryReason: "Automatic choice",
      categoryRunId: runId,
      categoryRevision: 7,
      amountMinor: -1234,
      currency: "USD",
      date: "2026-09-10",
      description: "Automatic row",
      status: "posted",
      source: "manual",
      updatedAt: new Date("2026-09-10T00:00:00Z"),
    })
    .returning({ id: transactions.id });

  const unchanged = await withAuth(data.ownerClerkUserId, () =>
    postUpdate(target.id, {
      ...manualInput(data.ownerAccount, data.ownerLeaf),
      amount: "12.35",
    }),
  );
  expect(unchanged.status).toBe(200);
  const [afterUnchanged] = await adminDb()
    .select()
    .from(transactions)
    .where(eq(transactions.id, target.id));
  expect(afterUnchanged).toMatchObject({
    categoryId: data.ownerLeaf,
    categorySource: "auto",
    categoryConfidence: "low",
    categoryReason: "Automatic choice",
    categoryRunId: runId,
    categoryRevision: 7,
    amountMinor: -1235,
  });
  expect(afterUnchanged.updatedAt.getTime()).toBeGreaterThan(
    new Date("2026-09-10T00:00:00Z").getTime(),
  );

  const changed = await withAuth(data.ownerClerkUserId, () =>
    postUpdate(target.id, manualInput(data.ownerAccount, replacement.id)),
  );
  expect(changed.status).toBe(200);
  const [afterChanged] = await adminDb()
    .select()
    .from(transactions)
    .where(eq(transactions.id, target.id));
  expect(afterChanged).toMatchObject({
    categoryId: replacement.id,
    categorySource: "user",
    categoryConfidence: null,
    categoryReason: null,
    categoryRunId: null,
    categoryRevision: 8,
  });

  const cleared = await withAuth(data.ownerClerkUserId, () =>
    postUpdate(target.id, manualInput(data.ownerAccount)),
  );
  expect(cleared.status).toBe(200);
  const [afterCleared] = await adminDb()
    .select()
    .from(transactions)
    .where(eq(transactions.id, target.id));
  expect(afterCleared).toMatchObject({
    categoryId: null,
    categorySource: null,
    categoryConfidence: null,
    categoryReason: null,
    categoryRunId: null,
    categoryRevision: 9,
  });
});

test("destination precision failure rolls back the full manual transaction state", async () => {
  const data = await authorityFixture();
  const runId = await addInitialClassificationRun(data.owner.id);
  const [jpyAccount] = await adminDb()
    .insert(accounts)
    .values({
      userId: data.owner.id,
      name: "JPY cash",
      type: "depository",
      currency: "JPY",
      source: "manual",
    })
    .returning({ id: accounts.id });
  const [target] = await adminDb()
    .insert(transactions)
    .values({
      userId: data.owner.id,
      accountId: data.ownerAccount,
      categoryId: data.ownerLeaf,
      categorySource: "auto",
      categoryConfidence: "medium",
      categoryReason: "Original reason",
      categoryRunId: runId,
      categoryRevision: 4,
      amountMinor: -1234,
      currency: "USD",
      date: "2026-09-10",
      description: "Original description",
      merchant: "Original merchant",
      status: "posted",
      source: "manual",
    })
    .returning({ id: transactions.id });
  const [before] = await adminDb()
    .select()
    .from(transactions)
    .where(eq(transactions.id, target.id));

  const response = await withAuth(data.ownerClerkUserId, () =>
    postUpdate(target.id, {
      ...manualInput(jpyAccount.id, null),
      amount: "1.5",
      description: "Must not land",
    }),
  );
  expect(await responseBytes(response)).toEqual({
    status: 400,
    contentType: "application/json",
    body: '{"error":"invalid_request"}',
  });
  await expect(
    adminDb().select().from(transactions).where(eq(transactions.id, target.id)),
  ).resolves.toEqual([before]);
});

test("match-defining edits replace an active pair with a newly eligible counterpart", async () => {
  const data = await transferFixture([
    { account: 0, amountMinor: -5000, date: "2026-03-10" },
    { account: 1, amountMinor: 5000, date: "2026-03-10" },
    { account: 2, amountMinor: 7000, date: "2026-03-11" },
  ]);
  await withAuth(data.clerkUserId, () => matchTransfers());
  const [original] = await transferPairsFor(data.user.id);
  expect(original).toMatchObject({
    outflowId: data.ids[0],
    inflowId: data.ids[1],
    dismissedAt: null,
  });

  const response = await withAuth(data.clerkUserId, () =>
    postUpdate(data.ids[0], {
      ...manualInput(data.accountIds[0]),
      amount: "70.00",
      date: "2026-03-10",
    }),
  );
  expect(response.status).toBe(200);

  const pairs = await transferPairsFor(data.user.id);
  expect(pairs).toHaveLength(1);
  expect(pairs[0]).toMatchObject({
    outflowId: data.ids[0],
    inflowId: data.ids[2],
    dismissedAt: null,
  });
  expect(pairs[0].id).not.toBe(original.id);
});

test("match-defining edits invalidate active pairs before fallible rematching", async () => {
  const data = await transferFixture([
    { account: 0, amountMinor: -5000, date: "2026-03-10" },
    { account: 1, amountMinor: 5000, date: "2026-03-10" },
    { account: 2, amountMinor: 7000, date: "2026-03-11" },
  ]);
  await withAuth(data.clerkUserId, () => matchTransfers());
  const [original] = await transferPairsFor(data.user.id);
  expect(original).toMatchObject({
    outflowId: data.ids[0],
    inflowId: data.ids[1],
    dismissedAt: null,
  });

  const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
  await adminDb().execute(
    sql.raw('REVOKE INSERT ON TABLE "transfer_pairs" FROM "cashlens_app"'),
  );

  try {
    const response = await withAuth(data.clerkUserId, () =>
      postUpdate(data.ids[0], {
        ...manualInput(data.accountIds[0]),
        amount: "70.00",
        date: "2026-03-10",
      }),
    );
    expect(response.status).toBe(200);
    await expect(transferPairsFor(data.user.id)).resolves.toEqual([]);
    await expect(
      adminDb()
        .select({ amountMinor: transactions.amountMinor })
        .from(transactions)
        .where(eq(transactions.id, data.ids[0])),
    ).resolves.toEqual([{ amountMinor: -7000 }]);
    expect(info).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(info.mock.calls[0][0]))).toEqual({
      event: "transfer_match.run_failed",
      operation: "update_manual_transaction",
      errorClass: "DrizzleQueryError",
    });
  } finally {
    await adminDb().execute(
      sql.raw('GRANT INSERT ON TABLE "transfer_pairs" TO "cashlens_app"'),
    );
    info.mockRestore();
  }
});

test("description, merchant, and category-only edits retain the active pair", async () => {
  const data = await transferFixture([
    { account: 0, amountMinor: -5000, date: "2026-03-10" },
    { account: 1, amountMinor: 5000, date: "2026-03-10" },
  ]);
  const [group] = await adminDb()
    .insert(categories)
    .values({ userId: data.user.id, name: "Transfers", sortOrder: 0 })
    .returning({ id: categories.id });
  const [leaf] = await adminDb()
    .insert(categories)
    .values({
      userId: data.user.id,
      parentId: group.id,
      name: "Internal transfer",
      sortOrder: 0,
    })
    .returning({ id: categories.id });
  await withAuth(data.clerkUserId, () => matchTransfers());
  const before = await transferPairsFor(data.user.id);

  const response = await withAuth(data.clerkUserId, () =>
    postUpdate(data.ids[0], {
      ...manualInput(data.accountIds[0], leaf.id),
      amount: "50.00",
      date: "2026-03-10",
      description: "Updated transfer description",
      merchant: "Counterparty",
    }),
  );
  expect(response.status).toBe(200);
  await expect(transferPairsFor(data.user.id)).resolves.toEqual(before);
});

test("dismissed pair memory survives match-defining edits", async () => {
  const data = await transferFixture([
    { account: 0, amountMinor: -5000, date: "2026-03-10" },
    { account: 1, amountMinor: 5000, date: "2026-03-10" },
  ]);
  await withAuth(data.clerkUserId, () => matchTransfers());
  const [active] = await transferPairsFor(data.user.id);
  await adminDb()
    .update(transferPairs)
    .set({ dismissedAt: new Date("2026-09-11T00:00:00Z") })
    .where(eq(transferPairs.id, active.id));
  const before = await transferPairsFor(data.user.id);

  const response = await withAuth(data.clerkUserId, () =>
    postUpdate(data.ids[0], {
      ...manualInput(data.accountIds[0]),
      amount: "60.00",
      date: "2026-03-12",
    }),
  );
  expect(response.status).toBe(200);
  await expect(transferPairsFor(data.user.id)).resolves.toEqual(before);
});

test("delete cascades its pair before matching the surviving half elsewhere", async () => {
  const data = await transferFixture([
    { account: 0, amountMinor: -5000, date: "2026-03-10" },
    { account: 1, amountMinor: 5000, date: "2026-03-10" },
    { account: 2, amountMinor: -5000, date: "2026-03-11" },
  ]);
  await withAuth(data.clerkUserId, () => matchTransfers());
  const [original] = await transferPairsFor(data.user.id);
  expect(original).toMatchObject({
    outflowId: data.ids[0],
    inflowId: data.ids[1],
  });

  const response = await withAuth(data.clerkUserId, () => postDelete(data.ids[0]));
  expect(response.status).toBe(200);

  const pairs = await transferPairsFor(data.user.id);
  expect(pairs).toHaveLength(1);
  expect(pairs[0]).toMatchObject({
    outflowId: data.ids[2],
    inflowId: data.ids[1],
    dismissedAt: null,
  });
  expect(pairs[0].id).not.toBe(original.id);
});

test("the app role has only the established transaction and balance update columns", async () => {
  await expect(updatePrivilegeColumns("transactions")).resolves.toEqual([
    "account_id",
    "amount_minor",
    "category_confidence",
    "category_id",
    "category_reason",
    "category_revision",
    "category_run_id",
    "category_source",
    "currency",
    "date",
    "description",
    "merchant",
    "source_id",
    "status",
    "updated_at",
  ]);
  await expect(updatePrivilegeColumns("account_balances")).resolves.toEqual([
    "as_of",
    "available_minor",
    "current_minor",
    "limit_minor",
  ]);
});

test("raw app-role mutations cannot rewrite owner identity or cross the RLS boundary", async () => {
  const data = await authorityFixture();
  await adminDb().insert(accountBalances).values({
    accountId: data.ownerAccount,
    userId: data.owner.id,
    currentMinor: 5000,
    asOf: new Date("2026-09-11T00:00:00Z"),
  });
  const [before] = await adminDb()
    .select()
    .from(transactions)
    .where(eq(transactions.id, data.ownerManual));

  const updated = await appQueryScopedAs(
    data.neighborClerkUserId,
    "update transactions set description = $1 where id = $2 returning id",
    ["Must not land", data.ownerManual],
  );
  const deleted = await appQueryScopedAs(
    data.neighborClerkUserId,
    "delete from transactions where id = $1 returning id",
    [data.ownerManual],
  );
  expect(updated.rowCount).toBe(0);
  expect(deleted.rowCount).toBe(0);
  await expect(
    adminDb().select().from(transactions).where(eq(transactions.id, data.ownerManual)),
  ).resolves.toEqual([before]);

  for (const [query, params] of [
    ["update transactions set user_id = user_id where id = $1", [data.ownerManual]],
    ["update transactions set source = source where id = $1", [data.ownerManual]],
    [
      "update account_balances set account_id = account_id where account_id = $1",
      [data.ownerAccount],
    ],
    [
      "update account_balances set user_id = user_id where account_id = $1",
      [data.ownerAccount],
    ],
  ] as const) {
    await expect(
      appQueryScopedAs(data.ownerClerkUserId, query, [...params]),
    ).rejects.toMatchObject({ code: "42501" });
  }
});

test("matcher failure is sanitized and cannot reverse a committed create", async () => {
  const data = await authorityFixture();
  const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
  await adminDb().execute(
    sql.raw('REVOKE SELECT ON TABLE "transfer_pairs" FROM "cashlens_app"'),
  );

  try {
    const response = await withAuth(data.ownerClerkUserId, () =>
      postCreate(manualInput(data.ownerAccount, data.ownerLeaf)),
    );
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body).toEqual({ transactionId: expect.any(String) });
    await expect(
      adminDb()
        .select({ id: transactions.id })
        .from(transactions)
        .where(eq(transactions.id, body.transactionId)),
    ).resolves.toEqual([{ id: body.transactionId }]);
    expect(info).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(info.mock.calls[0][0]))).toEqual({
      event: "transfer_match.run_failed",
      operation: "create_manual_transaction",
      errorClass: "DrizzleQueryError",
    });
  } finally {
    await adminDb().execute(
      sql.raw('GRANT SELECT ON TABLE "transfer_pairs" TO "cashlens_app"'),
    );
    info.mockRestore();
  }
});
