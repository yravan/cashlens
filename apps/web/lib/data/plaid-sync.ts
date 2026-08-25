import "server-only";
import { and, eq, sql } from "drizzle-orm";

import { UUID_PATTERN } from "@/lib/crypto/credentials";
import { readConnectionCredential } from "@/lib/data/connections";
import { balanceRow, currencyOf, ProviderError, translated } from "@/lib/data/plaid";
import { requireUser } from "@/lib/data/users";
import { withRequestScope } from "@/lib/db/client";
import { accountBalances, accounts, connections, transactions } from "@/lib/db/schema";
import { toMinorUnits } from "@/lib/ledger/minor-units";
import {
  getItemAccounts,
  PlaidRequestError,
  syncTransactions,
  type Transaction,
} from "@/lib/plaid/client";

const PAGE_SIZE = 500;
const MAX_PAGES_PER_RUN = 20;
// A full run can carry 10k rows; Postgres binds at most 65535 parameters per statement.
const INSERT_CHUNK = 500;
const RESTARTS_ON_MUTATION = 2;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function isCalendarDate(date: string): boolean {
  const parsed = new Date(`${date}T00:00:00Z`);
  return DATE_PATTERN.test(date) && !Number.isNaN(+parsed) && parsed.toISOString().startsWith(date);
}

type BackfillStep = { backfillStatus: "in_progress" | "complete"; added: number };

// Plaid's positive means money left the account; the ledger stores the net-worth effect.
function ledgerRow(raw: Transaction, accountId: string, userId: string) {
  const currency = currencyOf(raw);
  const sourceId = raw.transaction_id;
  let amountMinor: number;
  try {
    amountMinor = -toMinorUnits(raw.amount, currency);
  } catch {
    throw new ProviderError(null);
  }
  if (!isCalendarDate(raw.date) || sourceId.length === 0 || sourceId.length > 256) {
    throw new ProviderError(null);
  }
  return {
    userId,
    accountId,
    amountMinor,
    currency,
    date: raw.date,
    description: raw.name.slice(0, 500),
    merchant: raw.merchant_name?.slice(0, 500) ?? null,
    status: raw.pending ? ("pending" as const) : ("posted" as const),
    source: "plaid" as const,
    sourceId,
  };
}

async function paginate(accessToken: string, origin: string | null) {
  for (let restarts = 0; ; restarts += 1) {
    try {
      const added: Transaction[] = [];
      let cursor = origin;
      for (let pages = 0; pages < MAX_PAGES_PER_RUN; pages += 1) {
        const page = await syncTransactions(accessToken, cursor, PAGE_SIZE);
        if (page.nextCursor.length > 512) throw new ProviderError(null);
        added.push(...page.added);
        cursor = page.nextCursor || cursor;
        if (!page.hasMore) return { added, cursor, complete: page.historicalUpdateComplete };
      }
      return { added, cursor, complete: false };
    } catch (error) {
      const mutated =
        error instanceof PlaidRequestError &&
        error.errorCode === "TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION";
      if (!mutated || restarts >= RESTARTS_ON_MUTATION) throw error;
    }
  }
}

export async function advanceBackfill(connectionId: string): Promise<BackfillStep | null> {
  const user = await requireUser();
  if (!UUID_PATTERN.test(connectionId)) return null;

  const owned = and(eq(connections.id, connectionId), eq(connections.userId, user.id));
  const [connection] = await withRequestScope(user.clerkUserId, (tx) =>
    tx
      .select({ backfillStatus: connections.backfillStatus, syncCursor: connections.syncCursor })
      .from(connections)
      .where(and(owned, eq(connections.provider, "plaid"), eq(connections.status, "active"))),
  );
  if (!connection) return null;
  if (connection.backfillStatus === "complete") return { backfillStatus: "complete", added: 0 };

  const credential = await readConnectionCredential(connectionId);
  if (!credential) return null;

  const registered = await withRequestScope(user.clerkUserId, (tx) =>
    tx
      .select({ id: accounts.id, sourceId: accounts.sourceId })
      .from(accounts)
      .where(
        and(
          eq(accounts.connectionId, connectionId),
          eq(accounts.userId, user.id),
          eq(accounts.source, "plaid"),
        ),
      ),
  );
  const bySourceId = new Map(registered.map((account) => [account.sourceId, account.id]));

  const run = await paginate(credential.expose(), connection.syncCursor).catch(translated);
  const rows = run.added.flatMap((raw) => {
    const accountId = bySourceId.get(raw.account_id);
    return accountId ? [ledgerRow(raw, accountId, user.id)] : [];
  });
  const refreshed = run.complete
    ? await getItemAccounts(credential.expose()).catch(translated)
    : null;
  const backfillStatus = run.complete ? "complete" : "in_progress";

  const added = await withRequestScope(user.clerkUserId, async (tx) => {
    let inserted = 0;
    for (let at = 0; at < rows.length; at += INSERT_CHUNK) {
      const chunk = await tx
        .insert(transactions)
        .values(rows.slice(at, at + INSERT_CHUNK))
        .onConflictDoNothing();
      inserted += chunk.rowCount ?? 0;
    }

    if (refreshed) {
      const asOf = new Date();
      const balanceRows = refreshed.accounts.flatMap((account) => {
        const accountId = bySourceId.get(account.account_id);
        return accountId ? balanceRow(accountId, user.id, account.balances, asOf) : [];
      });
      if (balanceRows.length > 0) {
        await tx
          .insert(accountBalances)
          .values(balanceRows)
          .onConflictDoUpdate({
            target: accountBalances.accountId,
            set: {
              availableMinor: sql`excluded.available_minor`,
              currentMinor: sql`excluded.current_minor`,
              limitMinor: sql`excluded.limit_minor`,
              asOf: sql`excluded.as_of`,
            },
          });
      }
    }

    await tx
      .update(connections)
      .set({ syncCursor: run.cursor, backfillStatus, updatedAt: sql`now()` })
      .where(owned);
    return inserted;
  });

  return { backfillStatus, added };
}
