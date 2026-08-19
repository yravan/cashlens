import fs from "node:fs";
import path from "node:path";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";

const MARKER = "[redacted-e2e-secret]";
const MIN_SECRET_LENGTH = 16;
// Clerk dev-instance token shapes: session/client JWTs (rotated mid-run by
// clerkMiddleware, so value lists from storage state are not enough),
// dev-browser tokens, and @clerk/testing tokens (passed in URLs).
const TOKEN_SHAPES = () => [
  /\beyJ[\w-]{8,}\.[\w-]{8,}\.[\w-]{8,}/g,
  /\bdvb_[\w-]{10,}/g,
  /\b\d{10}-c_[\w-]{16,}/g,
];

export function collectSecrets(stateDir: string): string[] {
  const secrets = new Set<string>();
  const consider = (value: unknown) => {
    if (typeof value === "string" && value.length >= MIN_SECRET_LENGTH) {
      secrets.add(value);
    }
  };
  consider(process.env.CLERK_SECRET_KEY);
  if (fs.existsSync(stateDir)) {
    for (const name of fs.readdirSync(stateDir)) {
      if (!name.endsWith(".json")) continue;
      const state = JSON.parse(
        fs.readFileSync(path.join(stateDir, name), "utf8"),
      );
      for (const cookie of state.cookies ?? []) consider(cookie.value);
      for (const origin of state.origins ?? []) {
        for (const item of origin.localStorage ?? []) consider(item.value);
      }
    }
  }
  return [...secrets];
}

function listFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? listFiles(full) : [full];
  });
}

function redact(content: string, secrets: string[]): string {
  let result = content;
  for (const secret of secrets) result = result.split(secret).join(MARKER);
  for (const shape of TOKEN_SHAPES()) result = result.replace(shape, MARKER);
  return result;
}

function isClean(content: string, secrets: string[]): boolean {
  return (
    !secrets.some((secret) => content.includes(secret)) &&
    !TOKEN_SHAPES().some((shape) => shape.test(content))
  );
}

function zipEntries(file: string): Record<string, string> {
  const entries = unzipSync(new Uint8Array(fs.readFileSync(file)));
  return Object.fromEntries(
    Object.entries(entries).map(([name, data]) => [name, strFromU8(data, true)]),
  );
}

export function scrub(dirs: string[], secrets: string[]): void {
  const files = dirs.flatMap(listFiles);
  for (const file of files) {
    if (file.endsWith(".zip")) {
      const entries = zipEntries(file);
      const scrubbed = Object.fromEntries(
        Object.entries(entries).map(([name, text]) => [name, redact(text, secrets)]),
      );
      if (Object.keys(entries).some((name) => scrubbed[name] !== entries[name])) {
        fs.writeFileSync(
          file,
          zipSync(
            Object.fromEntries(
              Object.entries(scrubbed).map(([name, text]) => [name, strToU8(text, true)]),
            ),
          ),
        );
      }
    } else {
      const text = fs.readFileSync(file, "latin1");
      const scrubbed = redact(text, secrets);
      if (scrubbed !== text) fs.writeFileSync(file, scrubbed, "latin1");
    }
  }

  const dirty = files.flatMap((file) => {
    if (file.endsWith(".zip")) {
      return Object.entries(zipEntries(file))
        .filter(([, text]) => !isClean(text, secrets))
        .map(([name]) => `${file} :: ${name}`);
    }
    return isClean(fs.readFileSync(file, "latin1"), secrets) ? [] : [file];
  });
  if (dirty.length > 0) {
    throw new Error(`secrets survived scrubbing in: ${dirty.join(", ")}`);
  }
}

export default function globalTeardown(): void {
  const webRoot = path.join(__dirname, "..");
  const resultsDir = path.join(webRoot, "test-results");
  scrub(
    [resultsDir, path.join(webRoot, "playwright-report")],
    collectSecrets(path.join(webRoot, "playwright/.clerk")),
  );
  fs.mkdirSync(resultsDir, { recursive: true });
  fs.writeFileSync(path.join(resultsDir, ".scrubbed"), new Date().toISOString());
}
