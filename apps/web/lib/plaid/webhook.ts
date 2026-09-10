import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
import { decodeProtectedHeader, importJWK, jwtVerify } from "jose";

import { getWebhookVerificationKey, type WebhookVerificationKey } from "@/lib/plaid/client";

export class WebhookVerificationError extends Error {}
export class WebhookLookupBusyError extends Error {}
export class WebhookLookupUnavailableError extends Error {}

const MAX_AGE_SECONDS = 5 * 60;
const KEY_TTL_MS = 5 * 60 * 1000;
const MISS_TTL_MS = 5 * 60 * 1000;
const KEY_CACHE_MAX = 8;
const MISS_CACHE_MAX = 256;
const LOOKUP_WINDOW_MS = 60 * 1000;
const LOOKUP_START_MAX = 8;
const LOOKUP_CONCURRENCY_MAX = 2;

type CachedKey = { key: WebhookVerificationKey; fetchedAt: number };

const globalForKeys = globalThis as unknown as {
  cashlensPlaidWebhookKeys?: Map<string, CachedKey>;
  cashlensPlaidWebhookKeyMisses?: Map<string, number>;
  cashlensPlaidWebhookKeyLookups?: Map<string, Promise<WebhookVerificationKey | null>>;
  cashlensPlaidWebhookNovelStarts?: number[];
  cashlensPlaidWebhookRefreshStarts?: number[];
  cashlensPlaidWebhookLookupCount?: number;
  cashlensPlaidWebhookNovelLookupCount?: number;
};
const keyCache = () => (globalForKeys.cashlensPlaidWebhookKeys ??= new Map());
const missCache = () => (globalForKeys.cashlensPlaidWebhookKeyMisses ??= new Map());
const lookups = () => (globalForKeys.cashlensPlaidWebhookKeyLookups ??= new Map());

export function resetWebhookKeyCache(): void {
  keyCache().clear();
  missCache().clear();
  lookups().clear();
  globalForKeys.cashlensPlaidWebhookNovelStarts = [];
  globalForKeys.cashlensPlaidWebhookRefreshStarts = [];
  globalForKeys.cashlensPlaidWebhookLookupCount = 0;
  globalForKeys.cashlensPlaidWebhookNovelLookupCount = 0;
}

export function webhookKeyCacheSizes(): { keys: number; misses: number } {
  return { keys: keyCache().size, misses: missCache().size };
}

function recent(starts: number[], now: number): number[] {
  const firstRecent = starts.findIndex((started) => now - started < LOOKUP_WINDOW_MS);
  return firstRecent < 0 ? [] : starts.slice(firstRecent);
}

function touch<K, V>(cache: Map<K, V>, key: K, value: V, max: number): void {
  cache.delete(key);
  cache.set(key, value);
  if (cache.size > max) cache.delete(cache.keys().next().value!);
}

function validKey(key: WebhookVerificationKey, kid: string): boolean {
  return key.kid === kid && key.alg === "ES256" && key.kty === "EC" &&
    key.crv === "P-256" && key.use === "sig" &&
    typeof key.x === "string" && key.x.length > 0 &&
    typeof key.y === "string" && key.y.length > 0 &&
    (key.expiredAt === null || Number.isFinite(key.expiredAt));
}

function definitiveMiss(error: unknown): boolean {
  return error instanceof Error &&
    "errorType" in error && error.errorType === "INVALID_INPUT" &&
    "errorCode" in error && error.errorCode === "INVALID_WEBHOOK_VERIFICATION_KEY_ID";
}

function admitLookup(known: boolean, now: number): () => void {
  const total = globalForKeys.cashlensPlaidWebhookLookupCount ?? 0;
  const novel = globalForKeys.cashlensPlaidWebhookNovelLookupCount ?? 0;
  if (total >= LOOKUP_CONCURRENCY_MAX || (!known && novel >= 1)) {
    throw new WebhookLookupBusyError("lookup_concurrency");
  }
  const field = known ? "cashlensPlaidWebhookRefreshStarts" : "cashlensPlaidWebhookNovelStarts";
  const starts = recent(globalForKeys[field] ?? [], now);
  if (starts.length >= LOOKUP_START_MAX) throw new WebhookLookupBusyError("lookup_budget");
  starts.push(now);
  globalForKeys[field] = starts;
  globalForKeys.cashlensPlaidWebhookLookupCount = total + 1;
  if (!known) globalForKeys.cashlensPlaidWebhookNovelLookupCount = novel + 1;
  return () => {
    globalForKeys.cashlensPlaidWebhookLookupCount =
      (globalForKeys.cashlensPlaidWebhookLookupCount ?? 1) - 1;
    if (!known) {
      globalForKeys.cashlensPlaidWebhookNovelLookupCount =
        (globalForKeys.cashlensPlaidWebhookNovelLookupCount ?? 1) - 1;
    }
  };
}

