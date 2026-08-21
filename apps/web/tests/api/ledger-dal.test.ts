import { expect, test } from "vitest";

import { ledgerCounts } from "@/lib/data/ledger";
import { requireUser } from "@/lib/data/users";
import { withRequestScope } from "@/lib/db/client";
import { accounts, transactions } from "@/lib/db/schema";
import { fakeClerkUserId, withAuth } from "../harness/clerk";
import { adminDb } from "../harness/db";

const usd = { currency: "USD", source: "manual" } as const;
const posted = { ...usd, status: "posted" } as const;

async function provision(clerkUserId: string): Promise<string> {
  return (await withAuth(clerkUserId, () => requireUser())).id;
}

test("ledger counts are exactly the signed-in user's, never anyone else's", async () => {
  const clerkA = fakeClerkUserId();
  const clerkB = fakeClerkUserId();
  const clerkC = fakeClerkUserId();
  const [userA, userB] = await Promise.all([provision(clerkA), provision(clerkB)]);
  await provision(clerkC);

  const [a1, a2, b1] = await adminDb()
    .insert(accounts)
    .values([
      { ...usd, userId: userA, name: "A Checking", type: "depository" },
      { ...usd, userId: userA, name: "A Card", type: "depository" },
      { ...usd, userId: userB, name: "B Savings", type: "depository" },
    ])
    .returning({ id: accounts.id });

  await adminDb()
    .insert(transactions)
    .values([
      { ...posted, userId: userA, accountId: a1.id, amountMinor: -1999, date: "2026-02-02", description: "GROCERY MART" },
      { ...posted, userId: userA, accountId: a1.id, amountMinor: -750, date: "2026-02-03", description: "COFFEE" },
      { ...posted, userId: userA, accountId: a2.id, amountMinor: -4500, date: "2026-02-03", description: "CASH LUNCH" },
      { ...posted, userId: userB, accountId: b1.id, amountMinor: 100000, date: "2026-02-04", description: "TRANSFER IN" },
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

  await expect(
    withRequestScope(clerkB, (tx) => tx.select().from(transactions)),
  ).resolves.toHaveLength(1);
});

test("ledger reads require a signed-in user", async () => {
  await expect(ledgerCounts()).rejects.toMatchObject({
    digest: expect.stringContaining("/sign-in"),
  });
});
