import { spawn } from "node:child_process";
import path from "node:path";

import { expect, test } from "@playwright/test";

const WRAPPER = path.resolve(__dirname, "../scripts/run-e2e-redacted.mjs");
const EXIT_CODE = 23;

function runRedacted(command: string, args: string[], env: NodeJS.ProcessEnv) {
  return new Promise<{ code: number | null; signal: NodeJS.Signals | null; stdout: string; stderr: string }>(
    (resolve, reject) => {
      const child = spawn(process.execPath, [WRAPPER, "--", command, ...args], {
        env,
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        stdout += chunk;
      });
      child.stderr.on("data", (chunk: string) => {
        stderr += chunk;
      });
      child.once("error", reject);
      child.once("close", (code, signal) => resolve({ code, signal, stdout, stderr }));
    },
  );
}

test("redacts secrets across stdout/stderr chunks while preserving diagnostics and exit status", async () => {
  const envSecret = "seed_cookie_value_0123456789abcdef";
  const token = "dvb_2xJq8vLpR3sT5uW7yZ9aBcDeF";
  const script = [
    "const secret = process.env.CLERK_SECRET_KEY;",
    "process.stdout.write('stdout before\\n');",
    "process.stdout.write('url=https://fapi.example/v1/client?__clerk_db_jwt=' + secret.slice(0, 9));",
    "setTimeout(() => process.stdout.write(secret.slice(9) + '\\nstdout after\\n'), 10);",
    "process.stderr.write('stderr before\\nwarning: https://fapi.example/v1/client?__clerk_db_jwt=' + 'dvb_2xJq8vLpR3sT5uW7');",
    "setTimeout(() => { process.stderr.write('yZ9aBcDeF\\nstderr after\\n'); process.exit(23); }, 20);",
  ].join(" ");

  const result = await runRedacted(process.execPath, ["-e", script], {
    ...process.env,
    CLERK_SECRET_KEY: envSecret,
  });

  expect(result.code).toBe(EXIT_CODE);
  expect(result.signal).toBeNull();
  expect(result.stdout.includes(envSecret)).toBe(false);
  expect(result.stderr.includes(token)).toBe(false);
  expect(result.stdout).toContain("stdout before");
  expect(result.stdout).toContain("stdout after");
  expect(result.stderr).toContain("stderr before");
  expect(result.stderr).toContain("stderr after");
});
