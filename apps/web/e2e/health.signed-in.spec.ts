import { spawn, type ChildProcess } from "node:child_process";
import net from "node:net";
import path from "node:path";
import { expect, test } from "@playwright/test";

import { STORAGE_STATE_A } from "../playwright.config";

const BROKEN_DB_APP_URL = "http://localhost:3101";
const FAIL_FAST_BUDGET_MS = 15_000;

test("health endpoint reports ok without authentication", async ({
  playwright,
  baseURL,
}) => {
  const anonymous = await playwright.request.newContext({ baseURL });
  try {
    const response = await anonymous.get("/api/health", { maxRedirects: 0 });
    expect(response.status()).toBe(200);
    expect(await response.json()).toEqual({ status: "ok", db: "ok" });
    expect(response.headers()["cache-control"]).toBe("no-store");
  } finally {
    await anonymous.dispose();
  }
});

test.describe("fail-fast when the database is unreachable", () => {
  // A server that accepts TCP connections and never replies: the worst case
  // from the 2026-08-17 incident, where connection attempts hang instead of
  // erroring.
  let blackhole: net.Server;
  const blackholeSockets = new Set<net.Socket>();
  let server: ChildProcess;

  test.beforeAll(async () => {
    blackhole = net.createServer((socket) => {
      blackholeSockets.add(socket);
      socket.on("close", () => blackholeSockets.delete(socket));
    });
    await new Promise<void>((resolve) =>
      blackhole.listen(0, "127.0.0.1", resolve),
    );
    const { port } = blackhole.address() as net.AddressInfo;

    const appDir = path.join(__dirname, "..");
    server = spawn(
      process.execPath,
      [
        path.join(appDir, "node_modules", "next", "dist", "bin", "next"),
        "start",
        "--port",
        "3101",
      ],
      {
        cwd: appDir,
        env: {
          ...process.env,
          DATABASE_URL: `postgresql://cashlens_app:unreachable@127.0.0.1:${port}/cashlens`,
        },
        stdio: "ignore",
      },
    );

    const deadline = Date.now() + 60_000;
    for (;;) {
      try {
        const response = await fetch(`${BROKEN_DB_APP_URL}/sign-in`);
        if (response.status < 500) break;
      } catch {}
      if (Date.now() > deadline)
        throw new Error("broken-db app server did not start");
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  });

  test.afterAll(async () => {
    server?.kill();
    for (const socket of blackholeSockets) socket.destroy();
    await new Promise<void>((resolve) => blackhole.close(() => resolve()));
  });

  test("health endpoint reports the database as down, quickly", async ({
    playwright,
  }) => {
    const anonymous = await playwright.request.newContext({
      baseURL: BROKEN_DB_APP_URL,
    });
    try {
      const started = Date.now();
      const response = await anonymous.get("/api/health", {
        timeout: 30_000,
      });
      expect(Date.now() - started).toBeLessThan(FAIL_FAST_BUDGET_MS);
      expect(response.status()).toBe(503);
      expect(await response.json()).toEqual({ status: "error", db: "error" });
    } finally {
      await anonymous.dispose();
    }
  });

  test("an authenticated data request fails fast instead of hanging", async ({
    playwright,
  }) => {
    const signedIn = await playwright.request.newContext({
      baseURL: BROKEN_DB_APP_URL,
      storageState: STORAGE_STATE_A,
    });
    try {
      const started = Date.now();
      const response = await signedIn.get("/api/me", { timeout: 30_000 });
      expect(Date.now() - started).toBeLessThan(FAIL_FAST_BUDGET_MS);
      expect(response.status()).toBe(500);
      const body = await response.text();
      expect(body).not.toContain("postgresql://");
      expect(body).not.toContain("cashlens_app");
      expect(body).not.toContain("127.0.0.1");
    } finally {
      await signedIn.dispose();
    }
  });
});
