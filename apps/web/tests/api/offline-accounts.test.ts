import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { expect, test } from "vitest";

import { POST as deleteRoute } from "@/app/api/accounts/[accountId]/manual/delete/route";
import { POST as updateRoute } from "@/app/api/accounts/[accountId]/manual/route";
import { POST as createRoute } from "@/app/api/accounts/manual/route";
import { EXPECTED, SEED_USERS } from "@/db/seed/dataset";
import { seedDataset } from "@/db/seed/seed";
import { accountOverview } from "@/lib/data/ledger";
import { requireUser } from "@/lib/data/users";
import { withRequestScope } from "@/lib/db/client";
import {
  accountBalances,
  accounts,
  recurringStreams,
  transactions,
  transferPairs,
} from "@/lib/db/schema";
import { fakeClerkUserId, withAuth } from "../harness/clerk";
import { adminDb } from "../harness/db";

async function provisionedUser() {
  const clerkUserId = fakeClerkUserId();
  const user = await withAuth(clerkUserId, () => requireUser());
  return { clerkUserId, id: user.id };
}

type AnchoredAccount = {
  userId: string;
  name: string;
  type: "depository" | "credit" | "loan" | "investment" | "other";
  source?: "plaid" | "manual" | "import";
  currentMinor: number;
  reportedOn?: string | null;
};

async function anchoredAccount(row: AnchoredAccount) {
  const [account] = await adminDb()
    .insert(accounts)
    .values({
      userId: row.userId,
      name: row.name,
      type: row.type,
      currency: "USD",
      source: row.source ?? "manual",
      sourceId: row.source && row.source !== "manual" ? `seed-${randomUUID()}` : null,
    })
    .returning({ id: accounts.id });
  await adminDb().insert(accountBalances).values({
    accountId: account.id,
    userId: row.userId,
    availableMinor: null,
    currentMinor: row.currentMinor,
    limitMinor: null,
    asOf: new Date("2026-04-01T12:00:00Z"),
    reportedOn: row.reportedOn === undefined ? "2026-04-01" : row.reportedOn,
  });
  return account.id;
}

const AROUND_THE_ANCHOR = [
  { date: "2026-04-02", amountMinor: -500, createdAt: "2026-04-01T11:00:00Z", status: "posted" },
  { date: "2026-04-01", amountMinor: -700, createdAt: "2026-04-01T13:00:00Z", status: "posted" },
  { date: "2026-04-01", amountMinor: -1100, createdAt: "2026-04-01T12:00:00Z", status: "posted" },
  { date: "2026-04-01", amountMinor: -1300, createdAt: "2026-04-01T11:00:00Z", status: "posted" },
  { date: "2026-03-31", amountMinor: -1700, createdAt: "2026-04-05T00:00:00Z", status: "posted" },
  { date: "2026-04-03", amountMinor: -1900, createdAt: "2026-04-05T00:00:00Z", status: "pending" },
  { date: "2026-04-04", amountMinor: 300, createdAt: "2026-04-05T00:00:00Z", status: "posted" },
] as const;
const SINCE_MINOR = -500 - 700 + 300;
const SINCE_COUNT = 3;

async function rowsAroundTheAnchor(userId: string, accountId: string) {
  await adminDb()
    .insert(transactions)
    .values(
      AROUND_THE_ANCHOR.map((row, index) => ({
        userId,
        accountId,
        amountMinor: row.amountMinor,
        currency: "USD",
        date: row.date,
        description: `AROUND ANCHOR ${index}`,
        status: row.status,
        source: "manual" as const,
        sourceId: null,
        createdAt: new Date(row.createdAt),
      })),
    );
}

const overviewRow = (overview: Awaited<ReturnType<typeof accountOverview>>, id: string) =>
  overview.accounts.find((account) => account.id === id)!;

