import { AsyncLocalStorage } from "node:async_hooks";
import { randomBytes } from "node:crypto";

import type { auth as realAuth } from "@clerk/nextjs/server";

// vitest.config.mts aliases `@clerk/nextjs/server` to this file for the api suite.

type SessionAuth = Awaited<ReturnType<typeof realAuth>>;

const scope = new AsyncLocalStorage<string>();

const BASE62 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

function base62(length: number): string {
  return Array.from(randomBytes(length), (byte) => BASE62[byte % BASE62.length]).join("");
}

export function fakeClerkUserId(): string {
  return `user_${base62(27)}`;
}

export function withAuth<T>(clerkUserId: string, fn: () => Promise<T>): Promise<T> {
  return scope.run(clerkUserId, fn);
}

function refuse(surface: string): never {
  throw new Error(
    `${surface} is not implemented by the api-suite Clerk substitute (tests/harness/clerk.ts) — extend it when production code grows a real use`,
  );
}

function unsignedJwt(claims: object): string {
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "none", typ: "JWT" })}.${encode(claims)}.`;
}

function sessionAuth(): SessionAuth {
  const userId = scope.getStore();
  const redirects = {
    redirectToSignIn: () => refuse("redirectToSignIn()"),
    redirectToSignUp: () => refuse("redirectToSignUp()"),
  };
  if (!userId) {
    return {
      tokenType: "session_token",
      sessionClaims: null,
      sessionId: null,
      sessionStatus: null,
      actor: null,
      userId: null,
      orgId: null,
      orgRole: null,
      orgSlug: null,
      orgPermissions: null,
      factorVerificationAge: null,
      getToken: async () => null,
      has: () => false,
      debug: () => ({}),
      isAuthenticated: false,
      ...redirects,
    };
  }

  const sessionId = `sess_${base62(27)}`;
  const iat = Math.floor(Date.now() / 1000);
  const claims = {
    azp: "http://localhost:3000",
    exp: iat + 60,
    fva: [0, -1] as [number, number],
    iat,
    iss: "https://api-suite.clerk.accounts.dev",
    nbf: iat - 5,
    sid: sessionId,
    sub: userId,
    v: 2 as const,
  };
  return {
    tokenType: "session_token",
    sessionClaims: { ...claims, __raw: unsignedJwt(claims) },
    sessionId,
    sessionStatus: "active",
    actor: undefined,
    userId,
    orgId: undefined,
    orgRole: undefined,
    orgSlug: undefined,
    orgPermissions: undefined,
    factorVerificationAge: [0, -1],
    getToken: () => refuse("getToken()"),
    has: () => refuse("has()"),
    debug: () => ({}),
    isAuthenticated: true,
    ...redirects,
  };
}

export const auth = Object.assign(async () => sessionAuth(), {
  protect: () => refuse("auth.protect()"),
});
