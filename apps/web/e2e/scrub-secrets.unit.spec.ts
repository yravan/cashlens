import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";

import { collectSecrets, scrub } from "./scrub-secrets";

const SEED_SECRET = "seed_cookie_value_0123456789abcdef";
const ROTATED_JWT =
  "eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJyb3RhdGVkIn0.c2lnbmF0dXJlLXJvdGF0ZWQ";
const DEV_BROWSER_TOKEN = "dvb_2xJq8vLpR3sT5uW7yZ9aBcDeF";
const TESTING_TOKEN = "1713877200-c_2J2MvPu9PnXcuhbPZNao0LOXqK9A7YrnBn0HmIWxy";

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "scrub-test-"));
}

test("planted secret values are removed from loose files, other content intact", () => {
  const dir = tmpDir();
  const file = path.join(dir, "error-context.md");
  fs.writeFileSync(file, `before\ncookie: __session=${SEED_SECRET}; ok\nafter`);

  scrub([dir], [SEED_SECRET]);

  const scrubbed = fs.readFileSync(file, "utf8");
  expect(scrubbed).not.toContain(SEED_SECRET);
  expect(scrubbed).toContain("[redacted-e2e-secret]");
  expect(scrubbed).toContain("before");
  expect(scrubbed).toContain("after");
  expect(scrubbed).toContain("cookie: __session=");
});

test("secrets inside trace zips are removed and the zip stays readable", () => {
  const dir = tmpDir();
  const traceLine = JSON.stringify({
    type: "log",
    message: `  cookie: __session=${SEED_SECRET}`,
  });
  const zipped = zipSync({
    "0-trace.trace": strToU8(traceLine),
    "0-trace.network": strToU8(`{"headers":[{"name":"cookie","value":"${SEED_SECRET}"}]}`),
    "resources/innocent.css": strToU8("body { color: red }"),
  });
  const file = path.join(dir, "trace.zip");
  fs.writeFileSync(file, zipped);

  scrub([dir], [SEED_SECRET]);

  const entries = unzipSync(new Uint8Array(fs.readFileSync(file)));
  for (const name of ["0-trace.trace", "0-trace.network"]) {
    const text = strFromU8(entries[name]);
    expect(text).not.toContain(SEED_SECRET);
    expect(text).toContain("[redacted-e2e-secret]");
  }
  expect(strFromU8(entries["0-trace.trace"])).toContain('"type":"log"');
  expect(strFromU8(entries["resources/innocent.css"])).toBe("body { color: red }");
});

test("token-shaped values missing from the value list are still scrubbed", () => {
  const dir = tmpDir();
  const file = path.join(dir, "trace.txt");
  fs.writeFileSync(
    file,
    [
      `set-cookie: __session=${ROTATED_JWT}; Path=/`,
      `url: https://x.clerk.accounts.dev/v1/client?__clerk_db_jwt=${DEV_BROWSER_TOKEN}`,
      `url: https://x.clerk.accounts.dev/v1/sign_ups?__clerk_testing_token=${TESTING_TOKEN}`,
      "status: 200 OK",
    ].join("\n"),
  );

  scrub([dir], []);

  const scrubbed = fs.readFileSync(file, "utf8");
  expect(scrubbed).not.toContain(ROTATED_JWT);
  expect(scrubbed).not.toContain(DEV_BROWSER_TOKEN);
  expect(scrubbed).not.toContain(TESTING_TOKEN);
  expect(scrubbed).toContain("status: 200 OK");
  expect(scrubbed).toContain("__clerk_db_jwt=[redacted-e2e-secret]");
});

test("collectSecrets harvests storage-state cookie and localStorage values, skipping short non-secrets", () => {
  const dir = tmpDir();
  fs.writeFileSync(
    path.join(dir, "user-a.json"),
    JSON.stringify({
      cookies: [
        { name: "__session", value: SEED_SECRET },
        { name: "__client_uat", value: "1787155005" },
      ],
      origins: [
        {
          origin: "http://localhost:3100",
          localStorage: [
            { name: "__clerk_db_jwt", value: DEV_BROWSER_TOKEN },
            { name: "flag", value: "1" },
          ],
        },
      ],
    }),
  );
  fs.writeFileSync(
    path.join(dir, "users.json"),
    JSON.stringify({ a: { email: "x@example.com", clerkUserId: "user_123" } }),
  );

  const secrets = collectSecrets(dir);

  expect(secrets).toContain(SEED_SECRET);
  expect(secrets).toContain(DEV_BROWSER_TOKEN);
  expect(secrets).not.toContain("1787155005");
  expect(secrets).not.toContain("1");
  expect(secrets).not.toContain("user_123");
});

test("scrubbing a missing directory is a no-op", () => {
  scrub([path.join(tmpDir(), "does-not-exist")], [SEED_SECRET]);
});
