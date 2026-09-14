import { createHash, randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { expect, test, vi } from "vitest";

import { POST as importRoute } from "@/app/api/accounts/[accountId]/manual/import/route";
import { SEED_USERS } from "@/db/seed/dataset";
import { seedDataset } from "@/db/seed/seed";
import { accountOverview } from "@/lib/data/ledger";
import { withRequestScope } from "@/lib/db/client";
import { accounts, transactions, transferPairs } from "@/lib/db/schema";
import { MAX_IMPORT_BODY_BYTES, MAX_IMPORT_ROWS } from "@/lib/ledger/statement-import";
import { withAuth } from "../harness/clerk";
import { adminDb, appQueryScopedAs } from "../harness/db";
import {
  anchoredAccount,
  jsonBytes,
  provisionedUser,
  request,
  type RequestBody,
  responseBytes,
} from "./offline-helpers";

const postRaw = (accountId: string, body: RequestBody, origin?: string) =>
  importRoute(request(`http://localhost/api/accounts/${accountId}/manual/import`, body, origin), {
    params: Promise.resolve({ accountId }),
  });
const post = (accountId: string, rows: unknown) => postRaw(accountId, JSON.stringify({ rows }));
const row = (date: string, amount: string, description: string) => ({ date, amount, description });
const key = (date: string, minor: number, description: string, occurrence: number) =>
  createHash("sha256").update(`${date}\n${minor}\n${description}\n${occurrence}`).digest("hex");
const STATEMENT = [
  row("2026-04-02", "-12.34", "COFFEE SHOP"),
  row("2026-04-03", "1500", "Payroll"),
  row("2026-03-30", "-45.6", "Grocer"),
];
const notFound = jsonBytes(404, "account_not_found");
const badBody = jsonBytes(400, "invalid_request");

const storedRows = async (accountId: string) =>
  (
    await adminDb()
      .select({
        userId: transactions.userId,
        accountId: transactions.accountId,
        amountMinor: transactions.amountMinor,
        currency: transactions.currency,
        date: transactions.date,
        description: transactions.description,
        merchant: transactions.merchant,
        status: transactions.status,
        source: transactions.source,
        sourceId: transactions.sourceId,
        categoryId: transactions.categoryId,
        categorySource: transactions.categorySource,
      })
      .from(transactions)
      .where(eq(transactions.accountId, accountId))
  ).sort((a, b) => a.sourceId!.localeCompare(b.sourceId!));
const stored = (
  userId: string,
  accountId: string,
  currency: string,
  date: string,
  amountMinor: number,
  description: string,
  occurrence = 1,
) => ({
  userId,
  accountId,
  amountMinor,
  currency,
  date,
  description,
  merchant: null,
  status: "posted",
  source: "import",
  sourceId: key(date, amountMinor, description.toLowerCase().replace(/\s+/g, " "), occurrence),
  categoryId: null,
  categorySource: null,
});
const bySourceId = (a: { sourceId: string | null }, b: { sourceId: string | null }) =>
  a.sourceId!.localeCompare(b.sourceId!);
const countRows = async (userId: string) =>
  (
    await adminDb()
      .select({ n: sql<number>`count(*)::int` })
      .from(transactions)
      .where(eq(transactions.userId, userId))
  )[0].n;
const overviewRow = async (clerkUserId: string, id: string) =>
  (await withAuth(clerkUserId, () => accountOverview())).accounts.find((account) => account.id === id)!;

test("rows land as posted import transactions in the account's currency with server-derived identity", async () => {
  const owner = await provisionedUser();
  const wallet = await anchoredAccount({ userId: owner.id, name: "Wallet", type: "depository", currentMinor: 10000 });
  const yen = await anchoredAccount({ userId: owner.id, name: "Yen", type: "depository", currency: "JPY", currentMinor: 100000 });

  const response = await withAuth(owner.clerkUserId, () =>
    post(wallet, [...STATEMENT, row("2026-04-04", "-7.5", "  Bus  ")]),
  );
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ accountId: wallet, inserted: 4, skipped: 0 });
  expect(await storedRows(wallet)).toEqual(
    [
      stored(owner.id, wallet, "USD", "2026-03-30", -4560, "Grocer"),
      stored(owner.id, wallet, "USD", "2026-04-02", -1234, "COFFEE SHOP"),
      stored(owner.id, wallet, "USD", "2026-04-03", 150000, "Payroll"),
      stored(owner.id, wallet, "USD", "2026-04-04", -750, "Bus"),
    ].sort(bySourceId),
  );

  expect(await (await withAuth(owner.clerkUserId, () => post(yen, [row("2026-04-02", "-1200", "Ramen")]))).json()).toEqual({
    accountId: yen,
    inserted: 1,
    skipped: 0,
  });
  expect(await storedRows(yen)).toEqual([stored(owner.id, yen, "JPY", "2026-04-02", -1200, "Ramen")]);
  expect(
    await responseBytes(await withAuth(owner.clerkUserId, () => post(yen, [row("2026-04-02", "-1.5", "Half a yen")]))),
  ).toEqual(badBody);
  expect(
    await responseBytes(
      await withAuth(owner.clerkUserId, () =>
        post(wallet, [row("2026-04-05", "-1", "Fine"), row("2026-04-05", "-1.234", "Too fine")]),
      ),
    ),
  ).toEqual(badBody);
  expect(await countRows(owner.id)).toBe(5);
});

