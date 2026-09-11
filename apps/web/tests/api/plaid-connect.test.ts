import { inspect } from "node:util";
import { eq } from "drizzle-orm";
import { beforeEach, expect, test } from "vitest";

import { POST as cleanup } from "@/app/api/connections/[connectionId]/cleanup/route";
import { POST as linkToken } from "@/app/api/plaid/link-token/route";
import { POST as exchange } from "@/app/api/plaid/exchange/route";
import {
  createConnectionAs,
  listConnections,
  listPlaidCleanupIds,
  readConnectionCredential,
} from "@/lib/data/connections";
import { connectPlaidItem, ProviderError } from "@/lib/data/plaid";
import { withRequestScope } from "@/lib/db/client";
import { accountBalances, accounts, connectionCredentials, connections, users } from "@/lib/db/schema";
import { fakeClerkUserId, withAuth } from "../harness/clerk";
import { adminDb } from "../harness/db";
import {
  exchangeRequests,
  failNextAccountsGet,
  failNextRemove,
  isItemLive,
  linkTokenRequests,
  mintSandboxItem,
  removedAccessTokens,
  removeItemRemotely,
  resetPlaidSubstitute,
  SANDBOX_INSTITUTION,
  SUBSTITUTE_SECRET,
} from "../harness/plaid";

beforeEach(resetPlaidSubstitute);

const post = (path: string, body?: unknown, headers: Record<string, string> = {}) =>
  new Request(`http://localhost/api/plaid/${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", host: "localhost", ...headers },
    body: body === undefined ? null : typeof body === "string" ? body : JSON.stringify(body),
  });

const postExchange = (publicToken: unknown) => exchange(post("exchange", { publicToken }));

const postCleanup = (connectionId: string, headers: Record<string, string> = {}) =>
  cleanup(
    new Request(`http://localhost/api/connections/${connectionId}/cleanup`, {
      method: "POST",
      headers: { host: "localhost", ...headers },
    }),
    { params: Promise.resolve({ connectionId }) },
  );

const CONNECTION_KEYS = ["backfillStatus", "createdAt", "id", "institutionId", "institutionName", "provider", "providerError", "status"];

test("signed-out requests are rejected before any Plaid call", async () => {
  const { publicToken } = mintSandboxItem();
  expect((await linkToken(post("link-token"))).status).toBe(401);
  expect((await postExchange(publicToken)).status).toBe(401);
  expect(linkTokenRequests).toHaveLength(0);
  expect(exchangeRequests).toHaveLength(0);
  expect(await adminDb().$count(connections)).toBe(0);
});

test("cross-origin requests are rejected before any Plaid call", async () => {
  const clerkUserId = fakeClerkUserId();
  const { publicToken } = mintSandboxItem();
  const evil = { origin: "https://evil.example" };
  const tokenResponse = await withAuth(clerkUserId, () => linkToken(post("link-token", undefined, evil)));
  const exchangeResponse = await withAuth(clerkUserId, () =>
    exchange(post("exchange", { publicToken }, evil)),
  );
  expect(tokenResponse.status).toBe(403);
  expect(exchangeResponse.status).toBe(403);
  expect(linkTokenRequests).toHaveLength(0);
  expect(exchangeRequests).toHaveLength(0);
  expect(await adminDb().$count(connections)).toBe(0);
});

test("a link token is minted for the signed-in user with the minimal transactions scope", async () => {
  const clerkUserId = fakeClerkUserId();
  const sameOrigin = { origin: "http://localhost" };
  const response = await withAuth(clerkUserId, () => linkToken(post("link-token", undefined, sameOrigin)));
  expect(response.status).toBe(200);
  expect((await response.json()).linkToken).toMatch(/^link-sandbox-/);

  const [user] = await adminDb().select().from(users).where(eq(users.clerkUserId, clerkUserId));
  expect(linkTokenRequests).toEqual([
    {
      client_name: "Cash Lens",
      language: "en",
      country_codes: ["US"],
      products: ["transactions"],
      transactions: { days_requested: 730 },
      user: { client_user_id: user.id },
    },
  ]);
});

