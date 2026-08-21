import { inspect } from "node:util";
import { eq, sql } from "drizzle-orm";
import { expect, test } from "vitest";

import {
  createConnection,
  disconnectConnection,
  listConnections,
  readConnectionCredential,
} from "@/lib/data/connections";
import { withRequestScope } from "@/lib/db/client";
import { connectionCredentials, connections } from "@/lib/db/schema";
import { fakeClerkUserId, withAuth } from "../harness/clerk";
import { adminDb } from "../harness/db";

const TOKEN_A = "access-sandbox-11111111-aaaa-4bbb-8ccc-222222222222";
const TOKEN_B = "access-sandbox-33333333-dddd-4eee-8fff-444444444444";
const SAFE_KEYS = ["createdAt", "id", "institutionId", "institutionName", "provider", "status"];

const connect = (credential: string) =>
  createConnection({
    provider: "plaid",
    credential,
    institutionId: "ins_109508",
    institutionName: "First Platypus Bank",
  });

function pgCode(error: unknown): string | undefined {
  for (
    let cursor = error as { code?: string; cause?: unknown } | undefined;
    cursor;
    cursor = cursor.cause as { code?: string; cause?: unknown } | undefined
  ) {
    if (cursor.code) return cursor.code;
  }
  return undefined;
}

test("store → list → read → disconnect lifecycle, all scoped to the signed-in user", async () => {
  const clerkUserId = fakeClerkUserId();
  const created = await withAuth(clerkUserId, () => connect(TOKEN_A));
  expect(Object.keys(created).sort()).toEqual(SAFE_KEYS);
  expect(created.status).toBe("active");

  const listed = await withAuth(clerkUserId, () => listConnections());
  expect(listed).toEqual([created]);

  const secret = await withAuth(clerkUserId, () => readConnectionCredential(created.id));
  expect(secret?.expose()).toBe(TOKEN_A);

  expect(await withAuth(clerkUserId, () => disconnectConnection(created.id))).toBe(true);
  expect(await adminDb().$count(connectionCredentials)).toBe(0);
  const [after] = await adminDb().select().from(connections);
  expect(after.status).toBe("disconnected");
  expect(await withAuth(clerkUserId, () => readConnectionCredential(created.id))).toBeNull();

  expect(await withAuth(clerkUserId, () => disconnectConnection(created.id))).toBe(true);
  expect(await withAuth(clerkUserId, () => listConnections())).toMatchObject([
    { id: created.id, status: "disconnected" },
  ]);
});