test("an offline balance is the anchor plus the posted rows after it, signed by type", async () => {
  const owner = await provisionedUser();
  const held = await anchoredAccount({ userId: owner.id, name: "Wallet", type: "depository", currentMinor: 10000 });
  const owed = await anchoredAccount({ userId: owner.id, name: "Store card", type: "credit", currentMinor: 5000 });
  const provider = await anchoredAccount({ userId: owner.id, name: "Bank", type: "depository", source: "plaid", currentMinor: 10000 });
  const stamped = await anchoredAccount({ userId: owner.id, name: "Stamped bank", type: "depository", source: "import", currentMinor: 10000 });
  for (const id of [held, owed, provider, stamped]) await rowsAroundTheAnchor(owner.id, id);

  const overview = await withAuth(owner.clerkUserId, () => accountOverview());
  expect(overviewRow(overview, held)).toEqual({
    id: held,
    name: "Wallet",
    type: "depository",
    subtype: null,
    mask: null,
    currency: "USD",
    source: "manual",
    currentMinor: 10000 + SINCE_MINOR,
    reportedMinor: 10000,
    reportedOn: "2026-04-01",
    sinceCount: SINCE_COUNT,
    transactionCount: AROUND_THE_ANCHOR.length,
  });
  expect(overviewRow(overview, owed)).toMatchObject({
    currentMinor: 5000 - SINCE_MINOR,
    reportedMinor: 5000,
    sinceCount: SINCE_COUNT,
  });
  expect(overviewRow(overview, provider)).toMatchObject({
    source: "plaid",
    currentMinor: 10000,
    reportedMinor: 10000,
    reportedOn: "2026-04-01",
    sinceCount: 0,
  });
  expect(overviewRow(overview, stamped)).toMatchObject({ source: "import", currentMinor: 10000, sinceCount: 0 });
  expect(overview.cashOnHand).toEqual({ USD: 10000 + SINCE_MINOR + 10000 + 10000 });
  expect(overview.creditOwed).toEqual({ USD: 5000 - SINCE_MINOR });
});