test("exchange vaults the access token and registers the item's accounts and balances", async () => {
  const clerkUserId = fakeClerkUserId();
  const { publicToken, accessToken, itemId } = mintSandboxItem();

  const response = await withAuth(clerkUserId, () => postExchange(publicToken));
  expect(response.status).toBe(200);
  const body = await response.json();

  expect(Object.keys(body.connection).sort()).toEqual(CONNECTION_KEYS);
  expect(body.connection).toMatchObject({
    provider: "plaid",
    status: "active",
    institutionId: SANDBOX_INSTITUTION.institution_id,
    institutionName: SANDBOX_INSTITUTION.institution_name,
  });
  const registered = (rest: Record<string, string | null>) => ({ id: expect.any(String), ...rest });
  expect(body.accounts).toEqual([
    registered({ name: "Plaid Checking", type: "depository", subtype: "checking", mask: "0000", currency: "USD" }),
    registered({ name: "Plaid Saving", type: "depository", subtype: "savings", mask: "1111", currency: "USD" }),
    registered({ name: "Plaid Credit Card", type: "credit", subtype: "credit card", mask: "3333", currency: "USD" }),
  ]);

  const serialized = JSON.stringify(body);
  expect(serialized).not.toContain(accessToken);
  expect(serialized).not.toContain(itemId);
  expect(serialized).not.toContain("access-sandbox");

  const [connection] = await adminDb().select().from(connections);
  expect(connection.providerItemId).toBe(itemId);
  const secret = await withAuth(clerkUserId, () => readConnectionCredential(body.connection.id));
  expect(secret?.expose()).toBe(accessToken);
  const [credential] = await adminDb().select().from(connectionCredentials);
  expect(credential.ciphertext).not.toContain(accessToken);

  const rows = await adminDb()
    .select()
    .from(accounts)
    .leftJoin(accountBalances, eq(accountBalances.accountId, accounts.id));
  const byMask = new Map(rows.map((row) => [row.accounts.mask, row]));
  expect(rows).toHaveLength(3);
  for (const row of rows) {
    expect(row.accounts.connectionId).toBe(body.connection.id);
    expect(row.accounts.source).toBe("plaid");
    expect(row.accounts.sourceId).toMatch(/^sub-/);
  }
  expect(byMask.get("0000")?.account_balances).toMatchObject({
    availableMinor: 10000,
    currentMinor: 11000,
    limitMinor: null,
  });
  expect(byMask.get("1111")?.account_balances).toMatchObject({
    availableMinor: 20000,
    currentMinor: 21033,
    limitMinor: null,
  });
  expect(byMask.get("3333")?.account_balances).toMatchObject({
    availableMinor: null,
    currentMinor: 41000,
    limitMinor: 200000,
  });
});

test("a public token is single-use: a replay registers nothing new", async () => {
  const clerkUserId = fakeClerkUserId();
  const { publicToken } = mintSandboxItem();
  expect((await withAuth(clerkUserId, () => postExchange(publicToken))).status).toBe(200);

  const replay = await withAuth(clerkUserId, () => postExchange(publicToken));
  expect(replay.status).toBe(400);
  expect(await replay.json()).toEqual({ error: "invalid_public_token" });
  expect(await adminDb().$count(connections)).toBe(1);
  expect(await adminDb().$count(accounts)).toBe(3);
});

test("an already-connected Item is refused without revoking the Item backing the existing connection", async () => {
  const clerkUserId = fakeClerkUserId();
  const first = mintSandboxItem();
  const response = await withAuth(clerkUserId, () => postExchange(first.publicToken));
  const { connection } = await response.json();

  const second = mintSandboxItem({ item_id: first.itemId, access_token: first.accessToken });
  const duplicate = await withAuth(clerkUserId, () => postExchange(second.publicToken));
  expect(duplicate.status).toBe(409);
  expect(await duplicate.json()).toEqual({ error: "already_connected" });

  expect(removedAccessTokens).toEqual([]);
  expect(isItemLive(first.accessToken)).toBe(true);
  expect(await adminDb().$count(connections)).toBe(1);
  expect(await adminDb().$count(accounts)).toBe(3);
  const secret = await withAuth(clerkUserId, () => readConnectionCredential(connection.id));
  expect(secret?.expose()).toBe(first.accessToken);
});

test("a provider failure after exchange removes remote state and never carries the API secret", async () => {
  const clerkUserId = fakeClerkUserId();
  const { publicToken, accessToken } = mintSandboxItem();
  failNextAccountsGet("API_ERROR", "INTERNAL_SERVER_ERROR");

  const response = await withAuth(clerkUserId, () => postExchange(publicToken));
  expect(response.status).toBe(502);
  expect(await response.json()).toEqual({ error: "provider_error", message: null });
  const [failed] = await adminDb().select({ status: connections.status }).from(connections);
  expect(failed.status).toBe("disconnected");
  expect(await adminDb().$count(connectionCredentials)).toBe(0);
  expect(await adminDb().$count(accounts)).toBe(0);
  expect(isItemLive(accessToken)).toBe(false);
  expect(removedAccessTokens).toEqual([accessToken]);

  const doomed = mintSandboxItem();
  failNextAccountsGet("API_ERROR", "INTERNAL_SERVER_ERROR");
  const thrown = await withAuth(clerkUserId, () =>
    connectPlaidItem(doomed.publicToken).catch((error: unknown) => error),
  );
  expect(thrown).toBeInstanceOf(ProviderError);
  expect(inspect(thrown, { depth: null })).not.toContain(SUBSTITUTE_SECRET);
});

