import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { StringDecoder } from "node:string_decoder";
import { Transform } from "node:stream";
import nextEnv from "@next/env";

import { collectSecrets, MARKER, redact } from "../e2e/redaction.mjs";

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MAX_PENDING_CHARS = 64 * 1024;
const { loadEnvConfig } = nextEnv;

function forwardRedacted(input, output, secrets) {
  const decoder = new StringDecoder("utf8");
  let pending = "";
  let discarding = false;
  const redactor = new Transform({
    transform(chunk, _encoding, callback) {
      pending += decoder.write(chunk);
      while (pending) {
        const newline = pending.indexOf("\n");
        if (discarding) {
          if (newline === -1) {
            pending = "";
            break;
          }
          pending = pending.slice(newline + 1);
          discarding = false;
          continue;
        }
        if (newline !== -1) {
          if (newline + 1 > MAX_PENDING_CHARS) {
            this.push(`${MARKER}\n`);
            pending = pending.slice(newline + 1);
            continue;
          }
          this.push(redact(pending.slice(0, newline + 1), secrets));
          pending = pending.slice(newline + 1);
          continue;
        }
        if (pending.length >= MAX_PENDING_CHARS) {
          this.push(`${MARKER}\n`);
          pending = "";
          discarding = true;
        }
        break;
      }
      callback();
    },
    flush(callback) {
      pending += decoder.end();
      if (!discarding && pending) this.push(redact(pending, secrets));
      callback();
    },
  });
  redactor.on("error", (error) => input.destroy(error));
  input.pipe(redactor).pipe(output, { end: false });
  return new Promise((resolve, reject) => {
    redactor.once("end", resolve);
    redactor.once("error", reject);
  });
}

const separator = process.argv.indexOf("--");
const command = separator === -1 ? [] : process.argv.slice(separator + 1);
if (command.length === 0) {
  process.stderr.write("Unable to start E2E command.\n");
  process.exitCode = 1;
} else {
  try {
    loadEnvConfig(webRoot, true);
    const secrets = collectSecrets(path.join(webRoot, "playwright/.clerk"));
    const child = spawn(command[0], command.slice(1), {
      cwd: process.cwd(),
      env: process.env,
      stdio: ["inherit", "pipe", "pipe"],
    });
    const streams = [
      forwardRedacted(child.stdout, process.stdout, secrets),
      forwardRedacted(child.stderr, process.stderr, secrets),
    ];

    let spawnFailed = false;
    const signalHandlers = new Map();
    for (const signal of ["SIGINT", "SIGTERM"]) {
      const handler = () => {
        if (child.exitCode === null && child.signalCode === null) child.kill(signal);
      };
      signalHandlers.set(signal, handler);
      process.once(signal, handler);
    }
    const removeSignalHandlers = () => {
      for (const [signal, handler] of signalHandlers) process.removeListener(signal, handler);
    };

    child.once("error", async () => {
      spawnFailed = true;
      removeSignalHandlers();
      await Promise.allSettled(streams);
      process.stderr.write("Unable to start E2E command.\n");
      process.exitCode = 1;
    });
    child.once("close", async (code, signal) => {
      if (spawnFailed) return;
      removeSignalHandlers();
      await Promise.allSettled(streams);
      if (signal) process.kill(process.pid, signal);
      else process.exitCode = code ?? 1;
    });
  } catch {
    process.stderr.write("Unable to initialize E2E redaction.\n");
    process.exitCode = 1;
  }
}