async function verificationKey(kid: string): Promise<WebhookVerificationKey | null> {
  const now = Date.now();
  const cached = keyCache().get(kid);
  if (cached && now - cached.fetchedAt < KEY_TTL_MS) {
    touch(keyCache(), kid, cached, KEY_CACHE_MAX);
    return cached.key;
  }
  const missedAt = missCache().get(kid);
  if (missedAt !== undefined && now - missedAt < MISS_TTL_MS) {
    touch(missCache(), kid, missedAt, MISS_CACHE_MAX);
    return null;
  }
  const pending = lookups().get(kid);
  if (pending) return pending;

  const release = admitLookup(cached !== undefined, now);
  const lookup = (async () => {
    try {
      const key = await getWebhookVerificationKey(kid);
      if (!validKey(key, kid)) throw new WebhookLookupUnavailableError("invalid_key_metadata");
      touch(keyCache(), kid, { key, fetchedAt: Date.now() }, KEY_CACHE_MAX);
      missCache().delete(kid);
      return key;
    } catch (error) {
      if (definitiveMiss(error)) {
        touch(missCache(), kid, Date.now(), MISS_CACHE_MAX);
        return null;
      }
      if (error instanceof WebhookLookupUnavailableError) throw error;
      throw new WebhookLookupUnavailableError("key_provider_unavailable");
    } finally {
      release();
    }
  })();
  lookups().set(kid, lookup);
  try {
    return await lookup;
  } finally {
    if (lookups().get(kid) === lookup) lookups().delete(kid);
  }
}

function fail(reason: string): never {
  throw new WebhookVerificationError(reason);
}

// stale=true means correctly signed but over MAX_AGE_SECONDS old: the caller
// acks those without acting, so a delayed provider retry never trips Plaid's
// rejection circuit breaker (replaying costs nothing — ingestion is idempotent).
export async function verifyPlaidWebhook(
  rawBody: string,
  verificationJwt: string | null,
): Promise<{ stale: boolean }> {
  if (!verificationJwt || verificationJwt.length > 4096) fail("missing_header");

  let alg: string | undefined;
  let kid: string | undefined;
  try {
    ({ alg, kid } = decodeProtectedHeader(verificationJwt));
  } catch {
    fail("malformed_jwt");
  }
  if (alg !== "ES256") fail("wrong_algorithm");
  // Shape-checked before the key fetch: every novel kid costs a provider call
  // and a miss-cache slot, so garbage must die here.
  if (typeof kid !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(kid)) fail("malformed_kid");

  const key = await verificationKey(kid);
  if (!key) fail("unknown_key");
  if (key.expiredAt !== null) fail("expired_key");

  let payload: { iat?: number; request_body_sha256?: unknown };
  try {
    const publicJwk = { kty: key.kty, crv: key.crv, x: key.x, y: key.y };
    ({ payload } = await jwtVerify(verificationJwt, await importJWK(publicJwk, "ES256"), {
      algorithms: ["ES256"],
    }));
  } catch {
    fail("invalid_signature");
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  if (typeof payload.iat !== "number" || payload.iat > nowSeconds + MAX_AGE_SECONDS) {
    fail("invalid_iat");
  }

  const claimed = payload.request_body_sha256;
  if (typeof claimed !== "string" || !/^[0-9a-f]{64}$/.test(claimed)) fail("missing_body_hash");
  const actual = createHash("sha256").update(rawBody, "utf8").digest();
  if (!timingSafeEqual(actual, Buffer.from(claimed, "hex"))) fail("body_hash_mismatch");

  return { stale: nowSeconds - payload.iat > MAX_AGE_SECONDS };
}
