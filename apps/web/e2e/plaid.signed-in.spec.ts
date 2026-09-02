import fs from "node:fs";

import { E2E_USERS_FILE } from "../playwright.config";
import { adminQuery } from "./db";
import { expect, test } from "./fixtures";

// The Link UI itself is never driven — Plaid's own docs say to bypass it in
// automated suites — so the API suite covers the flow logic and this covers the wire.
const CONFIGURED =
  !!process.env.PLAID_CLIENT_ID &&
  !!process.env.PLAID_SECRET &&
  process.env.PLAID_ENV === "sandbox";

test.describe("plaid connect flow (real sandbox)", () => {
  test.skip(!CONFIGURED, "PLAID_* sandbox keys not configured");

  function clerkIdA(): string {
    return JSON.parse(fs.readFileSync(E2E_USERS_FILE, "utf8")).a.clerkUserId;
  }

  async function userIdA(): Promise<string> {
    const result = await adminQuery("select id from users where clerk_user_id = $1", [clerkIdA()]);
    return result.rows[0].id;
  }

  async function cleanup() {
    await adminQuery(
      `with mine as (select id from users where clerk_user_id = $1),
            cleared as (delete from accounts where user_id in (select id from mine))
       delete from connections where user_id in (select id from mine)`,
      [clerkIdA()],
    );
  }

  test.afterAll(cleanup);

  test("a sandbox public token exchanged through the app registers the institution and its accounts", async ({
    page,
  }) => {
    test.setTimeout(120_000);
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

    expect(body.connection.backfillStatus).toBe("in_progress");
    let imported = 0;
    let step;
    for (let poll = 0; poll < 30; poll += 1) {
      const advanced = await page.request.post(`/api/connections/${body.connection.id}/sync`);
      expect(advanced.status()).toBe(200);
      step = await advanced.json();
      imported += step.added;
      if (step.backfillStatus === "complete") break;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    expect(step.backfillStatus).toBe("complete");
    expect(imported).toBeGreaterThanOrEqual(15);

    const history = await adminQuery(
      `select t.description, t.amount_minor, t.currency, t.status, t.source, t.source_id
         from transactions t join accounts a on a.id = t.account_id
        where a.connection_id = $1 and t.user_id = $2`,
      [body.connection.id, userId],
    );
    expect(history.rowCount).toBe(imported);
    for (const row of history.rows) {
      expect(row.source).toBe("plaid");
      expect(row.currency).toBe("USD");
      expect(row.source_id).toMatch(/\w{10,}/);
    }
    // The sandbox fixture is deterministic in names and amounts (dates roll):
    // ledger signs must be Plaid's inverted — purchases negative, credits positive.
    const amounts = (description: string) =>
      history.rows.filter((row) => row.description === description).map((row) => row.amount_minor);
    expect(amounts("McDonald's")).toContain("-1200");
    expect(amounts("INTRST PYMNT")).toContain("422");
    expect(amounts("AUTOMATIC PAYMENT - THANK")).toContain("-207850");
    expect(amounts("United Airlines")).toContain("-50000");
    expect(amounts("United Airlines")).toContain("50000");

    const settled = await adminQuery(
      "select backfill_status, sync_cursor from connections where id = $1",
      [body.connection.id],
    );
    expect(settled.rows[0].backfill_status).toBe("complete");
    expect(settled.rows[0].sync_cursor).toMatch(/\w{10,}/);

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

  test("a backfill that never got driven self-heals from the accounts page", async ({ page }) => {
    test.setTimeout(120_000);
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
    const connectionId = body.connection.id;
    const start = new Date();

    // The interruption scenario: the tab closed before any sync ran. Nothing
    // but the page-load resumer will ever touch this connection again.
    const parked = await adminQuery(
      "select backfill_status, sync_cursor from connections where id = $1",
      [connectionId],
    );
    expect(parked.rows[0]).toMatchObject({ backfill_status: "in_progress", sync_cursor: null });
    await adminQuery(
      "update connections set updated_at = now() - interval '3 minutes' where id = $1",
      [connectionId],
    );

    await page.goto("/accounts");
    await expect
      .poll(
        async () => {
          const settled = await adminQuery(
            "select backfill_status from connections where id = $1",
            [connectionId],
          );
          return settled.rows[0].backfill_status;
        },
        { timeout: 90_000, intervals: [2_000] },
      )
      .toBe("complete");

    const userId = await userIdA();
    const history = await adminQuery(
      `select count(*)::int as n from transactions t join accounts a on a.id = t.account_id
        where a.connection_id = $1 and t.user_id = $2`,
      [connectionId, userId],
    );
    expect(history.rows[0].n).toBeGreaterThanOrEqual(15);

    // The status flip is visible at commit, but the live-balance refresh runs
    // after it — poll rather than racing the institution round trip.
    await expect
      .poll(
        async () => {
          const balances = await adminQuery(
            `select count(*)::int as n from account_balances b join accounts a on a.id = b.account_id
              where a.connection_id = $1 and b.as_of >= $2`,
            [connectionId, start.toISOString()],
          );
          return balances.rows[0].n;
        },
        { timeout: 60_000, intervals: [2_000] },
      )
      .toBeGreaterThanOrEqual(1);

    const registered = await adminQuery(
      "select count(*)::int as n from accounts where connection_id = $1",
      [connectionId],
    );
    await page.reload();
    await expect(page.getByTestId("accounts-count")).toHaveText(
      `${registered.rows[0].n} accounts in the ledger`,
    );
  });
});
