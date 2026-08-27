import { eq } from "drizzle-orm";
import { beforeEach, expect, test } from "vitest";

import { listConnections } from "@/lib/data/connections";
import { connectionCredentials, connections, accounts, transactions } from "@/lib/db/schema";
import { resetWebhookKeyCache } from "@/lib/plaid/webhook";
import { fakeClerkUserId, withAuth } from "../harness/clerk";
import { adminDb } from "../harness/db";
import {
  failNextSync,
  pushSyncUpdates,
  resetPlaidSubstitute,
  sandboxTransaction,
  syncRequests,
  webhookUpdateRequests,
} from "../harness/plaid";
import { backfilled, CHECKING, postSignedWebhook, step, webhookBody } from "./plaid-helpers";

beforeEach(() => {
  resetPlaidSubstitute();
  resetWebhookKeyCache();
});

const storedHealth = async (connectionId: string) => {
  const [row] = await adminDb()
    .select({
      status: connections.status,
      providerError: connections.providerError,
      webhookUrl: connections.webhookUrl,
    })
    .from(connections)
    .where(eq(connections.id, connectionId));
  return row;
};

test("a sync failing with ITEM_LOGIN_REQUIRED reports reauth_required and marks the connection; a working sync clears it", async () => {
  const item = await backfilled(fakeClerkUserId());
  pushSyncUpdates(item.accessToken, {
    added: [sandboxTransaction(CHECKING, 5, "BLOCKED", "2026-08-25")],
  });
  failNextSync("ITEM_ERROR", "ITEM_LOGIN_REQUIRED");

  const broken = await item.sync();
  expect(broken.status).toBe(409);
  await expect(broken.json()).resolves.toEqual({ error: "reauth_required" });
  await expect(storedHealth(item.connectionId)).resolves.toMatchObject({
    status: "active",
    providerError: "ITEM_LOGIN_REQUIRED",
  });
  const listed = await withAuth(item.clerkUserId, listConnections);
  expect(listed).toMatchObject([{ providerError: "ITEM_LOGIN_REQUIRED" }]);

  const healed = await item.sync();
  await expect(healed.json()).resolves.toEqual(step("complete", 1));
  await expect(storedHealth(item.connectionId)).resolves.toMatchObject({ providerError: null });
});

test("PENDING_EXPIRATION persists through a working sync and clears on LOGIN_REPAIRED", async () => {
  const item = await backfilled(fakeClerkUserId());
  expect((await postSignedWebhook(webhookBody(item.itemId, "PENDING_EXPIRATION", "ITEM"))).status).toBe(200);
  await expect(storedHealth(item.connectionId)).resolves.toMatchObject({
    providerError: "PENDING_EXPIRATION",
  });

  pushSyncUpdates(item.accessToken, {
    added: [sandboxTransaction(CHECKING, 4, "STILL FLOWING", "2026-08-25")],
  });
  await expect((await item.sync()).json()).resolves.toEqual(step("complete", 1));
  await expect(storedHealth(item.connectionId)).resolves.toMatchObject({
    providerError: "PENDING_EXPIRATION",
  });

  expect((await postSignedWebhook(webhookBody(item.itemId, "LOGIN_REPAIRED", "ITEM"))).status).toBe(200);
  await expect(storedHealth(item.connectionId)).resolves.toMatchObject({ providerError: null });
});

test("a verified ITEM:ERROR marks only that item's owner; codes outside the repair class mark nobody", async () => {
  const a = await backfilled(fakeClerkUserId());
  const b = await backfilled(fakeClerkUserId());

  const broken = webhookBody(a.itemId, "ERROR", "ITEM", {
    error: { error_type: "ITEM_ERROR", error_code: "ITEM_LOGIN_REQUIRED", error_message: "x" },
  });
  expect((await postSignedWebhook(broken)).status).toBe(200);
  await expect(storedHealth(a.connectionId)).resolves.toMatchObject({
    providerError: "ITEM_LOGIN_REQUIRED",
  });
  await expect(storedHealth(b.connectionId)).resolves.toMatchObject({ providerError: null });

  const transient = webhookBody(b.itemId, "ERROR", "ITEM", {
    error: { error_type: "INSTITUTION_ERROR", error_code: "INSTITUTION_DOWN" },
  });
  expect((await postSignedWebhook(transient)).status).toBe(200);
  await expect(storedHealth(b.connectionId)).resolves.toMatchObject({ providerError: null });
});

test("USER_PERMISSION_REVOKED deletes the credential and tombstones with the reason; the item goes inert but data stays", async () => {
  const groceries = sandboxTransaction(CHECKING, 12, "KEPT HISTORY", "2026-08-20");
  const item = await backfilled(fakeClerkUserId(), groceries);

  expect((await postSignedWebhook(webhookBody(item.itemId, "USER_PERMISSION_REVOKED", "ITEM"))).status).toBe(200);
  await expect(storedHealth(item.connectionId)).resolves.toMatchObject({
    status: "disconnected",
    providerError: "USER_PERMISSION_REVOKED",
  });
  await expect(adminDb().$count(connectionCredentials)).resolves.toBe(0);
  await expect(adminDb().$count(accounts)).resolves.toBe(2);
  await expect(adminDb().$count(transactions)).resolves.toBe(1);

  pushSyncUpdates(item.accessToken, {
    added: [sandboxTransaction(CHECKING, 5, "AFTER REVOKE", "2026-08-26")],
  });
  const calls = syncRequests.length;
  expect((await postSignedWebhook(webhookBody(item.itemId))).status).toBe(200);
  expect(syncRequests).toHaveLength(calls);
  await expect(adminDb().$count(transactions)).resolves.toBe(1);
});

test("a committed run stamps the provider webhook URL exactly once per change", async () => {
  const previous = process.env.PLAID_WEBHOOK_URL;
  const url = "https://cashlens.example/api/plaid/webhook";
  try {
    delete process.env.PLAID_WEBHOOK_URL;
    const item = await backfilled(fakeClerkUserId());
    expect(webhookUpdateRequests).toHaveLength(0);
    await expect(storedHealth(item.connectionId)).resolves.toMatchObject({ webhookUrl: null });

    process.env.PLAID_WEBHOOK_URL = url;
    await expect((await item.sync()).json()).resolves.toEqual(step("complete", 0));
    expect(webhookUpdateRequests).toEqual([{ accessToken: item.accessToken, webhook: url }]);
    await expect(storedHealth(item.connectionId)).resolves.toMatchObject({ webhookUrl: url });

    await expect((await item.sync()).json()).resolves.toEqual(step("complete", 0));
    expect(webhookUpdateRequests).toHaveLength(1);

    const born = await backfilled(fakeClerkUserId());
    expect(webhookUpdateRequests).toHaveLength(1);
    await expect(storedHealth(born.connectionId)).resolves.toMatchObject({ webhookUrl: url });
  } finally {
    if (previous === undefined) delete process.env.PLAID_WEBHOOK_URL;
    else process.env.PLAID_WEBHOOK_URL = previous;
  }
});