test("an accounts/get failure removes the Item or retains an encrypted cleanup credential", async () => {
  const clerkUserId = fakeClerkUserId();
  const { publicToken, accessToken } = mintSandboxItem();
  failNextAccountsGet("API_ERROR", "INTERNAL_SERVER_ERROR");

  const response = await withAuth(clerkUserId, () => postExchange(publicToken));
  expect(response.status).toBe(502);
  expect(await response.json()).toEqual({ error: "provider_error", message: null });
  expect(await adminDb().$count(accounts)).toBe(0);

  expect({
    remoteItemLive: isItemLive(accessToken),
    durableCredentials: await adminDb().$count(connectionCredentials),
  }).not.toEqual({ remoteItemLive: true, durableCredentials: 0 });
});

test("failed cleanup stays encrypted and owner-scoped through leased concurrent retries", async () => {
  const clerkA = fakeClerkUserId();
  const clerkB = fakeClerkUserId();
  const { publicToken, accessToken } = mintSandboxItem();
  failNextAccountsGet("API_ERROR", "INTERNAL_SERVER_ERROR");
  failNextRemove("API_ERROR", "INTERNAL_SERVER_ERROR");

  const failed = await withAuth(clerkA, () => postExchange(publicToken));
  expect(failed.status).toBe(502);
  const failedBody = await failed.json();
  expect(failedBody).toEqual({ error: "provider_error", message: null });

  const [recovery] = await adminDb()
    .select({ id: connections.id, status: connections.status })
    .from(connections);
  const [credential] = await adminDb().select().from(connectionCredentials);
  expect(recovery.status).toBe("cleanup_required");
  expect(credential.ciphertext).not.toContain(accessToken);
  expect(isItemLive(accessToken)).toBe(true);
  expect(await withAuth(clerkA, () => listConnections())).toEqual([]);

  const visibleToB = await withRequestScope(clerkB, async (tx) => ({
    connections: await tx.select().from(connections),
    credentials: await tx.select().from(connectionCredentials),
  }));
  expect(visibleToB).toEqual({ connections: [], credentials: [] });
  expect(await withAuth(clerkA, () => listPlaidCleanupIds())).toEqual([]);
  expect((await postCleanup(recovery.id)).status).toBe(401);
  expect(
    (await withAuth(clerkA, () => postCleanup(recovery.id, { origin: "https://evil.example" })))
      .status,
  ).toBe(403);
  expect((await withAuth(clerkB, () => postCleanup(recovery.id))).status).toBe(404);
  expect((await withAuth(clerkA, () => postCleanup(recovery.id))).status).toBe(404);
  expect(isItemLive(accessToken)).toBe(true);

  await adminDb()
    .update(connections)
    .set({ updatedAt: new Date("2000-01-01T00:00:00.000Z") })
    .where(eq(connections.id, recovery.id));
  expect(await withAuth(clerkB, () => listPlaidCleanupIds())).toEqual([]);
  expect(await withAuth(clerkA, () => listPlaidCleanupIds())).toEqual([recovery.id]);
  failNextRemove("API_ERROR", "INTERNAL_SERVER_ERROR");
  const retryFailed = await withAuth(clerkA, () => postCleanup(recovery.id));
  expect(retryFailed.status).toBe(502);
  const retryFailedBody = await retryFailed.json();
  expect(retryFailedBody).toEqual({ error: "provider_error", message: null });
  expect(await adminDb().$count(connectionCredentials)).toBe(1);
  expect((await withAuth(clerkA, () => postCleanup(recovery.id))).status).toBe(404);

  await adminDb()
    .update(connections)
    .set({ updatedAt: new Date("2000-01-01T00:00:00.000Z") })
    .where(eq(connections.id, recovery.id));
  const retries = await withAuth(clerkA, () =>
    Promise.all([postCleanup(recovery.id), postCleanup(recovery.id)]),
  );
  expect(retries.map(({ status }) => status).sort()).toEqual([200, 404]);
  const retried = retries.find(({ status }) => status === 200)!;
  const retriedBody = await retried.json();
  expect(retriedBody).toEqual({ cleaned: true });
  expect(removedAccessTokens).toEqual([accessToken]);
  expect(isItemLive(accessToken)).toBe(false);
  expect(await adminDb().$count(connectionCredentials)).toBe(0);
  const [cleaned] = await adminDb().select({ status: connections.status }).from(connections);
  expect(cleaned.status).toBe("disconnected");

  const serialized = JSON.stringify({ failedBody, retryFailedBody, retriedBody });
  expect(serialized).not.toContain(accessToken);
  expect(serialized).not.toContain(credential.ciphertext);
  expect(serialized).not.toContain(SUBSTITUTE_SECRET);
});