test("an offline account without an anchor day or without a balance row shows the stored figure", async () => {
  const owner = await provisionedUser();
  const unanchored = await anchoredAccount({ userId: owner.id, name: "Old wallet", type: "other", currentMinor: 4200, reportedOn: null });
  await rowsAroundTheAnchor(owner.id, unanchored);
  const [bare] = await adminDb()
    .insert(accounts)
    .values({ userId: owner.id, name: "Bare", type: "other", currency: "USD", source: "manual", sourceId: null })
    .returning({ id: accounts.id });

  const overview = await withAuth(owner.clerkUserId, () => accountOverview());
  expect(overviewRow(overview, unanchored)).toMatchObject({
    currentMinor: 4200,
    reportedMinor: 4200,
    reportedOn: null,
    sinceCount: 0,
  });
  expect(overviewRow(overview, bare.id)).toMatchObject({
    currentMinor: null,
    reportedMinor: null,
    reportedOn: null,
    sinceCount: 0,
    transactionCount: 0,
  });
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
  createRoute(request("http://localhost/api/accounts/manual", body, origin));
const postUpdateRaw = (accountId: string, body: RequestBody, origin?: string) =>
  updateRoute(request(`http://localhost/api/accounts/${accountId}/manual`, body, origin), {
    params: Promise.resolve({ accountId }),
  });
const postDeleteRaw = (accountId: string, body: RequestBody, origin?: string) =>
  deleteRoute(
    request(`http://localhost/api/accounts/${accountId}/manual/delete`, body, origin),
    { params: Promise.resolve({ accountId }) },
  );
const postCreate = (body: unknown) => postCreateRaw(JSON.stringify(body));
const postUpdate = (accountId: string, body: unknown) =>
  postUpdateRaw(accountId, JSON.stringify(body));
const postDelete = (accountId: string, body: unknown = {}) =>
  postDeleteRaw(accountId, JSON.stringify(body));

const responseBytes = async (response: Response) => ({
  status: response.status,
  contentType: response.headers.get("content-type"),
  body: await response.text(),
});

const jsonBytes = (status: number, error: string) => ({
  status,
  contentType: "application/json",
  body: JSON.stringify({ error }),
});

const CREATE = {
  name: "  Kalshi  ",
  type: "other",
  currency: "USD",
  balance: "250.00",
  reportedOn: "2026-09-12",
};

const countRows = async (userId: string) =>
  (
    await adminDb()
      .select({ n: sql<number>`count(*)::int` })
      .from(transactions)
      .where(eq(transactions.userId, userId))
  )[0].n;

test("create inserts the account and its anchor and the overview moves by the exact amount", async () => {
  const owner = await provisionedUser();
  const before = await withAuth(owner.clerkUserId, () => accountOverview());
  const response = await withAuth(owner.clerkUserId, () =>
    postCreate({ ...CREATE, name: " Petty cash ", type: "depository", balance: "-12.5" }),
  );
  expect(response.status).toBe(201);
  const { accountId } = await response.json();

  const [account] = await adminDb().select().from(accounts).where(eq(accounts.id, accountId));
  expect(account).toMatchObject({
    userId: owner.id,
    connectionId: null,
    name: "Petty cash",
    type: "depository",
    subtype: null,
    mask: null,
    currency: "USD",
    source: "manual",
    sourceId: null,
  });
  const [balance] = await adminDb()
    .select()
    .from(accountBalances)
    .where(eq(accountBalances.accountId, accountId));
  expect(balance).toMatchObject({
    userId: owner.id,
    availableMinor: null,
    currentMinor: -1250,
    limitMinor: null,
    reportedOn: "2026-09-12",
  });
  expect(balance.asOf.getTime()).toBeGreaterThan(Date.now() - 60_000);

  const after = await withAuth(owner.clerkUserId, () => accountOverview());
  expect(after.accounts).toHaveLength(before.accounts.length + 1);
  expect(after.cashOnHand).toEqual({ USD: (before.cashOnHand.USD ?? 0) - 1250 });
  expect(after.creditOwed).toEqual(before.creditOwed);

  const owedResponse = await withAuth(owner.clerkUserId, () =>
    postCreate({ ...CREATE, name: "Store card", type: "credit", balance: "40" }),
  );
  expect(owedResponse.status).toBe(201);
  const withCard = await withAuth(owner.clerkUserId, () => accountOverview());
  expect(withCard.creditOwed).toEqual({ USD: 4000 });
  expect(withCard.cashOnHand).toEqual(after.cashOnHand);
  expect(await countRows(owner.id)).toBe(0);
});

test("create rejects an inexact balance for the chosen currency", async () => {
  const owner = await provisionedUser();
  expect(
    await responseBytes(
      await withAuth(owner.clerkUserId, () => postCreate({ ...CREATE, currency: "JPY", balance: "1.5" })),
    ),
  ).toEqual(jsonBytes(400, "invalid_request"));
  expect(await adminDb().select().from(accounts).where(eq(accounts.userId, owner.id))).toEqual([]);
});

test("update balance re-anchors the single balance row and recomputes the rows since", async () => {
  const owner = await provisionedUser();
  const id = await anchoredAccount({ userId: owner.id, name: "Wallet", type: "depository", currentMinor: 10000 });
  await rowsAroundTheAnchor(owner.id, id);
  const [{ asOf: previous }] = await adminDb()
    .select({ asOf: accountBalances.asOf })
    .from(accountBalances)
    .where(eq(accountBalances.accountId, id));

  const response = await withAuth(owner.clerkUserId, () =>
    postUpdate(id, { balance: "80", reportedOn: "2026-04-05" }),
  );
  expect(await response.json()).toEqual({ accountId: id });
  expect(response.status).toBe(200);
  const rows = await adminDb().select().from(accountBalances).where(eq(accountBalances.accountId, id));
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    availableMinor: null,
    currentMinor: 8000,
    limitMinor: null,
    reportedOn: "2026-04-05",
  });
  expect(rows[0].asOf.getTime()).toBeGreaterThan(previous.getTime());
  expect(overviewRow(await withAuth(owner.clerkUserId, () => accountOverview()), id)).toMatchObject({
    currentMinor: 8000,
    reportedMinor: 8000,
    reportedOn: "2026-04-05",
    sinceCount: 0,
  });

  const [bare] = await adminDb()
    .insert(accounts)
    .values({ userId: owner.id, name: "Bare", type: "other", currency: "JPY", source: "manual", sourceId: null })
    .returning({ id: accounts.id });
  expect(
    (await withAuth(owner.clerkUserId, () => postUpdate(bare.id, { balance: "1234", reportedOn: "2026-04-05" }))).status,
  ).toBe(200);
  expect(
    await adminDb()
      .select({ currentMinor: accountBalances.currentMinor, reportedOn: accountBalances.reportedOn })
      .from(accountBalances)
      .where(eq(accountBalances.accountId, bare.id)),
  ).toEqual([{ currentMinor: 1234, reportedOn: "2026-04-05" }]);
  expect(
    (await withAuth(owner.clerkUserId, () => postUpdate(bare.id, { balance: "1.5", reportedOn: "2026-04-05" }))).status,
  ).toBe(400);
});