test("re-importing a file inserts nothing, an overlapping export lands only its new rows, and identical rows both land", async () => {
  const owner = await provisionedUser();
  const wallet = await anchoredAccount({ userId: owner.id, name: "Wallet", type: "depository", currentMinor: 10000 });
  const upload = async (rows: unknown) => (await withAuth(owner.clerkUserId, () => post(wallet, rows))).json();

  expect(await upload(STATEMENT)).toEqual({ accountId: wallet, inserted: 3, skipped: 0 });
  expect(await upload(STATEMENT)).toEqual({ accountId: wallet, inserted: 0, skipped: 3 });
  expect(
    await upload([
      row("2026-04-02", "-12.34", "coffee   shop"),
      row("2026-04-03", "1500.00", "PAYROLL"),
      row("2026-04-05", "-9.99", "New thing"),
    ]),
  ).toEqual({ accountId: wallet, inserted: 1, skipped: 2 });
  const twins = [row("2026-04-06", "-5", "Bus"), row("2026-04-06", "-5", "Bus")];
  expect(await upload(twins)).toEqual({ accountId: wallet, inserted: 2, skipped: 0 });
  expect(await upload(twins)).toEqual({ accountId: wallet, inserted: 0, skipped: 2 });
  expect(await upload([twins[0]])).toEqual({ accountId: wallet, inserted: 0, skipped: 1 });
  expect(await storedRows(wallet)).toEqual(
    [
      stored(owner.id, wallet, "USD", "2026-03-30", -4560, "Grocer"),
      stored(owner.id, wallet, "USD", "2026-04-02", -1234, "COFFEE SHOP"),
      stored(owner.id, wallet, "USD", "2026-04-03", 150000, "Payroll"),
      stored(owner.id, wallet, "USD", "2026-04-05", -999, "New thing"),
      stored(owner.id, wallet, "USD", "2026-04-06", -500, "Bus", 1),
      stored(owner.id, wallet, "USD", "2026-04-06", -500, "Bus", 2),
    ].sort(bySourceId),
  );
});

test("rows dated after the anchor day move the shown balance and earlier rows only add history", async () => {
  const owner = await provisionedUser();
  const held = await anchoredAccount({ userId: owner.id, name: "Wallet", type: "depository", currentMinor: 10000 });
  const owed = await anchoredAccount({ userId: owner.id, name: "Card", type: "credit", currentMinor: 5000 });
  const around = [
    row("2026-03-31", "-17", "Before the anchor"),
    row("2026-04-01", "-7", "On the anchor day"),
    row("2026-04-02", "-5", "After"),
    row("2026-04-04", "3", "Refund"),
  ];
  for (const id of [held, owed]) {
    expect((await withAuth(owner.clerkUserId, () => post(id, around))).status).toBe(200);
  }
  expect(await overviewRow(owner.clerkUserId, held)).toMatchObject({
    currentMinor: 10000 - 700 - 500 + 300,
    reportedMinor: 10000,
    reportedOn: "2026-04-01",
    sinceCount: 3,
    transactionCount: 4,
  });
  expect(await overviewRow(owner.clerkUserId, owed)).toMatchObject({
    currentMinor: 5000 + 700 + 500 - 300,
    reportedMinor: 5000,
    sinceCount: 3,
    transactionCount: 4,
  });
});

