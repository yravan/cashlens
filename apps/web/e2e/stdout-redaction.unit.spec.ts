import fs from "node:fs";
import os from "node:os";
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

function runWithParentSignal(signal: NodeJS.Signals) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "redacted-signal-"));
  const readyFile = path.join(dir, "ready");
  const receivedFile = path.join(dir, "received");
  const pidFile = path.join(dir, "pid");
  const script = [
    "const fs = require('node:fs');",
    `process.on(${JSON.stringify(signal)}, () => { fs.writeFileSync(process.env.RECEIVED_FILE, 'received'); process.exit(17); });`,
    "fs.writeFileSync(process.env.PID_FILE, String(process.pid));",
    "fs.writeFileSync(process.env.READY_FILE, 'ready');",
    "setInterval(() => {}, 1000);",
  ].join(" ");

  return new Promise<{ code: number | null; signal: NodeJS.Signals | null; received: boolean; alive: boolean }>(
    (resolve, reject) => {
      const child = spawn(process.execPath, [WRAPPER, "--", process.execPath, "-e", script], {
        env: { ...process.env, READY_FILE: readyFile, RECEIVED_FILE: receivedFile, PID_FILE: pidFile },
        stdio: ["ignore", "ignore", "pipe"],
      });
      const sendSignal = setInterval(() => {
        if (fs.existsSync(readyFile)) {
          clearInterval(sendSignal);
          child.kill(signal);
        }
      }, 5);
      const timeout = setTimeout(() => child.kill("SIGKILL"), 3000);
      child.once("error", reject);
      child.once("close", (code, childSignal) => {
        clearInterval(sendSignal);
        clearTimeout(timeout);
        let alive = false;
        if (fs.existsSync(pidFile)) {
          const pid = Number(fs.readFileSync(pidFile, "utf8"));
          try {
            process.kill(pid, 0);
            alive = true;
            process.kill(pid, "SIGKILL");
          } catch {
            alive = false;
          }
        }
        const received = fs.existsSync(receivedFile);
        fs.rmSync(dir, { recursive: true, force: true });
        resolve({ code, signal: childSignal, received, alive });
      });
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

test("redacts individual lines of a multiline environment secret", async () => {
  const parts = ["synthetic_private_part_0123456789", "synthetic_private_part_abcdefghij"];
  const result = await runRedacted(process.execPath, ["-e", "process.stdout.write(process.env.PRIVATE_KEY + '\\nfinished\\n')"], {
    ...process.env, PRIVATE_KEY: parts.join("\n"),
  });
  expect(result.code).toBe(0);
  for (const part of parts) expect(result.stdout.includes(part)).toBe(false);
  expect(result.stdout).toContain("finished");
});

test("preserves UTF-8 when a code point is split across chunks", async () => {
  const script = [
    "const bytes = Buffer.from('diagnostic ✓\\n');",
    "process.stdout.write(bytes.subarray(0, bytes.length - 1));",
    "setTimeout(() => process.stdout.write(bytes.subarray(bytes.length - 1)), 10);",
  ].join(" ");
  const result = await runRedacted(process.execPath, ["-e", script], process.env);

  expect(result.code).toBe(0);
  expect(result.stdout).toContain("diagnostic ✓");
});

test("forwards parent SIGINT to the child and does not orphan it", async () => {
  const result = await runWithParentSignal("SIGINT");

  expect(result.code).toBe(17);
  expect(result.signal).toBeNull();
  expect(result.received).toBe(true);
  expect(result.alive).toBe(false);
});

test("forwards parent SIGTERM to the child and does not orphan it", async () => {
  const result = await runWithParentSignal("SIGTERM");

  expect(result.code).toBe(17);
  expect(result.signal).toBeNull();
  expect(result.received).toBe(true);
  expect(result.alive).toBe(false);
});

test("loads Next env-file secrets before spawning the child", async () => {
  const envFile = path.resolve(__dirname, "../.env.local");
  expect(fs.existsSync(envFile)).toBe(false);
  const secret = "env_file_secret_0123456789abcdef";
  fs.writeFileSync(envFile, `CASHLENS_REDACTION_SECRET=${secret}\n`);
  try {
    const env = { ...process.env };
    delete env.CASHLENS_REDACTION_SECRET;
    const result = await runRedacted(
      process.execPath,
      ["-e", "process.stdout.write('loaded=' + process.env.CASHLENS_REDACTION_SECRET)"],
      env,
    );

    expect(result.code).toBe(0);
    expect(result.stdout.includes(secret)).toBe(false);
    expect(result.stdout).toContain("loaded=[redacted-e2e-secret]");
  } finally {
    fs.rmSync(envFile, { force: true });
  }
});

test("flushes unterminated output and forwards a child signal", async () => {
  const secret = "unterminated_cookie_value_0123456789";
  const script = [
    "process.stdout.write('unterminated=' + process.env.CLERK_SECRET_KEY);",
    "process.stderr.write('diagnostic without newline');",
    "process.kill(process.pid, 'SIGTERM');",
  ].join(" ");
  const result = await runRedacted(process.execPath, ["-e", script], {
    ...process.env,
    CLERK_SECRET_KEY: secret,
  });

  expect(result.code).toBeNull();
  expect(result.signal).toBe("SIGTERM");
  expect(result.stdout.includes(secret)).toBe(false);
  expect(result.stderr).toContain("diagnostic without newline");
});

test("suppresses oversized unterminated output instead of leaking it", async () => {
  const secret = "oversized_cookie_value_0123456789";
  const script = [
    "process.stdout.write('x'.repeat(70 * 1024) + process.env.CLERK_SECRET_KEY);",
    "process.exit(24);",
  ].join(" ");
  const result = await runRedacted(process.execPath, ["-e", script], {
    ...process.env,
    CLERK_SECRET_KEY: secret,
  });

  expect(result.code).toBe(24);
  expect(result.stdout.includes(secret)).toBe(false);
  expect(result.stdout).toContain("[redacted-e2e-secret]");
});

test("suppresses the tail of an oversized line", async () => {
  const secret = "oversized_tail_cookie_value_0123456789";
  const script = [
    "const secret = process.env.CLERK_SECRET_KEY;",
    "process.stdout.write('x'.repeat(64 * 1024) + secret.slice(0, 12));",
    "setTimeout(() => process.stdout.write(secret.slice(12)), 10);",
    "setTimeout(() => process.exit(25), 20);",
  ].join(" ");
  const result = await runRedacted(process.execPath, ["-e", script], {
    ...process.env,
    CLERK_SECRET_KEY: secret,
  });

  expect(result.code).toBe(25);
  expect(result.stdout.includes(secret.slice(12))).toBe(false);
});

test("reports spawn failures generically", async () => {
  const result = await runRedacted("cashlens-command-that-does-not-exist", [], process.env);

  expect(result.code).not.toBe(0);
  expect(result.stderr).toContain("Unable to start E2E command.");
  expect(result.stderr).not.toContain("cashlens-command-that-does-not-exist");
});
