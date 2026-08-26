import { asc, eq } from "drizzle-orm";
import { expect } from "vitest";

import { POST as exchange } from "@/app/api/plaid/exchange/route";
import { POST as syncRoute } from "@/app/api/connections/[connectionId]/sync/route";
import { connections, transactions } from "@/lib/db/schema";
import { fakeClerkUserId, withAuth } from "../harness/clerk";
import { adminDb } from "../harness/db";
import { mintSandboxItem, pushSyncUpdates, usd, type SandboxAccount, type SandboxTransaction } from "../harness/plaid";

export const CHECKING = "acct-checking";
export const CARD = "acct-card";

export const testAccounts = (): SandboxAccount[] => [
  { account_id: CHECKING, name: "Checking", official_name: null, mask: null, type: "depository", subtype: "checking", balances: usd(1000, 1000) },
  { account_id: CARD, name: "Card", official_name: null, mask: null, type: "credit", subtype: "credit card", balances: usd(null, 410, 2000) },
];

export const step = (
  backfillStatus: "in_progress" | "complete",
  added: number,
  rest: Partial<{ drained: boolean; modified: number; removed: number; skipped: number }> = {},
) => ({ backfillStatus, added, drained: true, modified: 0, removed: 0, skipped: 0, ...rest });

export const postExchange = (publicToken: string) =>
  exchange(
    new Request("http://localhost/api/plaid/exchange", {
      method: "POST",
      headers: { "content-type": "application/json", host: "localhost" },
      body: JSON.stringify({ publicToken }),
    }),
  );

export const postSync = (connectionId: string, headers: Record<string, string> = {}) =>
  syncRoute(
    new Request(`http://localhost/api/connections/${connectionId}/sync`, {
      method: "POST",
      headers: { host: "localhost", ...headers },
    }),
    { params: Promise.resolve({ connectionId }) },
  );

export async function connect(clerkUserId = fakeClerkUserId(), accounts = testAccounts()) {
  const minted = mintSandboxItem({ accounts });
  const response = await withAuth(clerkUserId, () => postExchange(minted.publicToken));
  expect(response.status).toBe(200);
  const body = await response.json();
  const accountId = new Map<string, string>(
    body.accounts.map((registered: { name: string; id: string }) => [
      registered.name === "Checking" ? CHECKING : CARD,
      registered.id,
    ]),
  );
  const connectionId = body.connection.id as string;
  const sync = (headers?: Record<string, string>) =>
    withAuth(clerkUserId, () => postSync(connectionId, headers));
  return { ...minted, clerkUserId, connectionId, accountId, body, sync };
}

export const ledgerRows = () =>
  adminDb()
    .select({
      accountId: transactions.accountId,
      amountMinor: transactions.amountMinor,
      currency: transactions.currency,
      date: transactions.date,
      description: transactions.description,
      merchant: transactions.merchant,
      status: transactions.status,
      source: transactions.source,
      sourceId: transactions.sourceId,
    })
    .from(transactions)
    .orderBy(asc(transactions.date));

export const expectStored = async (
  connectionId: string,
  backfillStatus: "in_progress" | "complete",
  syncCursor: string | null,
) => {
  const [row] = await adminDb()
    .select({ backfillStatus: connections.backfillStatus, syncCursor: connections.syncCursor })
    .from(connections)
    .where(eq(connections.id, connectionId));
  expect(row).toEqual({ backfillStatus, syncCursor });
};

export const rewind = (connectionId: string) =>
  adminDb().update(connections).set({ backfillStatus: "in_progress", syncCursor: null }).where(eq(connections.id, connectionId));

export const pushHistory = (accessToken: string, ...added: SandboxTransaction[]) =>
  pushSyncUpdates(accessToken, { added, updateStatus: "HISTORICAL_UPDATE_COMPLETE" });

export async function backfilled(clerkUserId = fakeClerkUserId(), ...history: SandboxTransaction[]) {
  const item = await connect(clerkUserId);
  pushHistory(item.accessToken, ...history);
  const response = await item.sync();
  expect(response.status).toBe(200);
  await expect(response.json()).resolves.toMatchObject({ backfillStatus: "complete" });
  return item;
}
