import "server-only";
import { and, eq, sql } from "drizzle-orm";

import { UUID_PATTERN } from "@/lib/crypto/credentials";
import { repairTransfers } from "@/lib/data/manual-transactions";
import { requireUser } from "@/lib/data/users";
import { withRequestScope } from "@/lib/db/client";
import { accountBalances, accounts } from "@/lib/db/schema";
import {
  offlineBalanceMinor,
  type OfflineAccountInput,
  type OfflineBalanceInput,
} from "@/lib/ledger/offline-accounts";

export type OfflineAccountError = "invalid_request" | "account_not_found";
export type OfflineAccountResult = { accountId: string } | { error: OfflineAccountError };

const manualAccount = (accountId: string, userId: string) =>
  and(eq(accounts.id, accountId), eq(accounts.userId, userId), eq(accounts.source, "manual"));

export async function createOfflineAccount(
  input: OfflineAccountInput,
): Promise<OfflineAccountResult> {
  const user = await requireUser();
  const currentMinor = offlineBalanceMinor(input.balance, input.currency);
  if (currentMinor === null) return { error: "invalid_request" };

  return withRequestScope(user.clerkUserId, async (tx) => {
    const [created] = await tx
      .insert(accounts)
      .values({
        userId: user.id,
        connectionId: null,
        name: input.name,
        type: input.type,
        subtype: null,
        mask: null,
        currency: input.currency,
        source: "manual",
        sourceId: null,
      })
      .returning({ id: accounts.id });
    if (!created) throw new Error("offline account insert returned no row");

    await tx.insert(accountBalances).values({
      accountId: created.id,
      userId: user.id,
      availableMinor: null,
      currentMinor,
      limitMinor: null,
      asOf: sql`now()`,
      reportedOn: input.reportedOn,
    });
    return { accountId: created.id };
  });
}

export async function updateOfflineBalance(
  accountId: string,
  input: OfflineBalanceInput,
): Promise<OfflineAccountResult> {
  const user = await requireUser();
  if (!UUID_PATTERN.test(accountId)) return { error: "account_not_found" };

  return withRequestScope(user.clerkUserId, async (tx) => {
    const [account] = await tx
      .select({ id: accounts.id, currency: accounts.currency })
      .from(accounts)
      .where(manualAccount(accountId, user.id));
    if (!account) return { error: "account_not_found" as const };

    const currentMinor = offlineBalanceMinor(input.balance, account.currency);
    if (currentMinor === null) return { error: "invalid_request" as const };

    const anchor = {
      availableMinor: null,
      currentMinor,
      limitMinor: null,
      asOf: sql`now()`,
      reportedOn: input.reportedOn,
    };
    await tx
      .insert(accountBalances)
      .values({ accountId: account.id, userId: user.id, ...anchor })
      .onConflictDoUpdate({ target: accountBalances.accountId, set: anchor });
    return { accountId: account.id };
  });
}

export async function deleteOfflineAccount(accountId: string): Promise<OfflineAccountResult> {
  const user = await requireUser();
  if (!UUID_PATTERN.test(accountId)) return { error: "account_not_found" };

  const result = await withRequestScope(user.clerkUserId, async (tx) => {
    const [deleted] = await tx
      .delete(accounts)
      .where(manualAccount(accountId, user.id))
      .returning({ id: accounts.id });
    return deleted ? { accountId: deleted.id } : { error: "account_not_found" as const };
  });

  if (!("error" in result)) await repairTransfers(user, "delete_offline_account");
  return result;
}