test("the credential is encrypted at rest and absent from every readable surface", async () => {
  const clerkUserId = fakeClerkUserId();
  const created = await withAuth(clerkUserId, () => connect(TOKEN_A));

  const [stored] = await adminDb().select().from(connectionCredentials);
  expect(stored.ciphertext).toMatch(/^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  expect(JSON.stringify(stored)).not.toContain(TOKEN_A);

  const listed = await withAuth(clerkUserId, () => listConnections());
  const serialized = JSON.stringify({ created, listed });
  expect(serialized).not.toContain(TOKEN_A);
  expect(serialized).not.toContain(stored.ciphertext);
  expect(serialized.toLowerCase()).not.toContain("ciphertext");

  const secret = await withAuth(clerkUserId, () => readConnectionCredential(created.id));
  expect(() => JSON.stringify(secret)).toThrow();
  expect(inspect(secret)).not.toContain(TOKEN_A);
});

test("user B can never list, read, or disconnect user A's connection", async () => {
  const clerkA = fakeClerkUserId();
  const clerkB = fakeClerkUserId();
  const created = await withAuth(clerkA, () => connect(TOKEN_A));

  expect(await withAuth(clerkB, () => listConnections())).toEqual([]);
  expect(await withAuth(clerkB, () => readConnectionCredential(created.id))).toBeNull();
  expect(await withAuth(clerkB, () => disconnectConnection(created.id))).toBe(false);

  expect(await adminDb().$count(connectionCredentials)).toBe(1);
  const [row] = await adminDb().select().from(connections);
  expect(row.status).toBe("active");
  const secret = await withAuth(clerkA, () => readConnectionCredential(created.id));
  expect(secret?.expose()).toBe(TOKEN_A);
});

test("a ciphertext transplanted onto another row decrypts for no one", async () => {
  const clerkA = fakeClerkUserId();
  const clerkB = fakeClerkUserId();
  const a = await withAuth(clerkA, () => connect(TOKEN_A));
  const b = await withAuth(clerkB, () => connect(TOKEN_B));

  const rows = await adminDb().select().from(connectionCredentials);
  const byConnection = new Map(rows.map((row) => [row.connectionId, row.ciphertext]));
  await adminDb()
    .update(connectionCredentials)
    .set({ ciphertext: byConnection.get(b.id)! })
    .where(eq(connectionCredentials.connectionId, a.id));
  await adminDb()
    .update(connectionCredentials)
    .set({ ciphertext: byConnection.get(a.id)! })
    .where(eq(connectionCredentials.connectionId, b.id));

  await expect(withAuth(clerkA, () => readConnectionCredential(a.id))).rejects.toThrow(
    "credential decryption failed",
  );
  await expect(withAuth(clerkB, () => readConnectionCredential(b.id))).rejects.toThrow(
    "credential decryption failed",
  );
});

test("a credential row can never attach to another user's connection", async () => {
  const clerkA = fakeClerkUserId();
  const clerkB = fakeClerkUserId();
  const a = await withAuth(clerkA, () => connect(TOKEN_A));
  await withAuth(clerkA, () => disconnectConnection(a.id));
  await withAuth(clerkB, () => listConnections());
  const users = await adminDb().execute<{ id: string; clerk_user_id: string }>(
    sql`select id, clerk_user_id from users`,
  );
  const bUserId = users.rows.find((row) => row.clerk_user_id === clerkB)!.id;

  await withAuth(clerkB, () =>
    expect(
      withRequestScope(clerkB, (tx) =>
        tx.insert(connectionCredentials).values({
          connectionId: a.id,
          userId: bUserId,
          ciphertext: "v1.k.a.a",
        }),
      ),
    ).rejects.toSatisfy((error) => pgCode(error) === "23503"),
  );
});

test("the app role cannot rewrite connection identity or delete connection rows", async () => {
  const clerkUserId = fakeClerkUserId();
  await withAuth(clerkUserId, () => connect(TOKEN_A));

  const asApp = (statement: ReturnType<typeof sql.raw>) =>
    withRequestScope(clerkUserId, (tx) => tx.execute(statement));

  await expect(asApp(sql.raw("update connections set institution_name = 'x'"))).rejects.toSatisfy(
    (error) => pgCode(error) === "42501",
  );
  await expect(asApp(sql.raw("update connection_credentials set ciphertext = 'x'"))).rejects.toSatisfy(
    (error) => pgCode(error) === "42501",
  );
  await expect(asApp(sql.raw("delete from connections"))).rejects.toSatisfy(
    (error) => pgCode(error) === "42501",
  );
});

test("every connection function requires a signed-in user", async () => {
  const signedOut = expect.objectContaining({ digest: expect.stringContaining("/sign-in") });
  await expect(connect(TOKEN_A)).rejects.toEqual(signedOut);
  await expect(listConnections()).rejects.toEqual(signedOut);
  await expect(readConnectionCredential("7c2e4f60-3a1b-4d2c-9e8f-000000000002")).rejects.toEqual(signedOut);
  await expect(disconnectConnection("7c2e4f60-3a1b-4d2c-9e8f-000000000002")).rejects.toEqual(signedOut);
});

test("garbage connection ids read as not-found, never as errors", async () => {
  const clerkUserId = fakeClerkUserId();
  expect(await withAuth(clerkUserId, () => readConnectionCredential("not-a-uuid"))).toBeNull();
  expect(await withAuth(clerkUserId, () => disconnectConnection("not-a-uuid"))).toBe(false);
});
