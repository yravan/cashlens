import fs from "node:fs";
import { type Page } from "@playwright/test";

import { EXPECTED, SEED_CLERK_IDS } from "../db/seed/dataset";
import { E2E_USERS_FILE } from "../playwright.config";
import { adminQuery, seedLedgerFixture } from "./db";
import { expect, test } from "./fixtures";
import { signedInState } from "./session";

const clerkIdOf = (key: "a" | "b"): string =>
  JSON.parse(fs.readFileSync(E2E_USERS_FILE, "utf8"))[key].clerkUserId;

async function userIdOf(key: "a" | "b"): Promise<string> {
  const result = await adminQuery("select id from users where clerk_user_id = $1", [clerkIdOf(key)]);
  return result.rows[0].id;
}

const rows = (page: Page) => page.getByTestId("transaction-row");
const markers = (page: Page) => page.getByTestId("transfer-marker");

test.describe("internal transfer matching", () => {
  test.beforeEach(async ({ request, playwright, browser, baseURL }) => {
    expect((await request.get("/api/me")).status()).toBe(200);
    const requestB = await playwright.request.newContext({
      baseURL,
      storageState: await signedInState(browser, "b"),
    });
    expect((await requestB.get("/api/me")).status()).toBe(200);
    await requestB.dispose();

    const userA = await userIdOf("a");
    const userB = await userIdOf("b");
    await adminQuery("delete from accounts where user_id in ($1, $2)", [userA, userB]);
    await adminQuery("delete from categories where user_id in ($1, $2)", [userA, userB]);
    await seedLedgerFixture({ demo: userA, neighbor: userB });
  });

  test.afterAll(async () => {
    await adminQuery(
      "delete from accounts where user_id in (select id from users where clerk_user_id in ($1, $2))",
      [clerkIdOf("a"), clerkIdOf("b")],
    );
    await adminQuery(
      "delete from categories where user_id in (select id from users where clerk_user_id in ($1, $2))",
      [clerkIdOf("a"), clerkIdOf("b")],
    );
    await adminQuery("delete from users where clerk_user_id = any($1)", [SEED_CLERK_IDS]);
  });

  test("a visit pairs the seeded transfers, names both counterparts, and unlink sticks", async ({
    page,
  }) => {
    await page.goto("/transactions");
    await expect(markers(page)).toHaveCount(EXPECTED.demo.transfers.pairedRows, {
      timeout: 30_000,
    });

    const savingsOut = rows(page)
      .filter({ hasText: "TRANSFER TO RAINY DAY SAVINGS" })
      .getByTestId("transfer-marker");
    await expect(savingsOut).toContainText("Transfer · to Rainy Day Savings");
    await expect(
      rows(page)
        .filter({ hasText: "TRANSFER FROM EVERYDAY CHECKING" })
        .getByTestId("transfer-marker"),
    ).toContainText("Transfer · from Everyday Checking");
    await expect(
      rows(page)
        .filter({ hasText: "CASH REWARDS CARD PAYMENT" })
        .getByTestId("transfer-marker"),
    ).toContainText("Transfer · to Cash Rewards Card");
    await expect(
      rows(page)
        .filter({ hasText: "PAYMENT RECEIVED - THANK YOU" })
        .getByTestId("transfer-marker"),
    ).toContainText("Transfer · from Everyday Checking");
    await expect(
      rows(page).filter({ hasText: "SKYLINE AIR REFUND" }).getByTestId("transfer-marker"),
    ).toHaveCount(0);

    await savingsOut.getByRole("button", { name: /Not a transfer/ }).click();
    await expect(markers(page)).toHaveCount(2);

    // The re-run on reload must respect the dismissal, and both transactions survive.
    await page.reload();
    await expect(rows(page)).toHaveCount(EXPECTED.demo.transactions);
    await expect(markers(page)).toHaveCount(2);
    await expect(rows(page).filter({ hasText: "TRANSFER TO RAINY DAY SAVINGS" })).toHaveCount(1);
    await expect(rows(page).filter({ hasText: "TRANSFER FROM EVERYDAY CHECKING" })).toHaveCount(1);
  });

  test("a neighbor's page shows no transfer markers and knows nothing of demo accounts", async ({
    page,
    browser,
    baseURL,
  }) => {
    await page.goto("/transactions");
    await expect(markers(page)).toHaveCount(EXPECTED.demo.transfers.pairedRows, {
      timeout: 30_000,
    });

    const contextB = await browser.newContext({
      baseURL,
      storageState: await signedInState(browser, "b"),
    });
    try {
      const pageB = await contextB.newPage();
      await pageB.goto("/transactions");
      await expect(pageB.getByTestId("transactions-count")).toHaveText(
        "2 transactions in the ledger",
      );
      await expect(pageB.getByTestId("transfer-marker")).toHaveCount(0);
      await expect(pageB.getByTestId("transaction-list")).not.toContainText("Rainy Day");
    } finally {
      await contextB.close();
    }
  });
});