test("delete removes the offline account with its rows, balance, decisions, and pairs, and nothing of the neighbor's", async () => {
  await seedDataset(adminDb());
  const owner = await provisionedUser();
  const cash = await anchoredAccount({ userId: owner.id, name: "Cash", type: "depository", currentMinor: 10000 });
  const keep = await anchoredAccount({ userId: owner.id, name: "Keep", type: "depository", currentMinor: 10000 });
  const [out, into] = await adminDb()
    .insert(transactions)
    .values([
      { userId: owner.id, accountId: cash, amountMinor: -5000, currency: "USD", date: "2026-04-02", description: "MOVE OUT", status: "posted", source: "manual", sourceId: null },
      { userId: owner.id, accountId: keep, amountMinor: 5000, currency: "USD", date: "2026-04-02", description: "MOVE IN", status: "posted", source: "manual", sourceId: null },
    ])
    .returning({ id: transactions.id });
  await adminDb()
    .insert(transferPairs)
    .values({ userId: owner.id, outflowTransactionId: out.id, inflowTransactionId: into.id });
  await adminDb().insert(recurringStreams).values({
    userId: owner.id,
    accountId: cash,
    currency: "USD",
    direction: "outflow",
    normalizedName: "GYM",
    status: "confirmed",
  });
  const neighborBefore = await countRows(SEED_USERS.demo.id);

  const response = await withAuth(owner.clerkUserId, () => postDelete(cash));
  expect(await response.json()).toEqual({ accountId: cash });
  expect(response.status).toBe(200);
  expect(await adminDb().select().from(accounts).where(eq(accounts.id, cash))).toEqual([]);
  expect(await adminDb().select().from(accountBalances).where(eq(accountBalances.accountId, cash))).toEqual([]);
  expect(await adminDb().select().from(transactions).where(eq(transactions.accountId, cash))).toEqual([]);
  expect(await adminDb().select().from(recurringStreams).where(eq(recurringStreams.accountId, cash))).toEqual([]);
  expect(await adminDb().select().from(transferPairs).where(eq(transferPairs.userId, owner.id))).toEqual([]);
  expect(
    await adminDb().select({ id: transactions.id }).from(transactions).where(eq(transactions.accountId, keep)),
  ).toEqual([{ id: into.id }]);
  expect(await countRows(SEED_USERS.demo.id)).toBe(neighborBefore);
  expect(
    (await adminDb().select().from(accounts).where(eq(accounts.userId, SEED_USERS.demo.id))).length,
  ).toBe(EXPECTED.demo.accounts);
});

test("every not-found answer is byte-identical and delete requires an empty object body", async () => {
  await seedDataset(adminDb());
  const owner = await provisionedUser();
  const mine = await anchoredAccount({ userId: owner.id, name: "Mine", type: "other", currentMinor: 1 });
  const myPlaid = await anchoredAccount({ userId: owner.id, name: "My bank", type: "depository", source: "plaid", currentMinor: 1 });
  const [seedWallet] = await adminDb()
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(eq(accounts.userId, SEED_USERS.demo.id), eq(accounts.source, "manual")));
  const notFound = jsonBytes(404, "account_not_found");

  for (const target of ["not-a-uuid", randomUUID(), seedWallet.id, myPlaid]) {
    expect(
      await responseBytes(
        await withAuth(owner.clerkUserId, () => postUpdate(target, { balance: "1", reportedOn: "2026-09-12" })),
      ),
    ).toEqual(notFound);
    expect(await responseBytes(await withAuth(owner.clerkUserId, () => postDelete(target)))).toEqual(notFound);
  }
  expect(
    await adminDb()
      .select({ currentMinor: accountBalances.currentMinor })
      .from(accountBalances)
      .where(eq(accountBalances.accountId, seedWallet.id)),
  ).toEqual([{ currentMinor: 8600 }]);
  expect((await adminDb().select().from(accounts).where(eq(accounts.id, myPlaid))).length).toBe(1);

  const badBody = jsonBytes(400, "invalid_request");
  expect(
    await responseBytes(await withAuth(owner.clerkUserId, () => postDelete(mine, { confirm: true }))),
  ).toEqual(badBody);
  expect(await responseBytes(await withAuth(owner.clerkUserId, () => postDeleteRaw(mine, "[]")))).toEqual(badBody);
  expect((await adminDb().select().from(accounts).where(eq(accounts.id, mine))).length).toBe(1);
});

