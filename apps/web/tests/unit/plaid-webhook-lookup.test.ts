import { createServer } from "node:http";
import { beforeEach, describe, expect, test, vi } from "vitest";

import {
  resetWebhookKeyCache,
  verifyPlaidWebhook,
  webhookKeyCacheSizes,
  WebhookLookupBusyError,
  WebhookLookupUnavailableError,
  WebhookVerificationError,
} from "@/lib/plaid/webhook";
import {
  failNextWebhookKey,
  forwardWebhookKeyRequestsTo,
  holdWebhookKeyRequests,
  resetPlaidSubstitute,
  serveWebhookKey,
  signPlaidWebhook,
  WEBHOOK_KID,
  webhookKeyRequests,
} from "../harness/plaid";

const BODY = "{}";
const signed = (kid: string) => signPlaidWebhook(BODY, { kid });
const verify = async (kid: string) => verifyPlaidWebhook(BODY, await signed(kid));

beforeEach(() => {
  process.env.PLAID_ENV = "sandbox";
  process.env.PLAID_CLIENT_ID = "webhook-test-client";
  process.env.PLAID_SECRET = "webhook-test-secret";
  vi.useRealTimers();
  resetPlaidSubstitute();
  resetWebhookKeyCache();
});

test("concurrent requests for one unknown kid share one provider lookup", async () => {
  const release = holdWebhookKeyRequests();
  const jwt = await signed("never-issued");
  const attempts = Array.from({ length: 20 }, () =>
    verifyPlaidWebhook(BODY, jwt).catch((error: unknown) => error),
  );

  await vi.waitFor(() => expect(webhookKeyRequests).toEqual(["never-issued"]));
  release();
  const results = await Promise.all(attempts);
  expect(results).toHaveLength(20);
  for (const result of results) expect(result).toBeInstanceOf(WebhookVerificationError);
});

test("concurrent requests for a served rotation kid share one lookup and then hit cache", async () => {
  const kid = "rotation-1";
  serveWebhookKey(kid);
  const release = holdWebhookKeyRequests();
  const jwt = await signed(kid);
  const attempts = Array.from({ length: 20 }, () => verifyPlaidWebhook(BODY, jwt));

  await vi.waitFor(() => expect(webhookKeyRequests).toEqual([kid]));
  release();
  await expect(Promise.all(attempts)).resolves.toHaveLength(20);
  await expect(verifyPlaidWebhook(BODY, jwt)).resolves.toEqual({ stale: false });
  expect(webhookKeyRequests).toEqual([kid]);
});

test("only one novel lookup runs at once and novel starts are bounded per minute", async () => {
  const release = holdWebhookKeyRequests();
  const first = verify("novel-held").catch((error: unknown) => error);
  await vi.waitFor(() => expect(webhookKeyRequests).toEqual(["novel-held"]));
  await expect(verify("novel-blocked")).rejects.toBeInstanceOf(WebhookLookupBusyError);
  release();
  expect(await first).toBeInstanceOf(WebhookVerificationError);

  for (let index = 0; index < 7; index++) {
    await expect(verify(`novel-${index}`)).rejects.toBeInstanceOf(WebhookVerificationError);
  }
  await expect(verify("novel-over-budget")).rejects.toBeInstanceOf(WebhookLookupBusyError);
  expect(webhookKeyRequests).toHaveLength(8);
});

test("known stale refreshes have their own bounded budget", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-10T12:00:00Z"));
  await expect(verify(WEBHOOK_KID)).resolves.toEqual({ stale: false });
  vi.advanceTimersByTime(5 * 60 * 1000);

  for (let index = 0; index < 8; index++) {
    failNextWebhookKey("API_ERROR", "INTERNAL_SERVER_ERROR");
    await expect(verify(WEBHOOK_KID)).rejects.toBeInstanceOf(WebhookLookupUnavailableError);
  }
  await expect(verify(WEBHOOK_KID)).rejects.toBeInstanceOf(WebhookLookupBusyError);
  expect(webhookKeyRequests).toHaveLength(9);
});

test("known-key refresh retains capacity while a novel lookup is in flight", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-10T12:00:00Z"));
  await verify(WEBHOOK_KID);
  vi.advanceTimersByTime(5 * 60 * 1000);

  const release = holdWebhookKeyRequests();
  const novel = verify("novel-held").catch((error: unknown) => error);
  await vi.waitFor(() => expect(webhookKeyRequests.at(-1)).toBe("novel-held"));
  const refresh = verify(WEBHOOK_KID);
  await vi.waitFor(() => expect(webhookKeyRequests.at(-1)).toBe(WEBHOOK_KID));
  release();
  expect(await novel).toBeInstanceOf(WebhookVerificationError);
  await expect(refresh).resolves.toEqual({ stale: false });
});

