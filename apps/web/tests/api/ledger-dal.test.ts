import { expect, test } from "vitest";

import { EXPECTED, SEED_PERSONAS, SEED_USERS } from "@/db/seed/dataset";
import { seedDataset } from "@/db/seed/seed";
import { ledgerCounts } from "@/lib/data/ledger";
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

test("ledger reads require a signed-in user", async () => {
  await expect(ledgerCounts()).rejects.toMatchObject({
    digest: expect.stringContaining("/sign-in"),
  });
});
