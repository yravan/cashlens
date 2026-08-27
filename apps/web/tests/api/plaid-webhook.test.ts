import { eq } from "drizzle-orm";
import { beforeEach, expect, test } from "vitest";

import { POST as linkToken } from "@/app/api/plaid/link-token/route";
import { resetWebhookKeyCache } from "@/lib/plaid/webhook";
import { connections, transactions } from "@/lib/db/schema";
import { fakeClerkUserId, withAuth } from "../harness/clerk";
import { adminDb } from "../harness/db";
import {
  linkTokenRequests,
  pushSyncUpdates,
  resetPlaidSubstitute,
  sandboxTransaction,
  signPlaidWebhook,
  syncRequests,
  WEBHOOK_KID,
  WEBHOOK_RETIRED_KID,
  webhookKeyRequests,
} from "../harness/plaid";
import { backfilled, CHECKING, ledgerRows, postSignedWebhook, postWebhook, webhookBody } from "./plaid-helpers";

beforeEach(() => {
  resetPlaidSubstitute();
  resetWebhookKeyCache();
});

const storedCursor = async (connectionId: string) => {
  const [row] = await adminDb()
    .select({ syncCursor: connections.syncCursor })
    .from(connections)
    .where(eq(connections.id, connectionId));
  return row.syncCursor;
};

test("a verified SYNC_UPDATES_AVAILABLE ingests the item's new data with no session at all", async () => {
  const { accessToken, itemId, connectionId } = await backfilled(fakeClerkUserId());
  pushSyncUpdates(accessToken, {
    added: [sandboxTransaction(CHECKING, 15.5, "WEBHOOK DELIVERED", "2026-08-25")],
  });

  const body = webhookBody(itemId);
  const response = await postWebhook(body, await signPlaidWebhook(body));
  expect(response.status).toBe(200);
  await expect(response.json()).resolves.toEqual({});

  expect((await ledgerRows()).map((row) => [row.description, row.amountMinor])).toEqual([
    ["WEBHOOK DELIVERED", -1550],
  ]);
  await expect(storedCursor(connectionId)).resolves.toBe("sync-cursor-1");
});

test("a replayed delivery is acknowledged and changes nothing", async () => {
  const { accessToken, itemId, connectionId } = await backfilled(fakeClerkUserId());
  pushSyncUpdates(accessToken, {
    added: [sandboxTransaction(CHECKING, 4, "ONCE", "2026-08-25")],
  });

  const body = webhookBody(itemId);
  const jwt = await signPlaidWebhook(body);
  expect((await postWebhook(body, jwt)).status).toBe(200);
  const calls = syncRequests.length;

  const replay = await postWebhook(body, jwt);
  expect(replay.status).toBe(200);
  await expect(adminDb().$count(transactions)).resolves.toBe(1);
  await expect(storedCursor(connectionId)).resolves.toBe("sync-cursor-1");
  expect(syncRequests.length).toBeGreaterThan(calls);
});

test("unverifiable deliveries are rejected before any provider call or database effect", async () => {
  const body = webhookBody("item-nobody-has");
  const unsigned = (claims: object, header: object) => {
    const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
    return `${encode(header)}.${encode(claims)}.`;
  };

  const rejections: Array<[string, string | null]> = [
    ["missing header", null],
    ["not a jwt", "garbage"],
    [
      "alg none",
      unsigned({ iat: Math.floor(Date.now() / 1000), request_body_sha256: "0".repeat(64) }, { alg: "none", typ: "JWT", kid: WEBHOOK_KID }),
    ],
    ["unknown kid", await signPlaidWebhook(body, { kid: "kid-plaid-never-issued" })],
    ["expired key", await signPlaidWebhook(body, { kid: WEBHOOK_RETIRED_KID, key: "retired" })],
    ["forged signature under the live kid", await signPlaidWebhook(body, { key: "attacker" })],
    ["body hash mismatch", await signPlaidWebhook(body, { bodyHashOf: webhookBody("item-other") })],
    ["far-future iat", await signPlaidWebhook(body, { iatOffsetSeconds: 10 * 60 })],
  ];
  for (const [reason, jwt] of rejections) {
    const response = await postWebhook(body, jwt);
    expect(response.status, reason).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "unverified" });
  }
  expect(syncRequests).toHaveLength(0);
  await expect(adminDb().$count(transactions)).resolves.toBe(0);
});

