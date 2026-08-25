import { inspect } from "node:util";
import { eq } from "drizzle-orm";
import { beforeEach, expect, test } from "vitest";

import { POST as linkToken } from "@/app/api/plaid/link-token/route";
import { POST as exchange } from "@/app/api/plaid/exchange/route";
import { listConnections, readConnectionCredential } from "@/lib/data/connections";
import { connectPlaidItem, ProviderError } from "@/lib/data/plaid";
import { withRequestScope } from "@/lib/db/client";
import { accountBalances, accounts, connectionCredentials, connections, users } from "@/lib/db/schema";
import { fakeClerkUserId, withAuth } from "../harness/clerk";
import { adminDb } from "../harness/db";
import {
  exchangeRequests,
  linkTokenRequests,
  mintSandboxItem,
  removedAccessTokens,
  resetPlaidSubstitute,
  revokeAccessToken,
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

const CONNECTION_KEYS = ["backfillStatus", "createdAt", "id", "institutionId", "institutionName", "provider", "status"];

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

test("an already-connected item is refused and the fresh token is revoked at Plaid", async () => {
  const clerkUserId = fakeClerkUserId();
  const first = mintSandboxItem();
  const response = await withAuth(clerkUserId, () => postExchange(first.publicToken));
  const { connection } = await response.json();

  const second = mintSandboxItem({ item_id: first.itemId, access_token: first.accessToken });
  const duplicate = await withAuth(clerkUserId, () => postExchange(second.publicToken));
  expect(duplicate.status).toBe(409);
  expect(await duplicate.json()).toEqual({ error: "already_connected" });

  expect(removedAccessTokens).toEqual([first.accessToken]);
  expect(await adminDb().$count(connections)).toBe(1);
  expect(await adminDb().$count(accounts)).toBe(3);
  const secret = await withAuth(clerkUserId, () => readConnectionCredential(connection.id));
  expect(secret?.expose()).toBe(first.accessToken);
});

test("a provider failure after exchange leaves no partial state and never carries the API secret", async () => {
  const clerkUserId = fakeClerkUserId();
  const { publicToken, accessToken } = mintSandboxItem();
  revokeAccessToken(accessToken);

  const response = await withAuth(clerkUserId, () => postExchange(publicToken));
  expect(response.status).toBe(502);
  expect(await response.json()).toEqual({ error: "provider_error", message: null });
  expect(await adminDb().$count(connections)).toBe(0);
  expect(await adminDb().$count(connectionCredentials)).toBe(0);
  expect(await adminDb().$count(accounts)).toBe(0);

  const doomed = mintSandboxItem();
  revokeAccessToken(doomed.accessToken);
  const thrown = await withAuth(clerkUserId, () =>
    connectPlaidItem(doomed.publicToken).catch((error: unknown) => error),
  );
  expect(thrown).toBeInstanceOf(ProviderError);
  expect(inspect(thrown, { depth: null })).not.toContain(SUBSTITUTE_SECRET);
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
