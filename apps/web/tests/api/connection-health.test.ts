import { eq } from "drizzle-orm";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

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
  webhookUpdateRequests,
} from "../harness/plaid";
import { backfilled, CHECKING, postSignedWebhook, step, webhookBody } from "./plaid-helpers";

beforeEach(() => {
  resetPlaidSubstitute();
  resetWebhookKeyCache();
});
afterEach(() => vi.unstubAllEnvs());

const itemWebhook = async (itemId: string, code: string, extra?: Record<string, unknown>) => {
  const response = await postSignedWebhook(webhookBody(itemId, code, "ITEM", extra));
  expect(response.status, code).toBe(200);
};

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
  await itemWebhook(item.itemId, "PENDING_EXPIRATION");
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

  await itemWebhook(item.itemId, "LOGIN_REPAIRED");
  await expect(storedHealth(item.connectionId)).resolves.toMatchObject({ providerError: null });
});

test("a verified ITEM:ERROR marks only that item's owner; codes outside the repair class mark nobody", async () => {
  const a = await backfilled(fakeClerkUserId());
  const b = await backfilled(fakeClerkUserId());

  await itemWebhook(a.itemId, "ERROR", {
    error: { error_type: "ITEM_ERROR", error_code: "ITEM_LOGIN_REQUIRED", error_message: "x" },
  });
  await expect(storedHealth(a.connectionId)).resolves.toMatchObject({
    providerError: "ITEM_LOGIN_REQUIRED",
  });
  await expect(storedHealth(b.connectionId)).resolves.toMatchObject({ providerError: null });

  await itemWebhook(b.itemId, "ERROR", {
    error: { error_type: "INSTITUTION_ERROR", error_code: "INSTITUTION_DOWN" },
  });
  await expect(storedHealth(b.connectionId)).resolves.toMatchObject({ providerError: null });
});

test("USER_PERMISSION_REVOKED deletes the credential and tombstones with the reason; the item goes inert but data stays", async () => {
  const groceries = sandboxTransaction(CHECKING, 12, "KEPT HISTORY", "2026-08-20");
  const item = await backfilled(fakeClerkUserId(), groceries);

  await itemWebhook(item.itemId, "USER_PERMISSION_REVOKED");
  await expect(storedHealth(item.connectionId)).resolves.toMatchObject({
    status: "disconnected",
    providerError: "USER_PERMISSION_REVOKED",
  });
  await expect(adminDb().$count(connectionCredentials)).resolves.toBe(0);
  await expect(adminDb().$count(accounts)).resolves.toBe(2);
  await expect(adminDb().$count(transactions)).resolves.toBe(1);
});

test("a committed run stamps the provider webhook URL exactly once per change", async () => {
  const url = "https://cashlens.example/api/plaid/webhook";
  vi.stubEnv("PLAID_WEBHOOK_URL", undefined);
  const item = await backfilled(fakeClerkUserId());
  expect(webhookUpdateRequests).toHaveLength(0);
  await expect(storedHealth(item.connectionId)).resolves.toMatchObject({ webhookUrl: null });

  vi.stubEnv("PLAID_WEBHOOK_URL", url);
  await expect((await item.sync()).json()).resolves.toEqual(step("complete", 0));
  expect(webhookUpdateRequests).toEqual([{ accessToken: item.accessToken, webhook: url }]);
  await expect(storedHealth(item.connectionId)).resolves.toMatchObject({ webhookUrl: url });

  await expect((await item.sync()).json()).resolves.toEqual(step("complete", 0));
  expect(webhookUpdateRequests).toHaveLength(1);

  const born = await backfilled(fakeClerkUserId());
  expect(webhookUpdateRequests).toHaveLength(1);
  await expect(storedHealth(born.connectionId)).resolves.toMatchObject({ webhookUrl: url });
});
