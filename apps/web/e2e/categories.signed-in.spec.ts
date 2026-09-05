import fs from "node:fs";
import { expect, test, type Page } from "@playwright/test";

import { SEED_CLERK_IDS, SEED_TRANSACTIONS } from "../db/seed/dataset";
import { E2E_USERS_FILE, STORAGE_STATE_B } from "../playwright.config";
import { adminQuery, seedLedgerFixture } from "./db";

const clerkIdOf = (key: "a" | "b"): string =>
  JSON.parse(fs.readFileSync(E2E_USERS_FILE, "utf8"))[key].clerkUserId;

async function userIdOf(key: "a" | "b"): Promise<string> {
  const result = await adminQuery("select id from users where clerk_user_id = $1", [clerkIdOf(key)]);
  return result.rows[0].id;
}

const row = (page: Page, description: string) =>
  page.getByTestId("transaction-row").filter({ hasText: description });

test.describe("category assignment", () => {
  test.afterAll(async () => {
    await adminQuery(
      `delete from accounts where user_id in (select id from users where clerk_user_id in ($1, $2))`,
      [clerkIdOf("a"), clerkIdOf("b")],
    );
    await adminQuery(
      `delete from categories where user_id in (select id from users where clerk_user_id in ($1, $2))`,
      [clerkIdOf("a"), clerkIdOf("b")],
    );
    await adminQuery("delete from users where clerk_user_id = any($1)", [SEED_CLERK_IDS]);
  });

  test("assigning a category from the transactions page persists, scoped to the signed-in user", async ({
    page,
    request,
    playwright,
    browser,
    baseURL,
  }) => {
    // Provision both users before seeding onto them. Storage-state contexts can go
    // stale mid-suite (see plaid.signed-in.spec.ts), and an unasserted 307 here only
    // resurfaces as a missing row further down.
    expect((await request.get("/api/me")).status()).toBe(200);
    const requestB = await playwright.request.newContext({ baseURL, storageState: STORAGE_STATE_B });
    expect((await requestB.get("/api/me")).status()).toBe(200);
    await requestB.dispose();

    const userA = await userIdOf("a");
    const userB = await userIdOf("b");
    await adminQuery("delete from accounts where user_id in ($1, $2)", [userA, userB]);
    await adminQuery("delete from categories where user_id in ($1, $2)", [userA, userB]);
    await seedLedgerFixture({ demo: userA, neighbor: userB });

    await page.goto("/transactions");
    await expect(page.getByTestId("transactions-count")).toHaveText(
      `${SEED_TRANSACTIONS.filter((t) => t.persona === "demo").length} transactions in the ledger`,
    );

    const streamflix = row(page, "STREAMFLIX").getByRole("combobox");
    await expect(streamflix).toHaveCount(1);
    await expect(streamflix.locator("option:checked")).toHaveText("Streaming & Music");

    // The page's machine triggers (transfer match refresh + llm-stub categorize)
    // may repaint this row auto-categorized at any moment; the manual pick below
    // must win either order, so no precondition on the starting value.
    const farmers = row(page, "FARMERS MARKET CASH").getByRole("combobox");
    await expect(farmers).toHaveCount(1);
    const saved = page.waitForResponse(
      (response) =>
        response.url().includes("/api/transactions/") &&
        response.url().endsWith("/category") &&
        response.status() === 200,
    );
    await farmers.selectOption({ label: "Groceries" });
    await saved;

    await page.reload();
    await expect(
      row(page, "FARMERS MARKET CASH").getByRole("combobox").locator("option:checked"),
    ).toHaveText("Groceries");

    const groceriesValueA = await row(page, "FARMERS MARKET CASH")
      .getByRole("combobox")
      .locator("option", { hasText: "Groceries" })
      .getAttribute("value");

    const contextB = await browser.newContext({ baseURL, storageState: STORAGE_STATE_B });
    try {
      const pageB = await contextB.newPage();
      await pageB.goto("/transactions");
      await expect(pageB.getByTestId("transactions-count")).toHaveText(
        "2 transactions in the ledger",
      );
      await expect(pageB.getByText("STREAMFLIX")).toHaveCount(0);
      await expect(
        row(pageB, "ELECTRONICS EMPORIUM").getByRole("combobox").locator("option:checked"),
      ).toHaveText("Electronics");

      const groceriesValueB = await row(pageB, "ELECTRONICS EMPORIUM")
        .getByRole("combobox")
        .locator("option", { hasText: "Groceries" })
        .getAttribute("value");
      expect(groceriesValueB).not.toBe(groceriesValueA);
    } finally {
      await contextB.close();
    }
  });
});
