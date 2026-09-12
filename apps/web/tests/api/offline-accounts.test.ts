import { randomUUID } from "node:crypto";
import { expect, test } from "vitest";

import { accountOverview } from "@/lib/data/ledger";
import { requireUser } from "@/lib/data/users";
import { accountBalances, accounts, transactions } from "@/lib/db/schema";
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