test("a malformed kid is rejected before any key fetch — garbage cannot drive provider calls", async () => {
  const body = webhookBody("item-x");
  for (const kid of ["../../etc", "kid with spaces", "x".repeat(129), ""]) {
    const response = await postWebhook(body, await signPlaidWebhook(body, { kid }));
    expect(response.status, JSON.stringify(kid)).toBe(401);
  }
  expect(webhookKeyRequests).toHaveLength(0);

  expect((await postSignedWebhook(body)).status).toBe(200);
  expect(webhookKeyRequests).toEqual([WEBHOOK_KID]);
});

test("an HS256 signature never verifies even with the live kid", async () => {
  const { SignJWT } = await import("jose");
  const body = webhookBody("item-x");
  const jwt = await new SignJWT({ request_body_sha256: "0".repeat(64) })
    .setProtectedHeader({ alg: "HS256", kid: WEBHOOK_KID, typ: "JWT" })
    .setIssuedAt()
    .sign(new TextEncoder().encode("attacker-secret"));
  expect((await postWebhook(body, jwt)).status).toBe(401);
  expect(syncRequests).toHaveLength(0);
});

test("a correctly signed but stale delivery is acknowledged without acting", async () => {
  const { accessToken, itemId } = await backfilled(fakeClerkUserId());
  pushSyncUpdates(accessToken, {
    added: [sandboxTransaction(CHECKING, 3, "TOO LATE", "2026-08-25")],
  });
  const calls = syncRequests.length;

  const body = webhookBody(itemId);
  const response = await postWebhook(body, await signPlaidWebhook(body, { iatOffsetSeconds: -6 * 60 }));
  expect(response.status).toBe(200);
  await expect(response.json()).resolves.toEqual({});
  expect(syncRequests).toHaveLength(calls);
  await expect(adminDb().$count(transactions)).resolves.toBe(0);
});

test("an unknown item is acknowledged identically to a known one", async () => {
  const body = webhookBody("item-that-matches-no-connection");
  const response = await postWebhook(body, await signPlaidWebhook(body));
  expect(response.status).toBe(200);
  await expect(response.json()).resolves.toEqual({});
  expect(syncRequests).toHaveLength(0);
});

test("A's webhook syncs A's ledger only — B's pending data stays untouched", async () => {
  const a = await backfilled(fakeClerkUserId());
  const b = await backfilled(fakeClerkUserId());
  pushSyncUpdates(a.accessToken, {
    added: [sandboxTransaction(CHECKING, 10, "A NEW", "2026-08-25")],
  });
  pushSyncUpdates(b.accessToken, {
    added: [sandboxTransaction(CHECKING, 20, "B WAITING", "2026-08-25")],
  });

  const body = webhookBody(a.itemId);
  expect((await postWebhook(body, await signPlaidWebhook(body))).status).toBe(200);

  expect((await ledgerRows()).map((row) => row.description)).toEqual(["A NEW"]);
  await expect(storedCursor(a.connectionId)).resolves.toBe("sync-cursor-1");
  await expect(storedCursor(b.connectionId)).resolves.toBe("sync-cursor-0");
});

test("a webhook for a disconnected connection is acknowledged and never syncs", async () => {
  const { itemId, connectionId, accessToken } = await backfilled(fakeClerkUserId());
  pushSyncUpdates(accessToken, {
    added: [sandboxTransaction(CHECKING, 5, "AFTER DISCONNECT", "2026-08-25")],
  });
  await adminDb()
    .update(connections)
    .set({ status: "disconnected" })
    .where(eq(connections.id, connectionId));
  const calls = syncRequests.length;

  const body = webhookBody(itemId);
  expect((await postWebhook(body, await signPlaidWebhook(body))).status).toBe(200);
  expect(syncRequests).toHaveLength(calls);
  await expect(adminDb().$count(transactions)).resolves.toBe(0);
});

