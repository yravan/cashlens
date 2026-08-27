import { eq } from "drizzle-orm";
import { beforeEach, expect, test } from "vitest";

import { POST as abandonRoute } from "@/app/api/plaid/abandon/route";
import { POST as disconnectRoute } from "@/app/api/connections/[connectionId]/disconnect/route";
import { POST as repairTokenRoute } from "@/app/api/connections/[connectionId]/repair-token/route";
import { POST as repairedRoute } from "@/app/api/connections/[connectionId]/repaired/route";
import {
  accountBalances,
  accounts,
  connectionCredentials,
  connections,
  transactions,
} from "@/lib/db/schema";
import { fakeClerkUserId, withAuth } from "../harness/clerk";
import { adminDb } from "../harness/db";
import {
  failNextRemove,
  failNextSync,
  linkTokenRequests,
  removedAccessTokens,
  removeItemRemotely,
  mintSandboxItem,
  resetPlaidSubstitute,
  revokeAccessToken,
  sandboxTransaction,
  usd,
  type SandboxAccount,
} from "../harness/plaid";
import { backfilled, CHECKING, connect, pushHistory, step } from "./plaid-helpers";

beforeEach(resetPlaidSubstitute);

const post = (
  route: typeof disconnectRoute,
  connectionId: string,
  body?: Record<string, unknown>,
) =>
  route(
    new Request(`http://localhost/api/connections/${connectionId}/x`, {
      method: "POST",
      headers: { host: "localhost", ...(body ? { "content-type": "application/json" } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    }),
    { params: Promise.resolve({ connectionId }) },
  );

const connectionRow = async (connectionId: string) => {
  const [row] = await adminDb()
    .select({ status: connections.status, providerError: connections.providerError })
    .from(connections)
    .where(eq(connections.id, connectionId));
  return row;
};

const counts = async () => ({
  credentials: await adminDb().$count(connectionCredentials),
  accounts: await adminDb().$count(accounts),
  transactions: await adminDb().$count(transactions),
  balances: await adminDb().$count(accountBalances),
});

const breakLogin = async (item: Awaited<ReturnType<typeof backfilled>>) => {
  failNextSync("ITEM_ERROR", "ITEM_LOGIN_REQUIRED");
  expect((await item.sync()).status).toBe(409);
  await expect(connectionRow(item.connectionId)).resolves.toMatchObject({
    providerError: "ITEM_LOGIN_REQUIRED",
  });
};

test("repair: an update-mode token is minted for the broken connection, completion clears the mark, sync resumes", async () => {
  const item = await backfilled(fakeClerkUserId());
  await breakLogin(item);

  const minted = await withAuth(item.clerkUserId, () => post(repairTokenRoute, item.connectionId));
  expect(minted.status).toBe(200);
  const { linkToken } = await minted.json();
  expect(linkToken).toMatch(/^link-update-sandbox-/);
  const request = linkTokenRequests.at(-1)!;
  expect(request.access_token).toBe(item.accessToken);
  expect(request).not.toHaveProperty("products");
  expect(request).not.toHaveProperty("webhook");

  const repaired = await withAuth(item.clerkUserId, () => post(repairedRoute, item.connectionId));
  expect(repaired.status).toBe(200);
  await expect(repaired.json()).resolves.toEqual({ repaired: true });
  await expect(connectionRow(item.connectionId)).resolves.toMatchObject({ providerError: null });

  await expect((await item.sync()).json()).resolves.toEqual(step("complete", 0));
});

test("repair mint for an item already dead at Plaid revokes the connection and reports it gone", async () => {
  const item = await backfilled(fakeClerkUserId());
  revokeAccessToken(item.accessToken);

  const minted = await withAuth(item.clerkUserId, () => post(repairTokenRoute, item.connectionId));
  expect(minted.status).toBe(410);
  await expect(minted.json()).resolves.toEqual({ error: "connection_gone" });
  await expect(connectionRow(item.connectionId)).resolves.toEqual({
    status: "disconnected",
    providerError: "USER_PERMISSION_REVOKED",
  });
  await expect(adminDb().$count(connectionCredentials)).resolves.toBe(0);
});

test("user B can neither mint a repair token, clear a mark, nor disconnect for user A", async () => {
  const item = await backfilled(fakeClerkUserId());
  await breakLogin(item);
  const clerkB = fakeClerkUserId();

  for (const route of [repairTokenRoute, repairedRoute, disconnectRoute]) {
    const response = await withAuth(clerkB, () => post(route, item.connectionId));
    expect(response.status).toBe(404);
  }
  await expect(connectionRow(item.connectionId)).resolves.toMatchObject({
    status: "active",
    providerError: "ITEM_LOGIN_REQUIRED",
  });
  await expect(adminDb().$count(connectionCredentials)).resolves.toBe(1);
  expect(removedAccessTokens).toHaveLength(0);
});

test("every action route requires a session and rejects cross-origin browsers", async () => {
  const item = await backfilled(fakeClerkUserId());
  for (const route of [repairTokenRoute, repairedRoute, disconnectRoute]) {
    expect((await post(route, item.connectionId)).status).toBe(401);
    const crossOrigin = await withAuth(item.clerkUserId, () =>
      route(
        new Request(`http://localhost/api/connections/${item.connectionId}/x`, {
          method: "POST",
          headers: { host: "localhost", origin: "https://evil.example" },
        }),
        { params: Promise.resolve({ connectionId: item.connectionId }) },
      ),
    );
    expect(crossOrigin.status).toBe(403);
  }
});

test("disconnect without purge removes the item at Plaid and the credential, and keeps every ledger row", async () => {
  const groceries = sandboxTransaction(CHECKING, 12, "KEPT", "2026-08-20");
  const item = await backfilled(fakeClerkUserId(), groceries);
  const before = await counts();
  expect(before).toEqual({ credentials: 1, accounts: 2, transactions: 1, balances: 2 });

  const response = await withAuth(item.clerkUserId, () =>
    post(disconnectRoute, item.connectionId, { purge: false }),
  );
  expect(response.status).toBe(200);
  await expect(response.json()).resolves.toEqual({ disconnected: true, purgedAccounts: 0 });
  expect(removedAccessTokens).toEqual([item.accessToken]);
  await expect(connectionRow(item.connectionId)).resolves.toMatchObject({ status: "disconnected" });
  await expect(counts()).resolves.toEqual({ ...before, credentials: 0 });
});

test("disconnect with purge deletes the connection's accounts, transactions, and balances — nothing else", async () => {
  const clerkUserId = fakeClerkUserId();
  const keepTxn = sandboxTransaction(CHECKING, 5, "OTHER CONNECTION", "2026-08-21");
  const keep = await backfilled(clerkUserId, keepTxn);
  const DOOMED = "acct-doomed-checking";
  const doomedAccounts: SandboxAccount[] = [
    { account_id: DOOMED, name: "Checking", official_name: null, mask: null, type: "depository", subtype: "checking", balances: usd(50, 50) },
    { account_id: "acct-doomed-card", name: "Card", official_name: null, mask: null, type: "credit", subtype: "credit card", balances: usd(null, 10, 100) },
  ];
  const doomed = await connect(clerkUserId, doomedAccounts);
  pushHistory(
    doomed.accessToken,
    sandboxTransaction(DOOMED, 12, "PURGED 1", "2026-08-20"),
    sandboxTransaction(DOOMED, 7, "PURGED 2", "2026-08-22"),
  );
  await expect((await doomed.sync()).json()).resolves.toMatchObject({ backfillStatus: "complete" });
  await expect(counts()).resolves.toEqual({
    credentials: 2,
    accounts: 4,
    transactions: 3,
    balances: 4,
  });

  const response = await withAuth(clerkUserId, () =>
    post(disconnectRoute, doomed.connectionId, { purge: true }),
  );
  expect(response.status).toBe(200);
  await expect(response.json()).resolves.toEqual({ disconnected: true, purgedAccounts: 2 });
  await expect(counts()).resolves.toEqual({
    credentials: 1,
    accounts: 2,
    transactions: 1,
    balances: 2,
  });
  const survivors = await adminDb().select({ description: transactions.description }).from(transactions);
  expect(survivors).toEqual([{ description: "OTHER CONNECTION" }]);
  await expect(connectionRow(doomed.connectionId)).resolves.toMatchObject({ status: "disconnected" });
  await expect(connectionRow(keep.connectionId)).resolves.toMatchObject({ status: "active" });
});

test("purging user A's connection can never touch user B's rows, even with colliding provider ids", async () => {
  const shared = sandboxTransaction(CHECKING, 42, "SHARED SOURCE ID", "2026-08-20");
  const a = await backfilled(fakeClerkUserId(), shared);
  const b = await backfilled(fakeClerkUserId(), { ...shared });

  const response = await withAuth(a.clerkUserId, () =>
    post(disconnectRoute, a.connectionId, { purge: true }),
  );
  await expect(response.json()).resolves.toEqual({ disconnected: true, purgedAccounts: 2 });

  await expect(counts()).resolves.toEqual({
    credentials: 1,
    accounts: 2,
    transactions: 1,
    balances: 2,
  });
  const [survivor] = await adminDb()
    .select({ accountId: transactions.accountId, description: transactions.description })
    .from(transactions);
  expect(survivor).toEqual({ accountId: b.accountId.get(CHECKING), description: "SHARED SOURCE ID" });
});

test("a failed /item/remove aborts the disconnect: credential kept, connection active, retry succeeds", async () => {
  const item = await backfilled(fakeClerkUserId());
  failNextRemove("API_ERROR", "INTERNAL_SERVER_ERROR");

  const failed = await withAuth(item.clerkUserId, () =>
    post(disconnectRoute, item.connectionId, { purge: true }),
  );
  expect(failed.status).toBe(502);
  await expect(failed.json()).resolves.toEqual({ error: "provider_error", message: null });
  expect(removedAccessTokens).toHaveLength(0);
  await expect(connectionRow(item.connectionId)).resolves.toMatchObject({ status: "active" });
  await expect(adminDb().$count(connectionCredentials)).resolves.toBe(1);
  await expect(adminDb().$count(accounts)).resolves.toBe(2);

  const retried = await withAuth(item.clerkUserId, () =>
    post(disconnectRoute, item.connectionId, { purge: true }),
  );
  expect(retried.status).toBe(200);
  await expect(retried.json()).resolves.toEqual({ disconnected: true, purgedAccounts: 2 });
  expect(removedAccessTokens).toEqual([item.accessToken]);
});

test("an item already removed at Plaid still disconnects locally (ITEM_NOT_FOUND is the one swallowed failure)", async () => {
  const item = await backfilled(fakeClerkUserId());
  removeItemRemotely(item.accessToken);

  const response = await withAuth(item.clerkUserId, () =>
    post(disconnectRoute, item.connectionId, {}),
  );
  expect(response.status).toBe(200);
  await expect(response.json()).resolves.toEqual({ disconnected: true, purgedAccounts: 0 });
  await expect(connectionRow(item.connectionId)).resolves.toMatchObject({ status: "disconnected" });
  await expect(adminDb().$count(connectionCredentials)).resolves.toBe(0);
});

test("a disconnected connection can be purged later without any provider call", async () => {
  const item = await backfilled(fakeClerkUserId(), sandboxTransaction(CHECKING, 3, "LATER", "2026-08-20"));
  const first = await withAuth(item.clerkUserId, () =>
    post(disconnectRoute, item.connectionId, { purge: false }),
  );
  expect(first.status).toBe(200);
  expect(removedAccessTokens).toHaveLength(1);

  const second = await withAuth(item.clerkUserId, () =>
    post(disconnectRoute, item.connectionId, { purge: true }),
  );
  expect(second.status).toBe(200);
  await expect(second.json()).resolves.toEqual({ disconnected: true, purgedAccounts: 2 });
  expect(removedAccessTokens).toHaveLength(1);
  await expect(counts()).resolves.toEqual({
    credentials: 0,
    accounts: 0,
    transactions: 0,
    balances: 0,
  });
});

test("boundary: malformed purge flags and garbage ids never reach the provider or the database", async () => {
  const item = await backfilled(fakeClerkUserId());

  const malformed = await withAuth(item.clerkUserId, () =>
    post(disconnectRoute, item.connectionId, { purge: "yes" }),
  );
  expect(malformed.status).toBe(400);
  await expect(malformed.json()).resolves.toEqual({ error: "invalid_request" });

  for (const route of [repairTokenRoute, repairedRoute, disconnectRoute]) {
    const response = await withAuth(item.clerkUserId, () => post(route, "not-a-uuid"));
    expect(response.status).toBe(404);
  }
  await expect(connectionRow(item.connectionId)).resolves.toMatchObject({ status: "active" });
  expect(removedAccessTokens).toHaveLength(0);
});

test("an abandoned Link session burns the item at Plaid and stores nothing", async () => {
  const clerkUserId = fakeClerkUserId();
  const minted = mintSandboxItem();
  const postAbandon = (publicToken: string) =>
    abandonRoute(
      new Request("http://localhost/api/plaid/abandon", {
        method: "POST",
        headers: { "content-type": "application/json", host: "localhost" },
        body: JSON.stringify({ publicToken }),
      }),
    );

  const response = await withAuth(clerkUserId, () => postAbandon(minted.publicToken));
  expect(response.status).toBe(200);
  await expect(response.json()).resolves.toEqual({ abandoned: true });
  expect(removedAccessTokens).toEqual([minted.accessToken]);
  await expect(adminDb().$count(connections)).resolves.toBe(0);
  await expect(adminDb().$count(connectionCredentials)).resolves.toBe(0);

  expect((await withAuth(clerkUserId, () => postAbandon("garbage"))).status).toBe(400);
  expect((await postAbandon(minted.publicToken)).status).toBe(401);
});

test("no connection route response ever carries the access token or any ciphertext", async () => {
  const item = await backfilled(fakeClerkUserId());
  await breakLogin(item);
  const [stored] = await adminDb()
    .select({ ciphertext: connectionCredentials.ciphertext })
    .from(connectionCredentials);

  const responses = [
    ["exchange", JSON.stringify(item.body)],
    ["sync", JSON.stringify(await (await item.sync()).json())],
    [
      "repair-token",
      JSON.stringify(
        await (await withAuth(item.clerkUserId, () => post(repairTokenRoute, item.connectionId))).json(),
      ),
    ],
    [
      "repaired",
      JSON.stringify(
        await (await withAuth(item.clerkUserId, () => post(repairedRoute, item.connectionId))).json(),
      ),
    ],
    [
      "disconnect",
      JSON.stringify(
        await (
          await withAuth(item.clerkUserId, () => post(disconnectRoute, item.connectionId, { purge: true }))
        ).json(),
      ),
    ],
  ] as const;

  for (const [name, body] of responses) {
    expect(body, name).not.toContain(item.accessToken);
    expect(body, name).not.toContain(stored.ciphertext);
    expect(body.toLowerCase(), name).not.toContain("ciphertext");
    expect(body, name).not.toContain("access-sandbox");
  }
});
