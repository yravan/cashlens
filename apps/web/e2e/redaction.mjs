import fs from "node:fs";
import path from "node:path";

export const MARKER = "[redacted-e2e-secret]";
const MIN_SECRET_LENGTH = 16;
const SECRET_ENV_NAME = /(?:SECRET|TOKEN|PASSWORD|PRIVATE|CREDENTIAL|DATABASE_URL|API_KEY)/i;
const TOKEN_SHAPES = [
  /\beyJ[\w-]{8,}\.[\w-]{8,}\.[\w-]{8,}/g,
  /\bdvb_[\w-]{10,}/g,
  /\b\d{10}-c_[\w-]{16,}/g,
  /\b(?:access|public|link)-(?:sandbox|production)-[\w-]{10,}/g,
];
const CLERK_QUERY_VALUE = /([?&]__clerk_[A-Za-z0-9_.-]+=)[^&#\s"'<>\\)]*/gi;
const COLLECTION_ERROR = "Unable to collect E2E redaction secrets.";

export function collectSecrets(stateDir, env = process.env) {
  const secrets = new Set();
  const consider = (value) => {
    if (typeof value === "string" && value.length >= MIN_SECRET_LENGTH) {
      secrets.add(value);
      for (const line of value.split(/\r?\n/)) if (line) secrets.add(line);
    }
  };
  for (const [name, value] of Object.entries(env)) {
    if (SECRET_ENV_NAME.test(name)) consider(value);
  }
  try {
    for (const name of fs.existsSync(stateDir) ? fs.readdirSync(stateDir) : []) {
      if (!name.endsWith(".json")) continue;
      const state = JSON.parse(fs.readFileSync(path.join(stateDir, name), "utf8"));
      for (const cookie of state.cookies ?? []) consider(cookie.value);
      for (const origin of state.origins ?? []) {
        for (const item of origin.localStorage ?? []) consider(item.value);
      }
    }
  } catch {
    throw new Error(COLLECTION_ERROR);
  }
  return [...secrets];
}

export function redact(text, secrets) {
  let result = text;
  for (const secret of secrets) result = result.split(secret).join(MARKER);
  for (const shape of TOKEN_SHAPES) {
    result = result.replace(new RegExp(shape.source, "g"), MARKER);
  }
  return result.replace(CLERK_QUERY_VALUE, `$1${MARKER}`);
}
