import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
import { decodeProtectedHeader, importJWK, jwtVerify } from "jose";

import { getWebhookVerificationKey, type WebhookVerificationKey } from "@/lib/plaid/client";

export class WebhookVerificationError extends Error {}

const MAX_AGE_SECONDS = 5 * 60;
const MISS_TTL_MS = 5 * 60 * 1000;
const MISS_CACHE_MAX = 1000;

const globalForKeys = globalThis as unknown as {
  cashlensPlaidWebhookKeys?: Map<string, WebhookVerificationKey>;
  cashlensPlaidWebhookKeyMisses?: Map<string, number>;
};
const keyCache = () => (globalForKeys.cashlensPlaidWebhookKeys ??= new Map());
const missCache = () => (globalForKeys.cashlensPlaidWebhookKeyMisses ??= new Map());

export function resetWebhookKeyCache(): void {
  keyCache().clear();
  missCache().clear();
}

async function verificationKey(kid: string): Promise<WebhookVerificationKey | null> {
  const cached = keyCache().get(kid);
  if (cached) return cached;
  const missedAt = missCache().get(kid);
  if (missedAt !== undefined && Date.now() - missedAt < MISS_TTL_MS) return null;

  let key: WebhookVerificationKey;
  try {
    key = await getWebhookVerificationKey(kid);
  } catch {
    if (missCache().size >= MISS_CACHE_MAX) missCache().clear();
    missCache().set(kid, Date.now());
    return null;
  }
  keyCache().set(kid, key);
  // A genuinely new key means Plaid may have rotated: refresh every cached key
  // still marked unexpired so stale ones start being rejected.
  for (const [id, stale] of keyCache()) {
    if (id !== kid && stale.expiredAt === null) {
      try {
        keyCache().set(id, await getWebhookVerificationKey(id));
      } catch {
        // keep the cached copy; the next unknown-kid fetch retries
      }
    }
  }
  return key;
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