test("only the documented invalid-key error is negative-cached", async () => {
  const kid = "temporarily-unavailable";
  failNextWebhookKey("API_ERROR", "INTERNAL_SERVER_ERROR");
  await expect(verify(kid)).rejects.toBeInstanceOf(WebhookLookupUnavailableError);
  await expect(verify(kid)).rejects.toBeInstanceOf(WebhookVerificationError);
  await expect(verify(kid)).rejects.toBeInstanceOf(WebhookVerificationError);
  expect(webhookKeyRequests).toEqual([kid, kid]);
});

test("the actual Plaid transport aborts a hung lookup and releases capacity", async () => {
  let requestAborted = false;
  let requestSeen!: () => void;
  const seen = new Promise<void>((resolve) => {
    requestSeen = resolve;
  });
  const server = createServer((request) => {
    requestSeen();
    request.on("aborted", () => {
      requestAborted = true;
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("loopback server did not bind");
  forwardWebhookKeyRequestsTo(`http://127.0.0.1:${address.port}`);

  try {
    const started = Date.now();
    const hung = verify("hung-transport");
    await seen;
    await expect(hung).rejects.toBeInstanceOf(WebhookLookupUnavailableError);
    const duration = Date.now() - started;
    expect(duration).toBeGreaterThanOrEqual(4_500);
    expect(duration).toBeLessThan(7_000);
    await vi.waitFor(() => expect(requestAborted).toBe(true));

    forwardWebhookKeyRequestsTo(null);
    await expect(verify("after-abort")).rejects.toBeInstanceOf(WebhookVerificationError);
    expect(webhookKeyRequests).toEqual(["hung-transport", "after-abort"]);
  } finally {
    forwardWebhookKeyRequestsTo(null);
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => error ? reject(error) : resolve()),
    );
  }
}, 8_000);

test("a TTL-boundary refresh coalesces and recovers after a transient failure", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-10T12:00:00Z"));
  await verify(WEBHOOK_KID);
  vi.advanceTimersByTime(5 * 60 * 1000);
  failNextWebhookKey("API_ERROR", "INTERNAL_SERVER_ERROR");
  const release = holdWebhookKeyRequests();
  const jwt = await signed(WEBHOOK_KID);
  const attempts = Array.from({ length: 20 }, () =>
    verifyPlaidWebhook(BODY, jwt).catch((error: unknown) => error),
  );
  await vi.waitFor(() => expect(webhookKeyRequests).toHaveLength(2));
  release();
  const failed = await Promise.all(attempts);
  for (const result of failed) expect(result).toBeInstanceOf(WebhookLookupUnavailableError);
  await expect(verifyPlaidWebhook(BODY, jwt)).resolves.toEqual({ stale: false });
  expect(webhookKeyRequests).toHaveLength(3);
});

test("the negative cache stays bounded at 256 entries", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-10T12:00:00Z"));
  for (let index = 0; index < 257; index++) {
    if (index > 0 && index % 8 === 0) vi.advanceTimersByTime(61_000);
    await expect(verify(`missing-${index}`)).rejects.toBeInstanceOf(WebhookVerificationError);
  }
  expect(webhookKeyCacheSizes()).toEqual({ keys: 0, misses: 256 });
});

describe("key metadata and bounded positive cache", () => {
  test.each([
    ["kid", "different"],
    ["alg", "RS256"],
    ["kty", "RSA"],
    ["crv", "P-384"],
    ["use", "enc"],
    ["x", ""],
    ["y", ""],
    ["expired_at", undefined],
  ])("rejects a served key with invalid %s", async (field, value) => {
    const kid = `bad-${field}`;
    serveWebhookKey(kid, { [field]: value });
    await expect(verify(kid)).rejects.toBeInstanceOf(WebhookLookupUnavailableError);
  });

  test("fetching a new key does not refresh every cached key", async () => {
    await verify(WEBHOOK_KID);
    serveWebhookKey("rotation-2");
    await verify("rotation-2");
    expect(webhookKeyRequests).toEqual([WEBHOOK_KID, "rotation-2"]);
  });

  test("the ninth served key evicts the least recently used key", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-10T12:00:00Z"));
    for (let index = 0; index < 8; index++) {
      serveWebhookKey(`served-${index}`);
      await verify(`served-${index}`);
    }
    vi.advanceTimersByTime(61_000);
    await verify("served-0");
    serveWebhookKey("served-8");
    await verify("served-8");
    await verify("served-0");
    expect(webhookKeyRequests.filter((kid) => kid === "served-0")).toHaveLength(1);
    await verify("served-1");
    expect(webhookKeyRequests.filter((kid) => kid === "served-1")).toHaveLength(2);
  });
});
