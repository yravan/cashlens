import fs from "node:fs";

import { E2E_USERS_FILE } from "../playwright.config";
import { adminQuery, adminTransaction } from "./db";
import { expect, test } from "./fixtures";

const CONFIGURED =
  !!process.env.PLAID_CLIENT_ID &&
  !!process.env.PLAID_SECRET &&
  process.env.PLAID_ENV === "sandbox";

test.describe("connection management (real sandbox)", () => {
  test.skip(!CONFIGURED, "PLAID_* sandbox keys not configured");

  function clerkIdA(): string {
    return JSON.parse(fs.readFileSync(E2E_USERS_FILE, "utf8")).a.clerkUserId;
  }

  async function cleanup() {
    const credentialed = await adminQuery(
      `select count(*)::int as n
         from connections c join connection_credentials cc on cc.connection_id = c.id
        where c.user_id in (select id from users where clerk_user_id = $1)`,
      [clerkIdA()],
    );
    if (credentialed.rows[0].n !== 0) {
      throw new Error("refusing to delete a connection before provider cleanup");
    }
    await adminQuery(
      `with mine as (select id from users where clerk_user_id = $1),
            cleared as (delete from accounts where user_id in (select id from mine))
       delete from connections where user_id in (select id from mine)`,
      [clerkIdA()],
    );
  }

  test.afterAll(cleanup);

  async function connectSandboxItem(page: import("@playwright/test").Page) {
    const minted = await fetch("https://sandbox.plaid.com/sandbox/public_token/create", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        client_id: process.env.PLAID_CLIENT_ID,
        secret: process.env.PLAID_SECRET,
        institution_id: "ins_109508",
        initial_products: ["transactions"],
      }),
    });
    expect(minted.status).toBe(200);
    const { public_token } = await minted.json();
    const exchanged = await page.request.post("/api/plaid/exchange", {
      data: { publicToken: public_token },
    });
    expect(exchanged.status()).toBe(200);
    const registered = await exchanged.json();
    return { connectionId: registered.connection.id as string, accounts: registered.accounts.length };
  }

  test("the management arc: status states, repair mint, disconnect with /item/remove, purge", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await page.goto("/accounts");
    await cleanup();
    const { connectionId, accounts } = await connectSandboxItem(page);
    const row = page.getByTestId(`connection-${connectionId}`);
    const status = row.getByTestId("connection-status");

    await page.goto("/accounts");
    await expect(row).toContainText("First Platypus Bank");
    await expect(status).toHaveText("Importing history");

    for (let poll = 0; poll < 30; poll += 1) {
      const advanced = await page.request.post(`/api/connections/${connectionId}/sync`);
      expect(advanced.status()).toBe(200);
      if ((await advanced.json()).backfillStatus === "complete") break;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    await page.reload();
    await expect(status).toHaveText("Connected");

    // The e2e process can never read the vaulted access token (the crypto
    // fence is the point), so the broken-login state is placed directly; the
    // in-band marking path is pinned by the api suite.
    await adminQuery("update connections set provider_error = 'ITEM_LOGIN_REQUIRED' where id = $1", [
      connectionId,
    ]);
    await page.reload();
    await expect(status).toHaveText("Needs attention");
    await expect(row).toContainText("sign in again");

    // Repair: the button mints a real update-mode link token with the real
    // vaulted access token, and Plaid Link mounts on it. The Link UI itself is
    // never driven (house rule) — completion logic is pinned by the api suite.
    const tokenResponse = page.waitForResponse("**/repair-token");
    await row.getByTestId("repair-connection").click();
    expect((await tokenResponse).status()).toBe(200);
    await expect(
      page.locator('iframe[id^="plaid-link-"], iframe[title="Plaid Link"]').first(),
    ).toBeAttached({ timeout: 20_000 });
    await page.reload();

    // Disconnect, keeping data: the real /item/remove must succeed first.
    await row.getByTestId("disconnect-connection").click();
    await expect(row.getByTestId("disconnect-confirm")).toContainText("access at the bank is revoked");
    await row.getByTestId("confirm-disconnect").click();
    await expect(status).toHaveText("Disconnected", { timeout: 15_000 });
    const afterDisconnect = await adminQuery(
      `select (select count(*)::int from connection_credentials where connection_id = $1) as credentials,
              (select count(*)::int from accounts where connection_id = $1) as accounts,
              (select status from connections where id = $1) as status`,
      [connectionId],
    );
    expect(afterDisconnect.rows[0].credentials).toBe(0);
    expect(afterDisconnect.rows[0].accounts).toBe(accounts);
    expect(afterDisconnect.rows[0].status).toBe("disconnected");

    // Purge the imported data: the row disappears once nothing is left.
    await row.getByTestId("purge-connection").click();
    await expect(row.getByTestId("disconnect-confirm")).toContainText("cannot be undone");
    await row.getByTestId("confirm-disconnect").click();
    await expect(row).toHaveCount(0, { timeout: 15_000 });
    const purged = await adminQuery(
      `select (select count(*)::int from accounts where user_id in (select id from users where clerk_user_id = $1)) as accounts,
              (select count(*)::int from transactions where user_id in (select id from users where clerk_user_id = $1)) as transactions,
              (select count(*)::int from account_balances where user_id in (select id from users where clerk_user_id = $1)) as balances`,
      [clerkIdA()],
    );
    expect(purged.rows[0]).toEqual({ accounts: 0, transactions: 0, balances: 0 });
  });

  test("opening Accounts retries an aged failed-connect cleanup", async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto("/accounts");
    await cleanup();
    const { connectionId } = await connectSandboxItem(page);

    try {
      await adminTransaction(async (client) => {
        await client.query(
          `create temporary table cleanup_fixture on commit drop as
             select c.*, cc.ciphertext, cc.created_at as credential_created_at,
                    cc.updated_at as credential_updated_at
               from connections c join connection_credentials cc on cc.connection_id = c.id
              where c.id = $1`,
          [connectionId],
        );
        await client.query("delete from accounts where connection_id = $1", [connectionId]);
        await client.query("delete from connections where id = $1", [connectionId]);
        await client.query(
          `insert into connections
             (id, user_id, provider, provider_item_id, institution_id, institution_name,
              status, backfill_status, sync_cursor, provider_error, webhook_url, created_at, updated_at)
             select id, user_id, provider, provider_item_id, institution_id, institution_name,
                    'cleanup_required', backfill_status, sync_cursor, provider_error, webhook_url,
                    created_at, now() - interval '3 minutes'
               from cleanup_fixture`,
        );
        await client.query(
          `insert into connection_credentials
             (connection_id, user_id, ciphertext, created_at, updated_at)
             select id, user_id, ciphertext, credential_created_at, credential_updated_at
               from cleanup_fixture`,
        );
      });

      const retried = page.waitForResponse(
        (response) =>
          response.request().method() === "POST" &&
          response.url().endsWith(`/api/connections/${connectionId}/cleanup`),
        { timeout: 10_000 },
      );
      await page.goto("/accounts");
      expect((await retried).status()).toBe(200);
      const cleaned = await adminQuery(
        `select c.status, count(cc.connection_id)::int as credentials
           from connections c left join connection_credentials cc on cc.connection_id = c.id
          where c.id = $1 group by c.id`,
        [connectionId],
      );
      expect(cleaned.rows[0]).toEqual({ status: "disconnected", credentials: 0 });
    } finally {
      const state = await adminQuery("select status from connections where id = $1", [connectionId]);
      if (state.rows[0]?.status === "active") {
        const removed = await page.request.post(`/api/connections/${connectionId}/disconnect`, {
          data: { purge: true },
        });
        expect(removed.status()).toBe(200);
      } else if (state.rows[0]?.status !== "disconnected") {
        await adminQuery(
          "update connections set updated_at = now() - interval '3 minutes' where id = $1",
          [connectionId],
        );
        const removed = await page.request.post(`/api/connections/${connectionId}/cleanup`);
        expect(removed.status()).toBe(200);
      }
      await cleanup();
    }
  });

  test("retries cleanup after the first successful response is lost in transit", async ({ page }) => {
    test.setTimeout(240_000);
    await page.goto("/accounts");
    await cleanup();
    const { connectionId } = await connectSandboxItem(page);
    const cleanupPath = `/api/connections/${connectionId}/cleanup`;
    let attempt = 0;
    let resolveFirst!: (status: number) => void;
    let rejectFirst!: (error: unknown) => void;
    const firstForwarded = new Promise<number>((resolve, reject) => {
      resolveFirst = resolve;
      rejectFirst = reject;
    });

    try {
      await adminTransaction(async (client) => {
        await client.query(
          `create temporary table cleanup_fixture on commit drop as
             select c.*, cc.ciphertext, cc.created_at as credential_created_at,
                    cc.updated_at as credential_updated_at
               from connections c join connection_credentials cc on cc.connection_id = c.id
              where c.id = $1`,
          [connectionId],
        );
        await client.query("delete from accounts where connection_id = $1", [connectionId]);
        await client.query("delete from connections where id = $1", [connectionId]);
        await client.query(
          `insert into connections
             (id, user_id, provider, provider_item_id, institution_id, institution_name,
              status, backfill_status, sync_cursor, provider_error, webhook_url, created_at, updated_at)
           select id, user_id, provider, provider_item_id, institution_id, institution_name,
                  'cleanup_required', backfill_status, sync_cursor, provider_error, webhook_url,
                  created_at, now() - interval '3 minutes'
             from cleanup_fixture`,
        );
        await client.query(
          `insert into connection_credentials
             (connection_id, user_id, ciphertext, created_at, updated_at)
           select id, user_id, ciphertext, credential_created_at, credential_updated_at
             from cleanup_fixture`,
        );
      });

      await page.route(`**${cleanupPath}`, async (route) => {
        const currentAttempt = attempt;
        attempt += 1;
        if (currentAttempt === 0) {
          try {
            // The provider removal and server-side tombstone are real; only the
            // already-completed browser response is discarded.
            const upstream = await route.fetch();
            const status = upstream.status();
            await route.abort("connectionreset");
            resolveFirst(status);
          } catch (error) {
            rejectFirst(error);
            await route.abort().catch(() => undefined);
          }
          return;
        }

        await route.continue();
      });

      const [firstStatus, secondResponse] = await Promise.all([
        firstForwarded,
        page.waitForResponse(
          (response) =>
            response.request().method() === "POST" && response.url().endsWith(cleanupPath),
          { timeout: 180_000 },
        ),
        page.goto("/accounts"),
      ]);
      expect(firstStatus).toBe(200);
      expect(secondResponse.status()).toBe(404);

      const cleaned = await adminQuery(
        `select c.status, count(cc.connection_id)::int as credentials
           from connections c left join connection_credentials cc on cc.connection_id = c.id
          where c.id = $1 group by c.id`,
        [connectionId],
      );
      expect(cleaned.rows[0]).toEqual({ status: "disconnected", credentials: 0 });
    } finally {
      await page.unroute(`**${cleanupPath}`);
      const state = await adminQuery("select status from connections where id = $1", [connectionId]);
      if (state.rows[0]?.status === "active") {
        const removed = await page.request.post(`/api/connections/${connectionId}/disconnect`, {
          data: { purge: true },
        });
        expect(removed.status()).toBe(200);
      } else if (state.rows[0]?.status !== "disconnected") {
        await adminQuery(
          "update connections set updated_at = now() - interval '3 minutes' where id = $1",
          [connectionId],
        );
        const removed = await page.request.post(cleanupPath);
        expect(removed.status()).toBe(200);
      }
      await cleanup();
    }
  });
});