test("an imported leg pairs with the mirrored row in another account", async () => {
  const owner = await provisionedUser();
  const cash = await anchoredAccount({ userId: owner.id, name: "Cash", type: "depository", currentMinor: 10000 });
  const savings = await anchoredAccount({ userId: owner.id, name: "Savings", type: "depository", currentMinor: 10000 });
  const [into] = await adminDb()
    .insert(transactions)
    .values({ userId: owner.id, accountId: savings, amountMinor: 5000, currency: "USD", date: "2026-04-03", description: "FROM CASH", status: "posted", source: "manual", sourceId: null })
    .returning({ id: transactions.id });

  expect(
    (await withAuth(owner.clerkUserId, () => post(cash, [row("2026-04-02", "-50", "TO SAVINGS"), row("2026-04-02", "-8", "Lunch")]))).status,
  ).toBe(200);
  const [out] = await adminDb()
    .select({ id: transactions.id })
    .from(transactions)
    .where(and(eq(transactions.accountId, cash), eq(transactions.amountMinor, -5000)));
  expect(
    await adminDb()
      .select({
        outflow: transferPairs.outflowTransactionId,
        inflow: transferPairs.inflowTransactionId,
        dismissedAt: transferPairs.dismissedAt,
      })
      .from(transferPairs)
      .where(eq(transferPairs.userId, owner.id)),
  ).toEqual([{ outflow: out.id, inflow: into.id, dismissedAt: null }]);
});

const counting = (sizes: number[]) => {
  let bytesRead = 0;
  let cancelled = false;
  let next = 0;
  const body = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        if (next === sizes.length) return controller.close();
        const size = sizes[next++];
        bytesRead += size;
        controller.enqueue(new Uint8Array(size).fill(120));
      },
      cancel() {
        cancelled = true;
      },
    },
    { highWaterMark: 0 },
  );
  return { body, read: () => bytesRead, cancelled: () => cancelled };
};

test("guard, byte cap, parse, and resolution are ordered 401, 403, 413, 400, 404", async () => {
  const owner = await provisionedUser();
  const mine = await anchoredAccount({ userId: owner.id, name: "Mine", type: "other", currentMinor: 1 });
  const evil = "https://evil.example";
  const oversized = () => counting([MAX_IMPORT_BODY_BYTES - 1, 1, 1, 1]);

  const signedOut = oversized();
  expect(await responseBytes(await postRaw(mine, signedOut.body))).toEqual(jsonBytes(401, "unauthorized"));
  expect(signedOut.read()).toBe(0);
  const crossSite = oversized();
  expect(await responseBytes(await withAuth(owner.clerkUserId, () => postRaw(mine, crossSite.body, evil)))).toEqual(
    jsonBytes(403, "cross_origin"),
  );
  expect(crossSite.read()).toBe(0);
  const tooBig = oversized();
  expect(await responseBytes(await withAuth(owner.clerkUserId, () => postRaw("not-a-uuid", tooBig.body)))).toEqual(
    jsonBytes(413, "too_large"),
  );
  expect(tooBig.read()).toBe(MAX_IMPORT_BODY_BYTES + 1);
  expect(tooBig.cancelled()).toBe(true);
  const wellFormedButHuge = JSON.stringify({ rows: Array(MAX_IMPORT_ROWS).fill(row("2026-04-02", "-1", "x".repeat(200))) });
  expect(Buffer.byteLength(wellFormedButHuge)).toBeGreaterThan(MAX_IMPORT_BODY_BYTES);
  expect(await responseBytes(await withAuth(owner.clerkUserId, () => postRaw(mine, wellFormedButHuge)))).toEqual(
    jsonBytes(413, "too_large"),
  );
  expect(await responseBytes(await withAuth(owner.clerkUserId, () => postRaw(mine, "x".repeat(MAX_IMPORT_BODY_BYTES + 1))))).toEqual(
    jsonBytes(413, "too_large"),
  );
  expect(await responseBytes(await withAuth(owner.clerkUserId, () => postRaw(mine, "x".repeat(MAX_IMPORT_BODY_BYTES))))).toEqual(badBody);
  expect(await responseBytes(await withAuth(owner.clerkUserId, () => postRaw("not-a-uuid", "not json")))).toEqual(badBody);
  expect(await responseBytes(await withAuth(owner.clerkUserId, () => post("not-a-uuid", STATEMENT)))).toEqual(notFound);
  const broken = new ReadableStream<Uint8Array>({
    pull(controller) {
      controller.error(new Error("synthetic-private-body-detail"));
    },
  });
  expect(await responseBytes(await withAuth(owner.clerkUserId, () => postRaw(mine, broken)))).toEqual(
    jsonBytes(400, "invalid_body"),
  );
  expect(await countRows(owner.id)).toBe(0);
  expect(
    (await withAuth(owner.clerkUserId, () => postRaw(mine, JSON.stringify({ rows: STATEMENT }), "http://localhost"))).status,
  ).toBe(200);
  expect(await countRows(owner.id)).toBe(3);
});