test("legacy transactions codes and unrelated webhook types are no-ops", async () => {
  const { itemId, accessToken } = await backfilled(fakeClerkUserId());
  pushSyncUpdates(accessToken, {
    added: [sandboxTransaction(CHECKING, 5, "MUST NOT LAND", "2026-08-25")],
  });
  const calls = syncRequests.length;

  for (const [type, code] of [
    ["TRANSACTIONS", "INITIAL_UPDATE"],
    ["TRANSACTIONS", "HISTORICAL_UPDATE"],
    ["TRANSACTIONS", "DEFAULT_UPDATE"],
    ["TRANSACTIONS", "TRANSACTIONS_REMOVED"],
    ["TRANSACTIONS", "RECURRING_TRANSACTIONS_UPDATE"],
    ["ITEM", "NEW_ACCOUNTS_AVAILABLE"],
    ["ITEM", "ERROR"],
    ["LINK", "EVENTS"],
    ["", ""],
  ] as const) {
    const body = webhookBody(itemId, code, type);
    const response = await postWebhook(body, await signPlaidWebhook(body));
    expect(response.status, `${type}/${code}`).toBe(200);
  }
  expect(syncRequests).toHaveLength(calls);
  await expect(adminDb().$count(transactions)).resolves.toBe(0);
});

test("an oversized body is refused before any verification work", async () => {
  const body = `{"pad":"${"x".repeat(256 * 1024)}"}`;
  const response = await postWebhook(body, await signPlaidWebhook(body));
  expect(response.status).toBe(413);
  expect(webhookKeyRequests).toHaveLength(0);
});

test("verification keys are cached, misses are negative-cached, and a new kid re-checks the rest", async () => {
  const { itemId } = await backfilled(fakeClerkUserId());
  const first = webhookBody(itemId);
  const second = webhookBody(itemId, "DEFAULT_UPDATE");
  expect((await postWebhook(first, await signPlaidWebhook(first))).status).toBe(200);
  expect((await postWebhook(second, await signPlaidWebhook(second))).status).toBe(200);
  expect(webhookKeyRequests).toEqual([WEBHOOK_KID]);

  const stranger = { kid: "kid-plaid-never-issued" };
  expect((await postWebhook(first, await signPlaidWebhook(first, stranger))).status).toBe(401);
  expect((await postWebhook(first, await signPlaidWebhook(first, stranger))).status).toBe(401);
  expect(webhookKeyRequests).toEqual([WEBHOOK_KID, stranger.kid]);

  // A kid Plaid does serve is a rotation signal: every cached unexpired key is
  // re-fetched so one that has since retired starts being rejected.
  const rotated = await signPlaidWebhook(first, { kid: WEBHOOK_RETIRED_KID, key: "retired" });
  expect((await postWebhook(first, rotated)).status).toBe(401);
  expect(webhookKeyRequests).toEqual([
    WEBHOOK_KID,
    stranger.kid,
    WEBHOOK_RETIRED_KID,
    WEBHOOK_KID,
  ]);
});

test("the link token arms the webhook URL exactly when one is configured", async () => {
  const post = () =>
    withAuth(fakeClerkUserId(), () =>
      linkToken(
        new Request("http://localhost/api/plaid/link-token", {
          method: "POST",
          headers: { host: "localhost" },
        }),
      ),
    );

  const previous = process.env.PLAID_WEBHOOK_URL;
  try {
    delete process.env.PLAID_WEBHOOK_URL;
    expect((await post()).status).toBe(200);
    expect(linkTokenRequests[0]).not.toHaveProperty("webhook");

    process.env.PLAID_WEBHOOK_URL = "https://cashlens.example/api/plaid/webhook";
    expect((await post()).status).toBe(200);
    expect(linkTokenRequests[1]).toMatchObject({
      webhook: "https://cashlens.example/api/plaid/webhook",
    });
  } finally {
    if (previous === undefined) delete process.env.PLAID_WEBHOOK_URL;
    else process.env.PLAID_WEBHOOK_URL = previous;
  }
});
