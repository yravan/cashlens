import "server-only";
import { and, eq, inArray, lt, or, sql } from "drizzle-orm";

import { UUID_PATTERN } from "@/lib/crypto/credentials";
import { readConnectionCredentialAs } from "@/lib/data/connections";
import { balanceRow, currencyOf, ProviderError, translated } from "@/lib/data/plaid";
import { requireUser } from "@/lib/data/users";
import { withRequestScope } from "@/lib/db/client";
import { accountBalances, accounts, connections, transactions } from "@/lib/db/schema";
import { toMinorUnits } from "@/lib/ledger/minor-units";
import { errorClass, logEvent } from "@/lib/log";
import {
  getFreshBalances,
  PlaidRequestError,
  syncTransactions,
  type RemovedTransaction,
  type Transaction,
} from "@/lib/plaid/client";
import type { SecretString } from "@/lib/crypto/credentials";

const PAGE_SIZE = 500;
const MAX_PAGES_PER_RUN = 20;
// A full run can carry 10k rows; Postgres binds at most 65535 parameters per statement.
const INSERT_CHUNK = 500;
const RESTARTS_ON_MUTATION = 2;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
// The grace window keeps the page-load resumer off backfills the connect flow
// is still actively driving.
const STALE_AFTER_MS = 6 * 60 * 60 * 1000;
const RESUME_GRACE_MS = 2 * 60 * 1000;

function isCalendarDate(date: string): boolean {
  const parsed = new Date(`${date}T00:00:00Z`);
  return DATE_PATTERN.test(date) && !Number.isNaN(+parsed) && parsed.toISOString().startsWith(date);
}

export type SyncStep = {
  backfillStatus: "in_progress" | "complete";
  drained: boolean;
  added: number;
  modified: number;
  removed: number;
  skipped: number;
};

type SyncUser = { id: string; clerkUserId: string };
type RegisteredAccount = { id: string; currency: string };