test("every not-found answer is byte-identical and no rejected body lands a row", async () => {
  await seedDataset(adminDb());
  const owner = await provisionedUser();
  const mine = await anchoredAccount({ userId: owner.id, name: "Mine", type: "other", currentMinor: 1 });
  const myPlaid = await anchoredAccount({ userId: owner.id, name: "My bank", type: "depository", source: "plaid", currentMinor: 1 });
  const myStamped = await anchoredAccount({ userId: owner.id, name: "Stamped", type: "depository", source: "import", currentMinor: 1 });
  const [seedWallet] = await adminDb()
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(eq(accounts.userId, SEED_USERS.demo.id), eq(accounts.source, "manual")));
  const demoBefore = await countRows(SEED_USERS.demo.id);

  for (const target of ["not-a-uuid", randomUUID(), seedWallet.id, myPlaid, myStamped]) {
    for (const rows of [STATEMENT, [row("2026-04-02", "-1.234", "x")]]) {
      expect(await responseBytes(await withAuth(owner.clerkUserId, () => post(target, rows))), target).toEqual(notFound);
    }
  }
  for (const body of [
    "not json",
    "[]",
    JSON.stringify({ rows: [] }),
    JSON.stringify({ rows: STATEMENT, extra: 1 }),
    JSON.stringify({ rows: [{ ...STATEMENT[0], amount: "1e3" }] }),
    JSON.stringify({ rows: [{ ...STATEMENT[0], description: "x".repeat(201) }] }),
    JSON.stringify({ rows: Array(MAX_IMPORT_ROWS + 1).fill(STATEMENT[0]) }),
  ]) {
    expect(await responseBytes(await withAuth(owner.clerkUserId, () => postRaw(mine, body))), body.slice(0, 40)).toEqual(badBody);
  }
  expect(await countRows(owner.id)).toBe(0);
  expect(await countRows(SEED_USERS.demo.id)).toBe(demoBefore);
});

test("the neighbor cannot import into the owner's account and never sees the owner's rows, even with a raw query", async () => {
  const owner = await provisionedUser();
  const neighbor = await provisionedUser();
  const mine = await anchoredAccount({ userId: owner.id, name: "Mine", type: "depository", currentMinor: 10000 });
  expect((await withAuth(owner.clerkUserId, () => post(mine, STATEMENT))).status).toBe(200);
  const before = await storedRows(mine);

  expect(await responseBytes(await withAuth(neighbor.clerkUserId, () => post(mine, STATEMENT)))).toEqual(notFound);
  expect(
    await responseBytes(await withAuth(neighbor.clerkUserId, () => post(mine, [row("2026-04-09", "-1", "Planted")]))),
  ).toEqual(notFound);
  expect(await storedRows(mine)).toEqual(before);
  expect(await countRows(neighbor.id)).toBe(0);
  expect((await withAuth(neighbor.clerkUserId, () => accountOverview())).accounts).toEqual([]);
  expect(
    await withRequestScope(neighbor.clerkUserId, (tx) => tx.select({ id: transactions.id }).from(transactions)),
  ).toEqual([]);
  const importedRows = "select count(*)::int as n from transactions where source = 'import'";
  expect((await appQueryScopedAs(neighbor.clerkUserId, importedRows)).rows).toEqual([{ n: 0 }]);
  expect((await appQueryScopedAs(owner.clerkUserId, importedRows)).rows).toEqual([{ n: 3 }]);
  await expect(
    appQueryScopedAs(
      neighbor.clerkUserId,
      "insert into transactions (user_id, account_id, amount_minor, currency, date, description, status, source, source_id) values ($1, $2, -100, 'USD', '2026-04-09', 'Planted', 'posted', 'import', 'planted')",
      [owner.id, mine],
    ),
  ).rejects.toThrow(/row-level security/);
  expect(await storedRows(mine)).toEqual(before);
});

test("the run logs the account id and counts and nothing from the file", async () => {
  const owner = await provisionedUser();
  const wallet = await anchoredAccount({ userId: owner.id, name: "Wallet", type: "depository", currentMinor: 10000 });
  const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
  try {
    expect((await withAuth(owner.clerkUserId, () => post(wallet, STATEMENT))).status).toBe(200);
    expect((await withAuth(owner.clerkUserId, () => post(wallet, STATEMENT))).status).toBe(200);
    expect(info.mock.calls.map(([line]) => line)).toEqual([
      JSON.stringify({ event: "statement_import.run", accountId: wallet, received: 3, inserted: 3, skipped: 0 }),
      JSON.stringify({ event: "statement_import.run", accountId: wallet, received: 3, inserted: 0, skipped: 3 }),
    ]);
  } finally {
    info.mockRestore();
  }
});
