import { expect, test } from "vitest";

import { ledgerCounts } from "@/lib/data/ledger";
import { requireUser } from "@/lib/data/users";
import { accounts, transactions } from "@/lib/db/schema";
import { fakeClerkUserId, withAuth } from "../harness/clerk";
import { adminDb } from "../harness/db";

async function provision(clerkUserId: string): Promise<string> {
  const user = await withAuth(clerkUserId, () => requireUser());
  return user.id;
}

function account(userId: string, name: string) {
  return { userId, name, type: "depository" as const, currency: "USD", source: "manual" as const };
}

function transaction(userId: string, accountId: string, amountMinor: number, date: string, description: string) {
  return {
    userId,
    accountId,
    amountMinor,
    currency: "USD",
    date,
    description,
    status: "posted" as const,
    source: "manual" as const,
  };
}

test("ledger counts are exactly the signed-in user's, never anyone else's", async () => {
  const clerkA = fakeClerkUserId();
  const clerkB = fakeClerkUserId();
  const clerkC = fakeClerkUserId();
  const [userA, userB] = await Promise.all([provision(clerkA), provision(clerkB)]);
  await provision(clerkC);

  const seeded = await adminDb()
    .insert(accounts)
    .values([
      account(userA, "A Checking"),
      account(userA, "A Card"),
      account(userB, "B Savings"),
    ])
    .returning({ id: accounts.id, userId: accounts.userId });
  const [accountA1, accountA2, accountB1] = seeded;

  await adminDb().insert(transactions).values([
    transaction(userA, accountA1.id, -1999, "2026-02-02", "GROCERY MART"),
    transaction(userA, accountA1.id, -750, "2026-02-03", "COFFEE"),
    transaction(userA, accountA2.id, -4500, "2026-02-03", "CASH LUNCH"),
    transaction(userB, accountB1.id, 100000, "2026-02-04", "TRANSFER IN"),
  ]);

  await expect(withAuth(clerkA, () => ledgerCounts())).resolves.toEqual({
    accounts: 2,
    transactions: 3,
  });
  await expect(withAuth(clerkB, () => ledgerCounts())).resolves.toEqual({
    accounts: 1,
    transactions: 1,
  });
  await expect(withAuth(clerkC, () => ledgerCounts())).resolves.toEqual({
    accounts: 0,
    transactions: 0,
  });
});

test("ledger reads require a signed-in user", async () => {
  await expect(ledgerCounts()).rejects.toMatchObject({
    digest: expect.stringContaining("/sign-in"),
  });
});
