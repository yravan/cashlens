import { eq } from "drizzle-orm";
import { expect, test } from "vitest";

import { EXPECTED, SEED_OBLIGATIONS, SEED_PERSONAS, SEED_USERS, type ExpectedPersona } from "@/db/seed/dataset";
import { seedDataset } from "@/db/seed/seed";
import { accountOverview } from "@/lib/data/ledger";
import { endObligation } from "@/lib/data/obligations";
import { withRequestScope } from "@/lib/db/client";
import { accountBalances, accounts } from "@/lib/db/schema";
import { withAuth } from "../harness/clerk";
import { adminDb } from "../harness/db";

const withAnyId = (accounts: ExpectedPersona["overview"]["accounts"]) =>
  accounts.map((account) => ({ ...account, id: expect.any(String) }));

test("the overview is exact for each signed-in persona and never includes a neighbor's accounts", async () => {
  await seedDataset(adminDb());

  for (const persona of SEED_PERSONAS) {
    const overview = await withAuth(SEED_USERS[persona].clerkUserId, () => accountOverview());
    expect(overview.accounts).toEqual(withAnyId(EXPECTED[persona].overview.accounts));
    expect(overview.cashOnHand).toEqual(EXPECTED[persona].overview.cashOnHand);
    expect(overview.creditOwed).toEqual(EXPECTED[persona].overview.creditOwed);
  }
});

test("purge disclosure counts every retained attached obligation, including ended rows", async () => {
  await seedDataset(adminDb());
  const tuition = SEED_OBLIGATIONS.find(
    (row) => row.persona === "demo" && row.name === "Tuition",
  )!;
  expect(
    await withAuth(SEED_USERS.demo.clerkUserId, () => endObligation(tuition.id)),
  ).toEqual({});

  const demo = await withAuth(SEED_USERS.demo.clerkUserId, () => accountOverview());
  expect(demo.accounts.find((row) => row.name === "Everyday Checking")?.obligationCount).toBe(
    2,
  );

  const neighbor = await withAuth(SEED_USERS.neighbor.clerkUserId, () => accountOverview());
  expect(neighbor.accounts).toHaveLength(1);
  expect(neighbor.accounts[0]?.obligationCount).toBe(1);
});

test("the account and balance tables enforce the signed-in scope even without a DAL filter", async () => {
  await seedDataset(adminDb());

  const rows = await withRequestScope(SEED_USERS.neighbor.clerkUserId, (tx) =>
    tx
      .select({ name: accounts.name, currentMinor: accountBalances.currentMinor })
      .from(accounts)
      .leftJoin(accountBalances, eq(accountBalances.accountId, accounts.id)),
  );
  expect(rows).toEqual(
    EXPECTED.neighbor.overview.accounts.map(({ name, currentMinor }) => ({ name, currentMinor })),
  );
});

test("an unavailable current balance stays unavailable and is excluded from totals", async () => {
  await seedDataset(adminDb());
  const [account] = await adminDb()
    .insert(accounts)
    .values({
      userId: SEED_USERS.demo.id,
      name: "Available Only",
      type: "depository",
      subtype: "checking",
      mask: "7777",
      currency: "USD",
      source: "plaid",
      sourceId: "seed-available-only",
    })
    .returning({ id: accounts.id });
  await adminDb().insert(accountBalances).values({
    accountId: account.id,
    userId: SEED_USERS.demo.id,
    availableMinor: 12345,
    currentMinor: null,
    limitMinor: null,
    asOf: new Date("2026-03-31T12:00:00Z"),
  });

  const overview = await withAuth(SEED_USERS.demo.clerkUserId, () => accountOverview());
  expect(overview.accounts.find((row) => row.id === account.id)?.currentMinor).toBeNull();
  expect(overview.cashOnHand).toEqual(EXPECTED.demo.overview.cashOnHand);
});

test("the overview requires a signed-in user", async () => {
  await expect(accountOverview()).rejects.toMatchObject({
    digest: expect.stringContaining("/sign-in"),
  });
});
