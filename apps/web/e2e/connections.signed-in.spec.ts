import fs from "node:fs";
import { clerk, clerkSetup } from "@clerk/testing/playwright";

import { E2E_USER_A_EMAIL, E2E_USERS_FILE } from "../playwright.config";
import { adminQuery } from "./db";
import { expect, test } from "./fixtures";
import { cleanupSandboxRows, disconnectSandboxItems } from "./sandbox-cleanup";

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
    await cleanupSandboxRows(clerkIdA());
  }

  test.afterEach(async ({ page }) => {
    await disconnectSandboxItems(page, clerkIdA());
    await cleanup();
    const remaining = await adminQuery(
      `select count(*)::int as n from connections
        where user_id in (select id from users where clerk_user_id = $1)`,
      [clerkIdA()],
    );
    expect(remaining.rows[0].n).toBe(0);
  });

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

  test("teardown removes an exchanged Item when management stops before UI disconnect", async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto("/accounts");
    await cleanup();
    const { connectionId } = await connectSandboxItem(page);
    const registered = await adminQuery(
      "select count(*)::int as n from connection_credentials where connection_id = $1",
      [connectionId],
    );
    expect(registered.rows[0].n).toBe(1);
  });

  test("cleanup rejects an unregistered owner before provider work", async ({ page }) => {
    const registeredUserB = JSON.parse(fs.readFileSync(E2E_USERS_FILE, "utf8")).b.clerkUserId;
    let error: unknown;
    try {
      await disconnectSandboxItems(page, registeredUserB);
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(Error);
    const message = (error as Error).message;
    expect(message).toBe("refusing provider cleanup for an unregistered test owner");
    expect(message).not.toContain(registeredUserB);
  });

  test("cleanup re-authenticates after a signed-out browser redirect", async ({ browser, baseURL }) => {
    const context = await browser.newContext({
      baseURL,
      storageState: { cookies: [], origins: [] },
    });
    const page = await context.newPage();
    let connectionId: string | undefined;
    let cleanupSucceeded = false;
    try {
      await clerkSetup();
      await page.goto("/sign-in");
      await clerk.loaded({ page });
      await clerk.signIn({ page, emailAddress: E2E_USER_A_EMAIL });
      ({ connectionId } = await connectSandboxItem(page));

      await page.goto("/accounts");
      await page.locator(".cl-userButtonTrigger").click();
      await page.locator(".cl-userButtonPopoverActionButton__signOut").click();
      await expect(page).toHaveURL(/\/sign-in/);

      await disconnectSandboxItems(page, clerkIdA());
      const credentials = await adminQuery(
        "select count(*)::int as n from connection_credentials where connection_id = $1",
        [connectionId],
      );
      expect(credentials.rows[0].n).toBe(0);
      cleanupSucceeded = true;
    } finally {
      try {
        if (!cleanupSucceeded) {
          await clerkSetup();
          await page.goto("/sign-in");
          await clerk.loaded({ page });
          await clerk.signIn({ page, emailAddress: E2E_USER_A_EMAIL });
          await disconnectSandboxItems(page, clerkIdA());
          if (connectionId) {
            const credentials = await adminQuery(
              "select count(*)::int as n from connection_credentials where connection_id = $1",
              [connectionId],
            );
            expect(credentials.rows[0].n).toBe(0);
          }
        }
      } finally {
        await context.close();
      }
    }
  });

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
});
