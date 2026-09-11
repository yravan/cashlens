import "server-only";
import { and, asc, count, countDistinct, eq, inArray, lte, sql } from "drizzle-orm";

import { decryptCredential, encryptCredential, SecretString, UUID_PATTERN } from "@/lib/crypto/credentials";
import { requireUser } from "@/lib/data/users";
import { withRequestScope } from "@/lib/db/client";
import { accounts, connectionCredentials, connections, transactions } from "@/lib/db/schema";

const safeShape = {
  id: connections.id,
  provider: connections.provider,
  institutionId: connections.institutionId,
  institutionName: connections.institutionName,
  status: connections.status,
  backfillStatus: connections.backfillStatus,
  providerError: connections.providerError,
  createdAt: connections.createdAt,
};

type NewConnection = {
  provider: "plaid";
  credential: string;
  providerItemId?: string;
  institutionId?: string;
  institutionName?: string;
  webhookUrl?: string;
};

function boundedText(value: string | undefined, name: string): string | undefined {
  if (value !== undefined && (value.length === 0 || value.length > 512)) {
    throw new Error(`${name} must be 1 to 512 characters`);
  }
  return value;
}

export type ConnectionUser = { id: string; clerkUserId: string };

const ownCredential = (connectionId: string, userId: string) =>
  and(
    eq(connectionCredentials.connectionId, connectionId),
    eq(connectionCredentials.userId, userId),
  );

const ownConnection = (connectionId: string, userId: string) =>
  and(eq(connections.id, connectionId), eq(connections.userId, userId));

export async function createConnectionAs(
  user: ConnectionUser,
  input: NewConnection,
  status: "active" | "provisioning" = "active",
) {
  return withRequestScope(user.clerkUserId, async (tx) => {
    const [connection] = await tx
      .insert(connections)
      .values({
        userId: user.id,
        provider: input.provider,
        providerItemId: boundedText(input.providerItemId, "providerItemId"),
        institutionId: boundedText(input.institutionId, "institutionId"),
        institutionName: boundedText(input.institutionName, "institutionName"),
        webhookUrl: boundedText(input.webhookUrl, "webhookUrl"),
        status,
      })
      .returning(safeShape);
    await tx.insert(connectionCredentials).values({
      connectionId: connection.id,
      userId: user.id,
      ciphertext: encryptCredential(input.credential, {
        userId: user.id,
        connectionId: connection.id,
      }),
    });
    return connection;
  });
}

export async function createConnection(input: NewConnection) {
  return createConnectionAs(await requireUser(), input);
}

export async function listConnections() {
  const user = await requireUser();
  const rows = await withRequestScope(user.clerkUserId, (tx) =>
    tx
      .select(safeShape)
      .from(connections)
      .where(
        and(
          eq(connections.userId, user.id),
          inArray(connections.status, ["active", "disconnected"]),
        ),
      )
      .orderBy(asc(connections.createdAt), asc(connections.id)),
  );
  return rows.map((row) => {
    if (row.status !== "active" && row.status !== "disconnected") {
      throw new Error("Internal connection status escaped the visible query");
    }
    return { ...row, status: row.status };
  });
}

export async function listConnectionsWithStats() {
  const user = await requireUser();
  const [listed, stats] = await Promise.all([
    listConnections(),
    withRequestScope(user.clerkUserId, (tx) =>
      tx
        .select({
          connectionId: accounts.connectionId,
          accounts: countDistinct(accounts.id),
          transactions: count(transactions.id),
        })
        .from(accounts)
        .leftJoin(transactions, eq(transactions.accountId, accounts.id))
        .where(eq(accounts.userId, user.id))
        .groupBy(accounts.connectionId),
    ),
  ]);
  const byConnection = new Map(stats.map((row) => [row.connectionId, row]));
  return listed.map((connection) => ({
    ...connection,
    accounts: byConnection.get(connection.id)?.accounts ?? 0,
    transactions: byConnection.get(connection.id)?.transactions ?? 0,
  }));
}

export async function readConnectionCredential(
  connectionId: string,
): Promise<SecretString | null> {
  return readConnectionCredentialAs(await requireUser(), connectionId);
}

// The ciphertext's AAD binds it to (userId, connectionId), so a mismatched user
// fails decryption regardless of what RLS let through.
export async function readConnectionCredentialAs(
  user: ConnectionUser,
  connectionId: string,
): Promise<SecretString | null> {
  if (!UUID_PATTERN.test(connectionId)) return null;
  const rows = await withRequestScope(user.clerkUserId, (tx) =>
    tx
      .select({ ciphertext: connectionCredentials.ciphertext })
      .from(connectionCredentials)
      .innerJoin(
        connections,
        and(
          eq(connections.id, connectionCredentials.connectionId),
          eq(connections.userId, connectionCredentials.userId),
        ),
      )
      .where(
        and(
          ownCredential(connectionId, user.id),
          ownConnection(connectionId, user.id),
          eq(connections.status, "active"),
        ),
      ),
  );
  if (!rows[0]) return null;
  return new SecretString(
    decryptCredential(rows[0].ciphertext, { userId: user.id, connectionId }),
  );
}

const cleanupStatuses: Array<"provisioning" | "cleanup_required"> = [
  "provisioning",
  "cleanup_required",
];

