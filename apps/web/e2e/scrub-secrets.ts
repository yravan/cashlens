import fs from "node:fs";
import path from "node:path";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";

const MARKER = "[redacted-e2e-secret]";
const MIN_SECRET_LENGTH = 16;
// Clerk rotates session/client JWTs mid-run, so harvested values provably miss live
// tokens; these shapes also cover dev-browser and @clerk/testing (URL) tokens.
const TOKEN_SHAPES = [
  /\beyJ[\w-]{8,}\.[\w-]{8,}\.[\w-]{8,}/g,
  /\bdvb_[\w-]{10,}/g,
  /\b\d{10}-c_[\w-]{16,}/g,
];

type Parts = Record<string, string>;

function mapValues<A, B>(
  record: Record<string, A>,
  f: (value: A) => B,
): Record<string, B> {
  return Object.fromEntries(Object.entries(record).map(([k, v]) => [k, f(v)]));
}

export function collectSecrets(stateDir: string): string[] {
  const secrets = new Set<string>();
  const consider = (value: unknown) => {
    if (typeof value === "string" && value.length >= MIN_SECRET_LENGTH) {
      secrets.add(value);
    }
  };
  consider(process.env.CLERK_SECRET_KEY);
  for (const name of fs.existsSync(stateDir) ? fs.readdirSync(stateDir) : []) {
    if (!name.endsWith(".json")) continue;
    const state = JSON.parse(fs.readFileSync(path.join(stateDir, name), "utf8"));
    for (const cookie of state.cookies ?? []) consider(cookie.value);
    for (const origin of state.origins ?? []) {
      for (const item of origin.localStorage ?? []) consider(item.value);
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

function redact(text: string, secrets: string[]): string {
  let result = text;
  for (const secret of secrets) result = result.split(secret).join(MARKER);
  for (const shape of TOKEN_SHAPES) result = result.replace(shape, MARKER);
  return result;
}

// One part per zip entry; any other file is a single unnamed part, read as latin1
// so binary bytes survive the round-trip.
function readParts(file: string): Parts {
  const data = fs.readFileSync(file);
  if (!file.endsWith(".zip")) return { "": data.toString("latin1") };
  return mapValues(unzipSync(new Uint8Array(data)), (d) => strFromU8(d, true));
}

function writeParts(file: string, parts: Parts): void {
  const data = file.endsWith(".zip")
    ? zipSync(mapValues(parts, (text) => strToU8(text, true)))
    : Buffer.from(parts[""], "latin1");
  fs.writeFileSync(file, data);
}

export function scrub(dirs: string[], secrets: string[]): void {
  const files = dirs.flatMap(listFiles);
  for (const file of files) {
    const parts = readParts(file);
    const scrubbed = mapValues(parts, (text) => redact(text, secrets));
    if (Object.keys(parts).some((name) => scrubbed[name] !== parts[name])) {
      writeParts(file, scrubbed);
    }
  }

  const dirty = files.flatMap((file) =>
    Object.entries(readParts(file))
      .filter(([, text]) => redact(text, secrets) !== text)
      .map(([name]) => (name ? `${file} :: ${name}` : file)),
  );
  if (dirty.length > 0) {
    throw new Error(`secrets survived scrubbing in: ${dirty.join(", ")}`);
  }
}

export default function globalTeardown(): void {
  const webRoot = path.join(__dirname, "..");
  const resultsDir = path.join(webRoot, "test-results");
  scrub([resultsDir], collectSecrets(path.join(webRoot, "playwright/.clerk")));
  fs.mkdirSync(resultsDir, { recursive: true });
  fs.writeFileSync(path.join(resultsDir, ".scrubbed"), new Date().toISOString());
}