test("concurrent exchanges for the same Item keep one connection and never remove the winner", async () => {
  const clerkUserId = fakeClerkUserId();
  const first = mintSandboxItem();
  const second = mintSandboxItem({ item_id: first.itemId, access_token: first.accessToken });

  const responses = await withAuth(clerkUserId, () =>
    Promise.all([postExchange(first.publicToken), postExchange(second.publicToken)]),
  );
  expect(responses.map(({ status }) => status).sort()).toEqual([200, 409]);
  expect(await adminDb().$count(connections)).toBe(1);
  expect(await adminDb().$count(connectionCredentials)).toBe(1);
  expect(await adminDb().$count(accounts)).toBe(3);
  expect(removedAccessTokens).toEqual([]);
  expect(isItemLive(first.accessToken)).toBe(true);
});

test("a stale provisional credential heals after remote removal completed first", async () => {
  const clerkUserId = fakeClerkUserId();
  await withAuth(clerkUserId, () => listConnections());
  const [user] = await adminDb().select().from(users).where(eq(users.clerkUserId, clerkUserId));
  const minted = mintSandboxItem();
  const recovery = await createConnectionAs(user, {
    provider: "plaid",
    credential: minted.accessToken,
    providerItemId: minted.itemId,
  }, "provisioning");
  await adminDb()
    .update(connections)
    .set({ updatedAt: new Date("2000-01-01T00:00:00.000Z") })
    .where(eq(connections.id, recovery.id));
  removeItemRemotely(minted.accessToken);

  expect((await withAuth(clerkUserId, () => postCleanup(recovery.id))).status).toBe(200);
  expect(await adminDb().$count(connectionCredentials)).toBe(0);
  const [cleaned] = await adminDb().select({ status: connections.status }).from(connections);
  expect(cleaned.status).toBe("disconnected");
});

test("a database rejection after exchange immediately compensates at Plaid", async () => {
  const clerkUserId = fakeClerkUserId();
  const minted = mintSandboxItem({ item_id: "item-with-null-\u0000-byte" });

  const thrown = await withAuth(clerkUserId, () =>
    postExchange(minted.publicToken).catch((error: unknown) => error),
  );
  expect(thrown).toBeInstanceOf(Error);
  expect(removedAccessTokens).toEqual([minted.accessToken]);
  expect(isItemLive(minted.accessToken)).toBe(false);
  expect(await adminDb().$count(connections)).toBe(0);
  expect(await adminDb().$count(connectionCredentials)).toBe(0);
});

test("malformed bodies are rejected at the boundary without touching Plaid", async () => {
  const clerkUserId = fakeClerkUserId();
  const bodies = [
    undefined,
    "{nope",
    {},
    { publicToken: 123 },
    { publicToken: "not-a-plaid-token" },
    { publicToken: `public-${"a".repeat(300)}` },
    { publicToken: "public-sandbox-();drop table users" },
  ];
  for (const body of bodies) {
    const response = await withAuth(clerkUserId, () => exchange(post("exchange", body)));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_request" });
  }
  expect(exchangeRequests).toHaveLength(0);
  expect(await adminDb().$count(connections)).toBe(0);
});

test("an unknown but well-formed public token maps to invalid_public_token", async () => {
  const clerkUserId = fakeClerkUserId();
  const response = await withAuth(clerkUserId, () =>
    postExchange("public-sandbox-00000000-1111-2222-3333-444444444444"),
  );
  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ error: "invalid_public_token" });
  expect(await adminDb().$count(connections)).toBe(0);
});

test("user B can never see user A's connection, accounts, or balances", async () => {
  const clerkA = fakeClerkUserId();
  const clerkB = fakeClerkUserId();
  const minted = mintSandboxItem();
  const response = await withAuth(clerkA, () => postExchange(minted.publicToken));
  const { connection } = await response.json();

  expect(await withAuth(clerkB, () => listConnections())).toEqual([]);
  expect(await withAuth(clerkB, () => readConnectionCredential(connection.id))).toBeNull();
  const visibleToB = await withRequestScope(clerkB, async (tx) => ({
    accounts: await tx.select().from(accounts),
    balances: await tx.select().from(accountBalances),
    connections: await tx.select().from(connections),
  }));
  expect(visibleToB).toEqual({ accounts: [], balances: [], connections: [] });

  const mine = await withAuth(clerkB, () => postExchange(mintSandboxItem().publicToken));
  expect(mine.status).toBe(200);
  expect(await withAuth(clerkB, () => listConnections())).toHaveLength(1);
  expect(await withAuth(clerkA, () => listConnections())).toHaveLength(1);
  expect(await adminDb().$count(accounts)).toBe(6);
});
