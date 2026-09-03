import fs from "node:fs";
import { type Page } from "@playwright/test";

import { EXPECTED, SEED_ACCOUNTS, SEED_CLERK_IDS, SEED_TRANSACTIONS } from "../db/seed/dataset";
import { formatMinorUnits } from "../lib/ledger/minor-units";
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

const list = (page: Page) => page.getByTestId("transaction-list");
const rows = (page: Page) => list(page).getByTestId("transaction-row");
const form = (page: Page) => page.getByTestId("history-filters");

const ACCOUNT_NAME = new Map(SEED_ACCOUNTS.map((a) => [a.id, a.name]));
const DEMO_PAGE = EXPECTED.demo.history.order.map(
  (id) => SEED_TRANSACTIONS.find((t) => t.id === id)!,
);

test.describe("transaction history", () => {
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

  test("the first page is the exact seeded ledger, newest first, source and status on every row", async ({
    page,
  }) => {
    await page.goto("/transactions");
    await expect(page.getByTestId("transactions-count")).toHaveText(
      "16 transactions in the ledger",
    );
    await expect(rows(page)).toHaveCount(16);

    for (const [i, t] of DEMO_PAGE.entries()) {
      const row = rows(page).nth(i);
      await expect(row.locator("p").nth(0)).toHaveText(t.merchant ?? t.description);
      await expect(row.locator("p").nth(1)).toHaveText(
        `${t.date} · ${ACCOUNT_NAME.get(t.accountId)!}`,
      );
      await expect(row.locator("p").nth(2)).toHaveText(`${t.source} · ${t.status}`);
      await expect(row.locator("p").nth(3)).toContainText(
        formatMinorUnits(t.amountMinor, t.currency),
      );
    }
  });

  test("a combined GET filter narrows to the exact rows, shareable and clearable", async ({
    page,
  }) => {
    await page.goto("/transactions");
    await form(page).getByLabel("Search").fill("acme");
    await form(page).getByLabel("Account").selectOption({ label: "Everyday Checking" });
    await form(page).getByLabel("From").fill("2026-03-01");
    await form(page).getByRole("button", { name: "Apply" }).click();

    await expect(page).toHaveURL(/\/transactions\?.*q=acme/);
    await expect(page.getByTestId("transactions-count")).toHaveText("1 matching transaction");
    await expect(rows(page)).toHaveCount(1);
    await expect(rows(page).first().locator("p").nth(1)).toHaveText(
      "2026-03-27 · Everyday Checking",
    );

    await page.reload();
    await expect(rows(page)).toHaveCount(1);
    await expect(form(page).getByLabel("Search")).toHaveValue("acme");

    await form(page).getByRole("link", { name: "Clear" }).click();
    await expect(page).toHaveURL(/\/transactions$/);
    await expect(rows(page)).toHaveCount(16);
    await expect(form(page).getByLabel("Search")).toHaveValue("");
    await expect(form(page).getByLabel("Account")).toHaveValue("");
    await expect(form(page).getByLabel("From")).toHaveValue("");
  });

  test("filters survive pagination and the back button", async ({ page }) => {
    const userA = await userIdOf("a");
    const checking = SEED_ACCOUNTS.find((a) => a.name === "Everyday Checking")!.id;
    await adminQuery(
      `insert into transactions (user_id, account_id, amount_minor, currency, date, description, status, source)
       select $1, $2, -100 * i, 'USD', ('2025-06-01'::date + i), 'PAGER ' || lpad(i::text, 2, '0'), 'posted', 'manual'
       from generate_series(1, 60) as g(i)`,
      [userA, checking],
    );

    await page.goto("/transactions");
    await form(page).getByLabel("Search").fill("PAGER");
    await form(page).getByRole("button", { name: "Apply" }).click();

    await expect(page.getByTestId("transactions-count")).toHaveText("60 matching transactions");
    await expect(rows(page)).toHaveCount(50);
    await expect(rows(page).first().locator("p").first()).toHaveText("PAGER 60");
    const pagination = page.getByRole("navigation", { name: "Pagination" });
    await expect(pagination).toContainText("Page 1 of 2");

    await pagination.getByRole("link", { name: "Next" }).click();
    await expect(page).toHaveURL(/\/transactions\?q=PAGER&page=2$/);
    await expect(rows(page)).toHaveCount(10);
    await expect(rows(page).first().locator("p").first()).toHaveText("PAGER 10");
    await expect(form(page).getByLabel("Search")).toHaveValue("PAGER");
    await expect(pagination).toContainText("Page 2 of 2");

    await page.goBack();
    await expect(page).toHaveURL(/q=PAGER(?!.*page=)/);
    await expect(rows(page)).toHaveCount(50);
    await expect(form(page).getByLabel("Search")).toHaveValue("PAGER");
    await expect(rows(page).first().locator("p").first()).toHaveText("PAGER 60");
  });

  test("a neighbor sees only their own rows and filter choices", async ({ page, browser, baseURL }) => {
    await page.goto("/transactions");
    await expect(rows(page)).toHaveCount(16);
    await expect(list(page)).not.toContainText("NEIGHBOR");
    await expect(form(page).getByLabel("Account").locator("option")).toHaveText([
      "All accounts",
      "Berlin Checking",
      "Cash Rewards Card",
      "Cash Wallet",
      "Everyday Checking",
      "Rainy Day Savings",
    ]);

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
      await expect(rows(pageB)).toHaveCount(2);
      await expect(rows(pageB).first().locator("p").first()).toHaveText("Electronics Emporium");
      await expect(list(pageB)).not.toContainText("ACME");
      await expect(form(pageB).getByLabel("Account").locator("option")).toHaveText([
        "All accounts",
        "Neighbor Checking",
      ]);
    } finally {
      await contextB.close();
    }
  });

  test("no-match keeps the controls, invalid queries never render results, empty ledgers onboard", async ({
    page,
  }) => {
    await page.goto("/transactions");
    await form(page).getByLabel("Search").fill("zz nothing matches zz");
    await form(page).getByRole("button", { name: "Apply" }).click();
    await expect(page.getByTestId("transactions-count")).toHaveText("0 matching transactions");
    await expect(page.getByTestId("no-match")).toContainText("No transactions match");
    await expect(list(page)).toHaveCount(0);
    await page.getByRole("link", { name: "Clear filters" }).click();
    await expect(rows(page)).toHaveCount(16);

    await page.goto("/transactions?from=2026-13-01");
    await expect(page.getByTestId("filter-error")).toBeVisible();
    await expect(list(page)).toHaveCount(0);
    await expect(page.getByTestId("transactions-count")).toHaveCount(0);
    await expect(form(page).getByLabel("Search")).toBeVisible();

    await page.goto("/transactions?nope=1");
    await expect(page.getByTestId("filter-error")).toBeVisible();

    await adminQuery("delete from accounts where user_id = $1", [await userIdOf("a")]);
    await page.goto("/transactions");
    await expect(page.getByTestId("transactions-count")).toHaveText(
      "0 transactions in the ledger",
    );
    await expect(page.getByText("No transactions yet")).toBeVisible();
    await expect(form(page)).toHaveCount(0);
  });

  test("at 320px everything stacks and nothing needs a horizontal scroll", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 800 });
    await page.goto("/transactions");

    await expect(form(page).getByLabel("Search")).toBeVisible();
    await expect(form(page).getByRole("button", { name: "Apply" })).toBeVisible();
    const first = rows(page).first();
    await expect(first.locator("p").first()).toHaveText("INTEREST PAYMENT");
    await expect(first.locator("p").nth(2)).toHaveText("plaid · posted");
    await expect(first.locator("p").nth(3)).toContainText(formatMinorUnits(3113, "USD"));
    await expect(first.getByRole("combobox")).toBeVisible();

    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      ),
    ).toBeLessThanOrEqual(0);
  });
});