export async function markConnectionCleanupAs(
  user: ConnectionUser,
  connectionId: string,
): Promise<void> {
  await withRequestScope(user.clerkUserId, (tx) =>
    tx
      .update(connections)
      .set({ status: "cleanup_required", updatedAt: sql`now()` })
      .where(and(ownConnection(connectionId, user.id), eq(connections.status, "provisioning"))),
  );
}

export async function completeConnectionCleanupAs(
  user: ConnectionUser,
  connectionId: string,
): Promise<boolean> {
  return withRequestScope(user.clerkUserId, async (tx) => {
    const updated = await tx
      .update(connections)
      .set({ status: "disconnected", updatedAt: sql`now()` })
      .where(
        and(
          ownConnection(connectionId, user.id),
          inArray(connections.status, cleanupStatuses),
        ),
      )
      .returning({ id: connections.id });
    if (updated.length === 0) return false;
    await tx.delete(connectionCredentials).where(ownCredential(connectionId, user.id));
    return true;
  });
}

export const PLAID_CLEANUP_GRACE_MS = 2 * 60 * 1000;

const cleanupEligibleBefore = () => new Date(Date.now() - PLAID_CLEANUP_GRACE_MS);

export async function listPlaidCleanupIds(): Promise<string[]> {
  const user = await requireUser();
  const rows = await withRequestScope(user.clerkUserId, (tx) =>
    tx
      .select({ id: connections.id })
      .from(connections)
      .where(
        and(
          eq(connections.userId, user.id),
          eq(connections.provider, "plaid"),
          inArray(connections.status, cleanupStatuses),
          lte(connections.updatedAt, cleanupEligibleBefore()),
        ),
      )
      .orderBy(asc(connections.updatedAt), asc(connections.id)),
  );
  return rows.map(({ id }) => id);
}

export async function claimPlaidCleanupAs(
  user: ConnectionUser,
  connectionId: string,
): Promise<SecretString | null> {
  if (!UUID_PATTERN.test(connectionId)) return null;
  return withRequestScope(user.clerkUserId, async (tx) => {
    const [claimed] = await tx
      .update(connections)
      .set({ status: "cleanup_required", updatedAt: sql`now()` })
      .where(
        and(
          ownConnection(connectionId, user.id),
          eq(connections.provider, "plaid"),
          inArray(connections.status, cleanupStatuses),
          lte(connections.updatedAt, cleanupEligibleBefore()),
        ),
      )
      .returning({ id: connections.id });
    if (!claimed) return null;
    const [credential] = await tx
      .select({ ciphertext: connectionCredentials.ciphertext })
      .from(connectionCredentials)
      .where(ownCredential(connectionId, user.id));
    if (!credential) throw new Error("Plaid cleanup credential is missing");
    return new SecretString(
      decryptCredential(credential.ciphertext, { userId: user.id, connectionId }),
    );
  });
}

// The `As` variants take a server-derived user (the verified webhook
// item→owner mapping) instead of a session — never request input. `code` is
// always one of this codebase's own constants, never provider input verbatim.
export async function setProviderErrorAs(
  user: ConnectionUser,
  connectionId: string,
  code: string | null,
): Promise<boolean> {
  const updated = await withRequestScope(user.clerkUserId, (tx) =>
    tx
      .update(connections)
      .set({ providerError: code, updatedAt: sql`now()` })
      .where(and(ownConnection(connectionId, user.id), eq(connections.status, "active")))
      .returning({ id: connections.id }),
  );
  return updated.length > 0;
}

export type DisconnectResult = { purgedAccounts: number };

// Local state only — the provider-side /item/remove must already have succeeded
// or been deliberately skipped (lib/data/plaid.ts orchestrates). Purge deletes
// the connection's accounts; transactions and balances follow through the
// user-scoped composite-FK cascades.
async function disconnectConnectionAs(
  user: ConnectionUser,
  connectionId: string,
  { purge = false, providerError }: { purge?: boolean; providerError?: string } = {},
): Promise<DisconnectResult | null> {
  if (!UUID_PATTERN.test(connectionId)) return null;
  return withRequestScope(user.clerkUserId, async (tx) => {
    const updated = await tx
      .update(connections)
      .set({ status: "disconnected", updatedAt: sql`now()`, ...(providerError && { providerError }) })
      .where(
        and(
          ownConnection(connectionId, user.id),
          inArray(connections.status, ["active", "disconnected"]),
        ),
      )
      .returning({ id: connections.id });
    if (updated.length === 0) return null;
    await tx.delete(connectionCredentials).where(ownCredential(connectionId, user.id));
    if (!purge) return { purgedAccounts: 0 };
    const purged = await tx
      .delete(accounts)
      .where(and(eq(accounts.connectionId, connectionId), eq(accounts.userId, user.id)))
      .returning({ id: accounts.id });
    return { purgedAccounts: purged.length };
  });
}

// The provider-side revocation: the item is dead at Plaid, so the credential
// goes now and the tombstone carries the reason. Imported data stays until the
// user chooses to purge it.
export const revokeConnectionAs = (user: ConnectionUser, connectionId: string) =>
  disconnectConnectionAs(user, connectionId, { providerError: "USER_PERMISSION_REVOKED" });

export const disconnectConnection = async (
  connectionId: string,
  options: { purge?: boolean } = {},
) => disconnectConnectionAs(await requireUser(), connectionId, options);
