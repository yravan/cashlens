import { inspect } from "node:util";
import { beforeEach, describe, expect, test } from "vitest";

import {
  CredentialCryptoError,
  decryptCredential,
  encryptCredential,
  SecretString,
} from "@/lib/crypto/credentials";

const KEY_A = "a".repeat(64);
const KEY_B = "b".repeat(64);
const CONTEXT = {
  userId: "0b6f913d-1234-4a5b-8c6d-000000000001",
  connectionId: "7c2e4f60-3a1b-4d2c-9e8f-000000000002",
};
const OTHER = {
  userId: "9d8c7b6a-5f4e-4d3c-8b2a-000000000003",
  connectionId: "1a2b3c4d-5e6f-4a8b-9c0d-000000000004",
};
const TOKEN = "access-sandbox-2f9a0d63-secret";

beforeEach(() => {
  process.env.CREDENTIAL_ENCRYPTION_KEYS = `k1:${KEY_A}`;
});

describe("roundtrip", () => {
  test("decrypts what it encrypted, for plain and unicode plaintexts", () => {
    for (const plaintext of [TOKEN, "x", "émoji 🔑 και κλειδί", "a".repeat(4096)]) {
      expect(decryptCredential(encryptCredential(plaintext, CONTEXT), CONTEXT)).toBe(plaintext);
    }
  });

  test("envelope is versioned, key-tagged, and never contains the plaintext", () => {
    const envelope = encryptCredential(TOKEN, CONTEXT);
    expect(envelope).toMatch(/^v1\.k1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(envelope).not.toContain(TOKEN);
    expect(Buffer.from(envelope).toString("hex")).not.toContain(Buffer.from(TOKEN).toString("hex"));
  });

  test("fresh nonce every call: same input, different envelopes, both decrypt", () => {
    const one = encryptCredential(TOKEN, CONTEXT);
    const two = encryptCredential(TOKEN, CONTEXT);
    expect(one).not.toBe(two);
    expect(decryptCredential(one, CONTEXT)).toBe(TOKEN);
    expect(decryptCredential(two, CONTEXT)).toBe(TOKEN);
  });

  test("rejects empty plaintext", () => {
    expect(() => encryptCredential("", CONTEXT)).toThrow(CredentialCryptoError);
  });
});

describe("tampering", () => {
  const flip = (envelope: string, segment: number, offset = 0) => {
    const parts = envelope.split(".");
    const bytes = Buffer.from(parts[segment], "base64url");
    bytes[offset] ^= 1;
    parts[segment] = bytes.toString("base64url");
    return parts.join(".");
  };

  test.each([
    ["nonce", (e: string) => flip(e, 2)],
    ["ciphertext", (e: string) => flip(e, 3)],
    ["auth tag", (e: string) => flip(e, 3, Buffer.from(e.split(".")[3], "base64url").length - 1)],
    ["version", (e: string) => e.replace(/^v1/, "v9")],
    ["key id casing", (e: string) => e.replace(".k1.", ".K1.")],
    ["truncation", (e: string) => e.slice(0, -2)],
    ["segment count", (e: string) => `${e}.extra`],
    ["not an envelope", () => "garbage"],
    ["empty", () => ""],
  ])("rejects a tampered %s with one generic error", (_name, mutate) => {
    const envelope = encryptCredential(TOKEN, CONTEXT);
    expect(() => decryptCredential(mutate(envelope), CONTEXT)).toThrow(
      new CredentialCryptoError("credential decryption failed"),
    );
  });

  test("error never carries plaintext or key material", () => {
    const envelope = encryptCredential(TOKEN, CONTEXT);
    try {
      decryptCredential(envelope.slice(0, -2), CONTEXT);
      expect.unreachable();
    } catch (error) {
      const message = String((error as Error).message) + String((error as Error).stack);
      expect(message).not.toContain(TOKEN);
      expect(message).not.toContain(KEY_A);
    }
  });
});

describe("owner binding (AAD)", () => {
  test.each([
    ["another user", { ...CONTEXT, userId: OTHER.userId }],
    ["another connection", { ...CONTEXT, connectionId: OTHER.connectionId }],
    ["fields swapped", { userId: CONTEXT.connectionId, connectionId: CONTEXT.userId }],
  ])("a ciphertext moved to %s does not decrypt", (_name, context) => {
    const envelope = encryptCredential(TOKEN, CONTEXT);
    expect(() => decryptCredential(envelope, context)).toThrow(CredentialCryptoError);
  });

  test("rejects malformed context ids instead of weakening the binding", () => {
    expect(() => encryptCredential(TOKEN, { userId: "not-a-uuid", connectionId: CONTEXT.connectionId })).toThrow(
      CredentialCryptoError,
    );
    expect(() => encryptCredential(TOKEN, { userId: `${CONTEXT.userId}:x`, connectionId: CONTEXT.connectionId })).toThrow(
      CredentialCryptoError,
    );
  });
});

describe("keyring", () => {
  test("rotation: first entry encrypts, older entries still decrypt", () => {
    const old = encryptCredential(TOKEN, CONTEXT);
    process.env.CREDENTIAL_ENCRYPTION_KEYS = `k2:${KEY_B},k1:${KEY_A}`;
    expect(decryptCredential(old, CONTEXT)).toBe(TOKEN);
    const fresh = encryptCredential(TOKEN, CONTEXT);
    expect(fresh.startsWith("v1.k2.")).toBe(true);
    expect(decryptCredential(fresh, CONTEXT)).toBe(TOKEN);
  });

  test.each([
    ["holds different material under the same id", `k1:${KEY_B}`],
    ["lost the envelope's key id", `k2:${KEY_B}`],
  ])("decrypt under a keyring that %s is a generic failure", (_name, ring) => {
    const envelope = encryptCredential(TOKEN, CONTEXT);
    process.env.CREDENTIAL_ENCRYPTION_KEYS = ring;
    expect(() => decryptCredential(envelope, CONTEXT)).toThrow(
      new CredentialCryptoError("credential decryption failed"),
    );
  });

  test.each([
    ["unset", undefined],
    ["empty", ""],
    ["placeholder", "k1:REPLACE_ME"],
    ["short key", `k1:${"a".repeat(63)}`],
    ["non-hex key", `k1:${"g".repeat(64)}`],
    ["missing id", `:${KEY_A}`],
    ["bad id", `k 1:${KEY_A}`],
    ["duplicate ids", `k1:${KEY_A},k1:${KEY_B}`],
  ])("a %s keyring fails closed and the error never echoes the value", (_name, value) => {
    if (value === undefined) delete process.env.CREDENTIAL_ENCRYPTION_KEYS;
    else process.env.CREDENTIAL_ENCRYPTION_KEYS = value;
    try {
      encryptCredential(TOKEN, CONTEXT);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(CredentialCryptoError);
      expect((error as Error).message).toContain("CREDENTIAL_ENCRYPTION_KEYS");
      if (value) expect((error as Error).message).not.toContain(value);
    }
  });
});

describe("SecretString", () => {
  const secret = new SecretString(TOKEN);

  test("expose() returns the value; nothing else does", () => {
    expect(secret.expose()).toBe(TOKEN);
    expect(`${secret}`).not.toContain(TOKEN);
    expect(String(secret)).not.toContain(TOKEN);
    expect(inspect(secret)).not.toContain(TOKEN);
    expect(inspect({ nested: [secret] })).not.toContain(TOKEN);
  });

  test("JSON serialization throws instead of leaking", () => {
    expect(() => JSON.stringify(secret)).toThrow(CredentialCryptoError);
    expect(() => JSON.stringify({ data: { secret } })).toThrow(CredentialCryptoError);
  });

  test("own enumerable state never carries the value", () => {
    expect(JSON.parse(JSON.stringify({ ...secret }))).toEqual({});
    expect(Object.entries(secret).flat()).not.toContain(TOKEN);
  });
});
