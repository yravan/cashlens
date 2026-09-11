import fs from "node:fs";
import path from "node:path";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";

import { collectSecrets, redact } from "./redaction.mjs";

export { collectSecrets } from "./redaction.mjs";

type Parts = Record<string, string>;

function mapValues<A, B>(
  record: Record<string, A>,
  f: (value: A) => B,
): Record<string, B> {
  return Object.fromEntries(Object.entries(record).map(([k, v]) => [k, f(v)]));
}

function listFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? listFiles(full) : [full];
  });
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