// Plaid's positive means money left the account; the ledger stores the net-worth effect.
function ledgerRow(raw: Transaction, account: RegisteredAccount, userId: string) {
  const currency = currencyOf(raw, account.currency);
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
    accountId: account.id,
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

type LedgerRow = ReturnType<typeof ledgerRow>;

async function paginate(accessToken: string, origin: string | null) {
  // One page budget across restarts: a mutation replays from the origin cursor
  // and keeps spending it, so a churning item cannot multiply a run's cost.
  let restarts = 0;
  for (let pages = 0; ; ) {
    try {
      const added: Transaction[] = [];
      const modified: Transaction[] = [];
      const removed: RemovedTransaction[] = [];
      let cursor = origin;
      for (; pages < MAX_PAGES_PER_RUN; pages += 1) {
        const page = await syncTransactions(accessToken, cursor, PAGE_SIZE);
        if (page.nextCursor.length > 512) throw new ProviderError(null);
        added.push(...page.added);
        modified.push(...page.modified);
        removed.push(...page.removed);
        cursor = page.nextCursor || cursor;
        if (!page.hasMore) {
          return { added, modified, removed, cursor, drained: true, updateStatus: page.updateStatus };
        }
      }
      return { added, modified, removed, cursor, drained: false, updateStatus: "pending" as const };
    } catch (error) {
      const mutated =
        error instanceof PlaidRequestError &&
        error.errorCode === "TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION";
      restarts += 1;
      if (!mutated || restarts > RESTARTS_ON_MUTATION) throw error;
    }
  }
}

const errorFields = (error: unknown) => ({
  errorClass: errorClass(error),
  plaidErrorCode: error instanceof PlaidRequestError ? error.errorCode : null,
});

const upsertLast = (rows: LedgerRow[]) =>
  [...new Map(rows.map((row) => [`${row.accountId}:${row.sourceId}`, row])).values()];

export async function advanceSync(connectionId: string): Promise<SyncStep | null> {
  const user = await requireUser();
  return advanceSyncFor(user, connectionId);
}

async function advanceSyncFor(user: SyncUser, connectionId: string): Promise<SyncStep | null> {
  if (!UUID_PATTERN.test(connectionId)) return null;

  const owned = and(eq(connections.id, connectionId), eq(connections.userId, user.id));
  const [connection] = await withRequestScope(user.clerkUserId, (tx) =>
    tx
      .select({ backfillStatus: connections.backfillStatus, syncCursor: connections.syncCursor })
      .from(connections)
      .where(and(owned, eq(connections.provider, "plaid"), eq(connections.status, "active"))),
  );
  if (!connection) return null;

  const credential = await readConnectionCredentialAs(user, connectionId);
  if (!credential) return null;

  const registered = await withRequestScope(user.clerkUserId, (tx) =>
    tx
      .select({ id: accounts.id, sourceId: accounts.sourceId, currency: accounts.currency })
      .from(accounts)
      .where(
        and(
          eq(accounts.connectionId, connectionId),
          eq(accounts.userId, user.id),
          eq(accounts.source, "plaid"),
        ),
      ),
  );
  const bySourceId = new Map<string | null, RegisteredAccount>(
    registered.map((account) => [account.sourceId, { id: account.id, currency: account.currency }]),
  );

  const run = await paginate(credential.expose(), connection.syncCursor).catch(
    (error: unknown) => {
      logEvent("plaid_sync.run_failed", { connectionId, ...errorFields(error) });
      return translated(error);
    },
  );

  let malformed = 0;
  let unregistered = 0;
  const prepared = (raws: Transaction[]) => {
    const rows: LedgerRow[] = [];
    for (const raw of raws) {
      const account = bySourceId.get(raw.account_id);
      if (!account) {
        unregistered += 1;
        continue;
      }
      try {
        rows.push(ledgerRow(raw, account, user.id));
      } catch {
        malformed += 1;
      }
    }
    return rows;
  };
  const addedRows = prepared(run.added);
  const modifiedRows = upsertLast(prepared(run.modified));
  const removedByAccount = new Map<string, string[]>();
  for (const gone of run.removed) {
    const account = bySourceId.get(gone.account_id);
    if (!account) {
      unregistered += 1;
      continue;
    }
    const ids = removedByAccount.get(account.id);
    if (ids) ids.push(gone.transaction_id);
    else removedByAccount.set(account.id, [gone.transaction_id]);
  }

  const previous = connection.backfillStatus;
  const backfillStatus =
    previous === "complete" || (run.drained && run.updateStatus === "complete")
      ? "complete"
      : "in_progress";
  if (run.updateStatus === "unknown") {
    logEvent("plaid_sync.update_status_unknown", { connectionId });
  }

  const counts = { added: 0, modified: 0, removed: 0 };
  // Compare-and-set on the cursor: the winner's UPDATE also locks the row, so
  // an overlapping run blocks here, sees the moved cursor, and commits nothing.
  const committed = await withRequestScope(user.clerkUserId, async (tx) => {
    const cas = await tx
      .update(connections)
      .set({ syncCursor: run.cursor, backfillStatus, updatedAt: sql`now()` })
      .where(
        and(owned, sql`${connections.syncCursor} is not distinct from ${connection.syncCursor}`),
      );
    if ((cas.rowCount ?? 0) === 0) return false;

    for (let at = 0; at < addedRows.length; at += INSERT_CHUNK) {
      const chunk = await tx
        .insert(transactions)
        .values(addedRows.slice(at, at + INSERT_CHUNK))
        .onConflictDoNothing();
      counts.added += chunk.rowCount ?? 0;
    }
    for (let at = 0; at < modifiedRows.length; at += INSERT_CHUNK) {
      const chunk = await tx
        .insert(transactions)
        .values(modifiedRows.slice(at, at + INSERT_CHUNK))
        .onConflictDoUpdate({
          target: [transactions.accountId, transactions.source, transactions.sourceId],
          targetWhere: sql`source_id is not null`,
          set: {
            amountMinor: sql`excluded.amount_minor`,
            currency: sql`excluded.currency`,
            date: sql`excluded.date`,
            description: sql`excluded.description`,
            merchant: sql`excluded.merchant`,
            status: sql`excluded.status`,
            updatedAt: sql`now()`,
          },
        });
      counts.modified += chunk.rowCount ?? 0;
    }
    for (const [accountId, sourceIds] of removedByAccount) {
      for (let at = 0; at < sourceIds.length; at += INSERT_CHUNK) {
        const chunk = await tx
          .delete(transactions)
          .where(
            and(
              eq(transactions.userId, user.id),
              eq(transactions.accountId, accountId),
              eq(transactions.source, "plaid"),
              inArray(transactions.sourceId, sourceIds.slice(at, at + INSERT_CHUNK)),
            ),
          );
        counts.removed += chunk.rowCount ?? 0;
      }
    }
    return true;
  });

  if (!committed) {
    logEvent("plaid_sync.lost_race", { connectionId });
    const [current] = await withRequestScope(user.clerkUserId, (tx) =>
      tx.select({ backfillStatus: connections.backfillStatus }).from(connections).where(owned),
    );
    const nothing = { drained: false, added: 0, modified: 0, removed: 0, skipped: 0 };
    return { backfillStatus: current?.backfillStatus ?? backfillStatus, ...nothing };
  }

  const activity = counts.added + counts.modified + counts.removed;
  if (run.drained && (activity > 0 || backfillStatus !== previous)) {
    await refreshBalances(user, connectionId, credential, bySourceId);
  }

  logEvent("plaid_sync.run", {
    connectionId,
    backfillStatus,
    drained: run.drained,
    ...counts,
    skippedMalformed: malformed,
    skippedUnregistered: unregistered,
  });
  return { backfillStatus, drained: run.drained, ...counts, skipped: malformed + unregistered };
}

async function refreshBalances(
  user: SyncUser,
  connectionId: string,
  credential: SecretString,
  bySourceId: Map<string | null, RegisteredAccount>,
) {
  try {
    const fresh = await getFreshBalances(credential.expose());
    const asOf = new Date();
    const rows = fresh.flatMap((account) => {
      const registered = bySourceId.get(account.account_id);
      return registered
        ? balanceRow(registered.id, user.id, account.balances, asOf, registered.currency)
        : [];
    });
    if (rows.length === 0) return;
    await withRequestScope(user.clerkUserId, (tx) =>
      tx
        .insert(accountBalances)
        .values(rows)
        .onConflictDoUpdate({
          target: accountBalances.accountId,
          set: {
            availableMinor: sql`excluded.available_minor`,
            currentMinor: sql`excluded.current_minor`,
            limitMinor: sql`excluded.limit_minor`,
            asOf: sql`excluded.as_of`,
          },
        }),
    );
  } catch (error) {
    logEvent("plaid_sync.balance_refresh_failed", { connectionId, ...errorFields(error) });
  }
}

export async function listResumableSyncs(): Promise<string[]> {
  const user = await requireUser();
  const now = Date.now();
  const rows = await withRequestScope(user.clerkUserId, (tx) =>
    tx
      .select({ id: connections.id })
      .from(connections)
      .where(
        and(
          eq(connections.userId, user.id),
          eq(connections.provider, "plaid"),
          eq(connections.status, "active"),
          or(
            and(
              eq(connections.backfillStatus, "in_progress"),
              lt(connections.updatedAt, new Date(now - RESUME_GRACE_MS)),
            ),
            lt(connections.updatedAt, new Date(now - STALE_AFTER_MS)),
          ),
        ),
      ),
  );
  return rows.map((row) => row.id);
}
