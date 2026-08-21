import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { inspect } from "node:util";

const VERSION = "v1";
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const MAX_PLAINTEXT_BYTES = 8192;
const KEY_ID_PATTERN = /^[A-Za-z0-9_-]{1,16}$/;
const KEY_HEX_PATTERN = /^[0-9a-f]{64}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ENV_VAR = "CREDENTIAL_ENCRYPTION_KEYS";
const KEYRING_FORMAT = `${ENV_VAR} must be "id:64-hex-chars" entries separated by commas, first entry encrypts — generate a key with: openssl rand -hex 32`;

export class CredentialCryptoError extends Error {}

export type CredentialContext = {
  userId: string;
  connectionId: string;
};

type Keyring = {
  primary: { id: string; key: Buffer };
  byId: Map<string, Buffer>;
};

function keyring(): Keyring {
  const raw = process.env[ENV_VAR];
  if (!raw) throw new CredentialCryptoError(`${ENV_VAR} is not set — ${KEYRING_FORMAT}`);
  const byId = new Map<string, Buffer>();
  let primary: Keyring["primary"] | undefined;
  for (const entry of raw.split(",")) {
    const colon = entry.indexOf(":");
    const id = colon < 0 ? "" : entry.slice(0, colon);
    const hex = entry.slice(colon + 1);
    if (!KEY_ID_PATTERN.test(id) || !KEY_HEX_PATTERN.test(hex) || byId.has(id)) {
      throw new CredentialCryptoError(KEYRING_FORMAT);
    }
    const key = Buffer.from(hex, "hex");
    byId.set(id, key);
    primary ??= { id, key };
  }
  if (!primary) throw new CredentialCryptoError(KEYRING_FORMAT);
  return { primary, byId };
}

function aad(keyId: string, context: CredentialContext): Buffer {
  if (!UUID_PATTERN.test(context.userId) || !UUID_PATTERN.test(context.connectionId)) {
    throw new CredentialCryptoError("credential context requires uuid ids");
  }
  return Buffer.from(
    `cashlens:connection-credential:${VERSION}.${keyId}:${context.userId.toLowerCase()}:${context.connectionId.toLowerCase()}`,
  );
}

export function encryptCredential(plaintext: string, context: CredentialContext): string {
  const bytes = Buffer.from(plaintext, "utf8");
  if (bytes.length === 0 || bytes.length > MAX_PLAINTEXT_BYTES) {
    throw new CredentialCryptoError("credential plaintext must be 1 to 8192 bytes");
  }
  const { primary } = keyring();
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv("aes-256-gcm", primary.key, nonce);
  cipher.setAAD(aad(primary.id, context));
  const sealed = Buffer.concat([cipher.update(bytes), cipher.final(), cipher.getAuthTag()]);
  return `${VERSION}.${primary.id}.${nonce.toString("base64url")}.${sealed.toString("base64url")}`;
}

const DECRYPT_FAILED = "credential decryption failed";

export function decryptCredential(envelope: string, context: CredentialContext): string {
  const ring = keyring();
  try {
    const [version, keyId, nonceText, sealedText, ...rest] = envelope.split(".");
    if (version !== VERSION || rest.length > 0) throw new Error("bad envelope");
    const key = ring.byId.get(keyId);
    if (!key) throw new Error("unknown key id");
    const nonce = Buffer.from(nonceText, "base64url");
    const sealed = Buffer.from(sealedText, "base64url");
    if (nonce.length !== NONCE_BYTES || sealed.length <= TAG_BYTES) throw new Error("bad envelope");
    const decipher = createDecipheriv("aes-256-gcm", key, nonce);
    decipher.setAAD(aad(keyId, context));
    decipher.setAuthTag(sealed.subarray(sealed.length - TAG_BYTES));
    return Buffer.concat([
      decipher.update(sealed.subarray(0, sealed.length - TAG_BYTES)),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    throw new CredentialCryptoError(DECRYPT_FAILED);
  }
}

export class SecretString {
  readonly #value: string;

  constructor(value: string) {
    this.#value = value;
  }

  expose(): string {
    return this.#value;
  }

  toString(): string {
    return "[redacted]";
  }

  toJSON(): never {
    throw new CredentialCryptoError("SecretString must never be serialized — call expose() where the value is spent");
  }

  [inspect.custom](): string {
    return "SecretString [redacted]";
  }
}
