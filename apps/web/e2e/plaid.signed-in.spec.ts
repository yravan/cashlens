import fs from "node:fs";
import { expect, test } from "@playwright/test";

import { E2E_USERS_FILE } from "../playwright.config";
import { adminQuery } from "./db";

// Real Plaid sandbox coverage; skipped when the sandbox keys are absent
// (e.g. fork PRs). The Link UI itself is never driven — Plaid's own docs say
// to bypass it in automated suites — the API suite covers the flow logic.
const KEYS_PRESENT = !!process.env.PLAID_CLIENT_ID && !!process.env.PLAID_SECRET;
const SANDBOX = process.env.PLAID_ENV === "sandbox";

test.describe("plaid connect flow (real sandbox)", () => {
  test.skip(!KEYS_PRESENT || !SANDBOX, "PLAID_* sandbox keys not configured");

  function clerkIdA(): string {
    return JSON.parse(fs.readFileSync(E2E_USERS_FILE, "utf8")).a.clerkUserId;
  }

  async function userIdA(): Promise<string> {
    const result = await adminQuery("select id from users where clerk_user_id = $1", [clerkIdA()]);
    return result.rows[0].id;
  }

  async function cleanup() {
    await adminQuery(
      "delete from accounts where user_id = (select id from users where clerk_user_id = $1)",
      [clerkIdA()],
    );
    await adminQuery(
      "delete from connections where user_id = (select id from users where clerk_user_id = $1)",
      [clerkIdA()],
    );
  }

  test.afterAll(cleanup);

  test("a sandbox public token exchanged through the app registers the institution and its accounts", async ({
    page,
  }) => {
    // page.request shares the browser context's live cookie jar: Clerk session
    // JWTs expire after ~60s and only page loads refresh them; a POST through
    // the standalone request fixture gets bounced to sign-in mid-suite.
    await page.goto("/accounts");
    await cleanup();

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
    const body = await exchanged.json();

    expect(body.connection.institutionId).toBe("ins_109508");
    expect(body.connection.institutionName).toBe("First Platypus Bank");
    expect(body.connection.status).toBe("active");
    expect(body.accounts.length).toBeGreaterThanOrEqual(8);
    expect(body.accounts).toContainEqual({
      id: expect.any(String),
      name: "Plaid Checking",
      type: "depository",
      subtype: "checking",
      mask: "0000",
      currency: "USD",
    });
    expect(JSON.stringify(body)).not.toContain("access-sandbox");

    const userId = await userIdA();
    const connection = await adminQuery(
      "select provider_item_id, status from connections where id = $1 and user_id = $2",
      [body.connection.id, userId],
    );
    expect(connection.rows[0].status).toBe("active");
    expect(connection.rows[0].provider_item_id).toMatch(/\w{10,}/);

    const credential = await adminQuery(
      "select ciphertext from connection_credentials where connection_id = $1",
      [body.connection.id],
    );
    expect(credential.rows[0].ciphertext).toMatch(/^v1\./);

    const registered = await adminQuery(
      `select a.mask, b.available_minor, b.current_minor
         from accounts a left join account_balances b on b.account_id = a.id
        where a.connection_id = $1 and a.user_id = $2 and a.source = 'plaid'`,
      [body.connection.id, userId],
    );
    expect(registered.rowCount).toBe(body.accounts.length);
    const checking = registered.rows.find((row) => row.mask === "0000");
    expect(checking).toMatchObject({ available_minor: "10000", current_minor: "11000" });

    await page.goto("/accounts");
    await expect(page.getByTestId("accounts-count")).toHaveText(
      `${body.accounts.length} accounts in the ledger`,
    );
  });

  test("the connect button mints a real link token and mounts Plaid Link", async ({ page }) => {
    await page.goto("/accounts");
    const tokenResponse = page.waitForResponse("**/api/plaid/link-token");
    await page.getByTestId("connect-bank").click();
    expect((await tokenResponse).status()).toBe(200);
    await expect(
      page.locator('iframe[id^="plaid-link-"], iframe[title="Plaid Link"]').first(),
    ).toBeAttached({ timeout: 20_000 });
  });
});
