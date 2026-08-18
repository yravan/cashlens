import { spawn, type ChildProcess } from "node:child_process";
import net from "node:net";
import path from "node:path";
import { expect, test } from "@playwright/test";

const BROKEN_DB_PORT = 3101;
const BROKEN_DB_APP_URL = `http://localhost:${BROKEN_DB_PORT}`;
const FAIL_FAST_BUDGET_MS = 15_000;

test.describe("fail-fast when the database is unreachable", () => {
  test.use({ baseURL: BROKEN_DB_APP_URL });

  // Accepts TCP connections and never replies: the worst case from the
  // 2026-08-17 incident, where connecting hangs instead of erroring.
  let blackhole: net.Server;
  const sockets: net.Socket[] = [];
  let server: ChildProcess;

  test.beforeAll(async () => {
    blackhole = net.createServer((socket) => sockets.push(socket));
    await new Promise<void>((resolve) =>
      blackhole.listen(0, "127.0.0.1", resolve),
    );
    const { port } = blackhole.address() as net.AddressInfo;

    const appDir = path.join(__dirname, "..");
    server = spawn(
      process.execPath,
      [
        path.join(appDir, "node_modules/next/dist/bin/next"),
        "start",
        "--port",
        String(BROKEN_DB_PORT),
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

    const signInStatus = () =>
      fetch(`${BROKEN_DB_APP_URL}/sign-in`).then((res) => res.status, () => 0);

    await expect
      .poll(signInStatus, {
        timeout: 60_000,
        message: "broken-db app server did not start",
      })
      .toBe(200);
  });

  test.afterAll(() => {
    server?.kill();
    blackhole.close();
    for (const socket of sockets) socket.destroy();
  });

  test("health endpoint reports the database as down, quickly", async ({
    request,
  }) => {
    const started = Date.now();
    const response = await request.get("/api/health");
    expect(Date.now() - started).toBeLessThan(FAIL_FAST_BUDGET_MS);
    expect(response.status()).toBe(503);
    expect(await response.json()).toEqual({ status: "error", db: "error" });
  });

  test("an authenticated data request fails fast instead of hanging", async ({
    request,
  }) => {
    const started = Date.now();
    const response = await request.get("/api/me");
    expect(Date.now() - started).toBeLessThan(FAIL_FAST_BUDGET_MS);
    expect(response.status()).toBe(500);
    const body = await response.text();
    expect(body).not.toContain("postgresql://");
    expect(body).not.toContain("cashlens_app");
    expect(body).not.toContain("127.0.0.1");
  });
});
