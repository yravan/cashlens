import "server-only";
import { sql } from "drizzle-orm";

import { db } from "./client";

export type ScopedTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

// All user-data access goes through here: the transaction-local setting is
// what the RLS policies check, so queries outside a scope see zero rows.
export async function withRequestScope<T>(
  clerkUserId: string,
  fn: (tx: ScopedTx) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select set_config('app.clerk_user_id', ${clerkUserId}, true)`,
    );
    return fn(tx);
  });
}
