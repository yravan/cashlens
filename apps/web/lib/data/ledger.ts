import "server-only";
import { count, eq } from "drizzle-orm";

import { requireUser } from "@/lib/data/users";
import { withRequestScope } from "@/lib/db/client";
import { accounts, transactions } from "@/lib/db/schema";

export async function ledgerCounts() {
  const user = await requireUser();
  return withRequestScope(user.clerkUserId, async (tx) => {
    const [account] = await tx
      .select({ n: count() })
      .from(accounts)
      .where(eq(accounts.userId, user.id));
    const [transaction] = await tx
      .select({ n: count() })
      .from(transactions)
      .where(eq(transactions.userId, user.id));
    return { accounts: account.n, transactions: transaction.n };
  });
}
