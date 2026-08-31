import { expect, test } from "vitest";

import { EXPECTED, SEED_PERSONAS, SEED_TRANSACTIONS, SEED_USERS } from "@/db/seed/dataset";
import { seedDataset } from "@/db/seed/seed";
import { ledgerCounts, listTransactions } from "@/lib/data/ledger";
import { withRequestScope } from "@/lib/db/client";
import { transactions } from "@/lib/db/schema";
import { withAuth } from "../harness/clerk";
import { adminDb } from "../harness/db";

test("ledger counts are exactly the signed-in user's, never anyone else's", async () => {
  await seedDataset(adminDb());

  for (const persona of SEED_PERSONAS) {
    await expect(withAuth(SEED_USERS[persona].clerkUserId, () => ledgerCounts())).resolves.toEqual({
      accounts: EXPECTED[persona].accounts,
      transactions: EXPECTED[persona].transactions,
    });
  }

  await expect(
    withRequestScope(SEED_USERS.neighbor.clerkUserId, (tx) => tx.select().from(transactions)),
  ).resolves.toHaveLength(EXPECTED.neighbor.transactions);
});

test("the transaction list is the caller's own ledger, newest first, carrying assignments", async () => {
  await seedDataset(adminDb());
  const mine = SEED_TRANSACTIONS.filter((t) => t.persona === "demo");

  const rows = await withAuth(SEED_USERS.demo.clerkUserId, () => listTransactions());
  expect(rows).toHaveLength(EXPECTED.demo.transactions);
  expect(rows.map((row) => row.date)).toEqual(mine.map((t) => t.date).sort().reverse());
  expect(rows.flatMap((row) => row.categoryId ?? []).sort()).toEqual(
    mine.flatMap((t) => t.categoryId ?? []).sort(),
  );

  const neighbor = await withAuth(SEED_USERS.neighbor.clerkUserId, () => listTransactions());
  expect(neighbor.map((row) => row.description)).toEqual(["ELECTRONICS EMPORIUM", "NEIGHBOR PAYCHECK"]);
});

test("ledger reads require a signed-in user", async () => {
  const signedIn = expect.objectContaining({ digest: expect.stringContaining("/sign-in") });
  await expect(ledgerCounts()).rejects.toEqual(signedIn);
  await expect(listTransactions()).rejects.toEqual(signedIn);
});
