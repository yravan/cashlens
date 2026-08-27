import "server-only";
import { and, asc, eq, sql } from "drizzle-orm";

import { decryptCredential, encryptCredential, SecretString, UUID_PATTERN } from "@/lib/crypto/credentials";
import { requireUser } from "@/lib/data/users";
import { withRequestScope } from "@/lib/db/client";
import { connectionCredentials, connections } from "@/lib/db/schema";

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

type ConnectionUser = { id: string; clerkUserId: string };

const ownCredential = (connectionId: string, userId: string) =>
  and(
    eq(connectionCredentials.connectionId, connectionId),
    eq(connectionCredentials.userId, userId),
  );

const ownConnection = (connectionId: string, userId: string) =>
  and(eq(connections.id, connectionId), eq(connections.userId, userId));

export async function createConnection(input: NewConnection) {
  const user = await requireUser();
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
        status: "active",
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

export async function listConnections() {
  const user = await requireUser();
  return withRequestScope(user.clerkUserId, (tx) =>
    tx
      .select(safeShape)
      .from(connections)
      .where(eq(connections.userId, user.id))
      .orderBy(asc(connections.createdAt), asc(connections.id)),
  );
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
      .where(ownCredential(connectionId, user.id)),
  );
  if (!rows[0]) return null;
  return new SecretString(
    decryptCredential(rows[0].ciphertext, { userId: user.id, connectionId }),
  );
}

// The `As` variants take a server-derived user (the verified webhook
// item→owner mapping) instead of a session — never request input. `code` is
// always one of this codebase's own constants, never provider input verbatim.
export async function setProviderErrorAs(
  user: ConnectionUser,
  connectionId: string,
  code: string | null,
): Promise<void> {
  await withRequestScope(user.clerkUserId, (tx) =>
    tx
      .update(connections)
      .set({ providerError: code, updatedAt: sql`now()` })
      .where(and(ownConnection(connectionId, user.id), eq(connections.status, "active"))),
  );
}

async function disconnectConnectionAs(
  user: ConnectionUser,
  connectionId: string,
  providerError?: string,
): Promise<boolean> {
  if (!UUID_PATTERN.test(connectionId)) return false;
  return withRequestScope(user.clerkUserId, async (tx) => {
    await tx.delete(connectionCredentials).where(ownCredential(connectionId, user.id));
    const updated = await tx
      .update(connections)
      .set({ status: "disconnected", updatedAt: sql`now()`, ...(providerError && { providerError }) })
      .where(ownConnection(connectionId, user.id))
      .returning({ id: connections.id });
    return updated.length > 0;
  });
}

// The provider-side revocation: the item is dead at Plaid, so the credential
// goes now and the tombstone carries the reason. Imported data stays until the
// user chooses to purge it.
export const revokeConnectionAs = (user: ConnectionUser, connectionId: string) =>
  disconnectConnectionAs(user, connectionId, "USER_PERMISSION_REVOKED");

export async function disconnectConnection(connectionId: string): Promise<boolean> {
  return disconnectConnectionAs(await requireUser(), connectionId);
}