test("the neighbor cannot see, re-anchor, or delete the owner's offline account, even with a raw query", async () => {
  const owner = await provisionedUser();
  const neighbor = await provisionedUser();
  const mine = await anchoredAccount({ userId: owner.id, name: "Mine", type: "other", currentMinor: 777 });

  expect(
    (await withAuth(neighbor.clerkUserId, () => postUpdate(mine, { balance: "1", reportedOn: "2026-09-12" }))).status,
  ).toBe(404);
  expect((await withAuth(neighbor.clerkUserId, () => postDelete(mine))).status).toBe(404);
  expect(
    await withRequestScope(neighbor.clerkUserId, (tx) =>
      tx
        .select({ id: accounts.id })
        .from(accounts)
        .leftJoin(accountBalances, eq(accountBalances.accountId, accounts.id)),
    ),
  ).toEqual([]);
  expect((await withAuth(neighbor.clerkUserId, () => accountOverview())).accounts).toEqual([]);
  expect(
    await adminDb()
      .select({ currentMinor: accountBalances.currentMinor })
      .from(accountBalances)
      .where(eq(accountBalances.accountId, mine)),
  ).toEqual([{ currentMinor: 777 }]);
});

test("guard, parse, and resolution are ordered 401, 403, 400, 404 on every route", async () => {
  const owner = await provisionedUser();
  const mine = await anchoredAccount({ userId: owner.id, name: "Mine", type: "other", currentMinor: 1 });
  const unauthorized = jsonBytes(401, "unauthorized");
  const crossOrigin = jsonBytes(403, "cross_origin");
  const badBody = jsonBytes(400, "invalid_request");
  const evil = "https://evil.example";

  expect(await responseBytes(await postCreateRaw("not json"))).toEqual(unauthorized);
  expect(await responseBytes(await postUpdateRaw("not-a-uuid", "not json"))).toEqual(unauthorized);
  expect(await responseBytes(await postDeleteRaw("not-a-uuid", "not json"))).toEqual(unauthorized);
  expect(await responseBytes(await withAuth(owner.clerkUserId, () => postCreateRaw("not json", evil)))).toEqual(crossOrigin);
  expect(await responseBytes(await withAuth(owner.clerkUserId, () => postUpdateRaw("not-a-uuid", "not json", evil)))).toEqual(crossOrigin);
  expect(await responseBytes(await withAuth(owner.clerkUserId, () => postDeleteRaw("not-a-uuid", "not json", evil)))).toEqual(crossOrigin);
  expect(await responseBytes(await withAuth(owner.clerkUserId, () => postCreateRaw("not json")))).toEqual(badBody);
  expect(await responseBytes(await withAuth(owner.clerkUserId, () => postUpdateRaw("not-a-uuid", "not json")))).toEqual(badBody);
  expect(await responseBytes(await withAuth(owner.clerkUserId, () => postDeleteRaw("not-a-uuid", '{"x":1}')))).toEqual(badBody);
  expect(
    (await withAuth(owner.clerkUserId, () => postCreateRaw(JSON.stringify(CREATE), "http://localhost"))).status,
  ).toBe(201);
  expect(
    (await withAuth(owner.clerkUserId, () => postUpdate(mine, { balance: "2", reportedOn: "2026-09-12" }))).status,
  ).toBe(200);
});
