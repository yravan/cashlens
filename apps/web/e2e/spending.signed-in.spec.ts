import fs from "node:fs";
import { type Locator, type Page } from "@playwright/test";

import { EXPECTED, SEED_CATEGORIES, SEED_CLERK_IDS, SEED_TRANSACTIONS } from "../db/seed/dataset";
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

const currencySection = (page: Page, currency: string) =>
  page.getByTestId(`spend-currency-${currency}`);

const signed = (minor: number, currency: string) =>
  `${minor > 0 ? "+" : ""}${formatMinorUnits(minor, currency)}`;

const spendingOf = (persona: "demo" | "neighbor", currency: string) =>
  EXPECTED[persona].spending.find((section) => section.currency === currency)!;

const demoLeafId = (name: string) =>
  SEED_CATEGORIES.find((c) => c.persona === "demo" && c.name === name && c.parentId !== null)!.id;

const directionNote = (
  totals: { spentMinor: number; receivedMinor: number },
  currency: string,
) => `${formatMinorUnits(totals.spentMinor, currency)} out · ${signed(totals.receivedMinor, currency)} in`;

async function expectTotals(
  section: Locator,
  totals: { spentMinor: number; receivedMinor: number; netMinor: number },
  currency: string,
) {
  await expect(section.getByTestId("spend-in")).toHaveText(
    formatMinorUnits(totals.receivedMinor, currency),
  );
  await expect(section.getByTestId("spend-out")).toHaveText(
    formatMinorUnits(totals.spentMinor, currency),
  );
  await expect(section.getByTestId("spend-net")).toHaveText(signed(totals.netMinor, currency));
}

test.describe("spending by category", () => {
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

  test("totals per category are exact per currency, most spent first, income last", async ({
    page,
  }) => {
    await page.goto("/spending");
    await expect(page.getByTestId("spend-transfer-note")).toHaveText(
      `${EXPECTED.demo.transfers.pairedRows} transactions are internal transfer legs — left out so nothing counts twice.`,
      { timeout: 30_000 },
    );
    await expect(page.getByTestId("spend-pending-note")).toHaveText(
      "1 pending transaction will count once it posts.",
    );

    const usd = currencySection(page, "USD");
    const usdSpending = spendingOf("demo", "USD");
    await expectTotals(usd, usdSpending.totals, "USD");

    const groups = usd.getByTestId("spend-group");
    await expect(groups).toHaveCount(3);
    for (const [index, group] of usdSpending.groups.entries()) {
      await expect(groups.nth(index)).toContainText(group.name);
      await expect(groups.nth(index).getByTestId("group-net")).toHaveText(
        signed(group.netMinor, "USD"),
      );
    }
    const food = groups.nth(0);
    await expect(food.getByTestId("spend-category")).toHaveCount(2);
    await expect(food.getByRole("link", { name: "Groceries" })).toBeVisible();
    await expect(
      food.getByTestId("spend-category").nth(0).getByTestId("category-net"),
    ).toHaveText(formatMinorUnits(-6742, "USD"));
    await expect(
      food.getByTestId("spend-category").nth(1).getByTestId("category-net"),
    ).toHaveText(formatMinorUnits(-4437, "USD"));

    const uncategorized = usd.getByTestId("spend-uncategorized");
    await expect(uncategorized.getByTestId("group-net")).toHaveText(signed(1313, "USD"));
    await expect(uncategorized.getByTestId("direction-note")).toHaveText(
      directionNote(usdSpending.uncategorized!, "USD"),
    );

    const eur = currencySection(page, "EUR");
    await expectTotals(eur, spendingOf("demo", "EUR").totals, "EUR");
    await expect(eur.getByTestId("spend-group")).toHaveCount(1);
    await expect(eur.getByTestId("spend-group").getByTestId("group-net")).toHaveText(
      formatMinorUnits(-5650, "EUR"),
    );
    await expect(eur.getByTestId("spend-uncategorized").getByTestId("group-net")).toHaveText(
      signed(20000, "EUR"),
    );
  });

  test("a category drills into the ledger scoped to category, period, and section currency", async ({
    page,
  }) => {
    await page.goto("/spending?from=2026-03-01&to=2026-03-31&currency=USD");
    const usd = currencySection(page, "USD");
    await expectTotals(
      usd,
      { spentMinor: -15279, receivedMinor: 272112, netMinor: 256833 },
      "USD",
    );
    await expect(page.getByTestId("spend-currency-EUR")).toHaveCount(0);

    await usd.getByRole("link", { name: "Groceries" }).click();
    await expect(page).toHaveURL(
      `/transactions?category=${demoLeafId("Groceries")}&from=2026-03-01&to=2026-03-31&currency=USD`,
    );
    await expect(page.getByTestId("transactions-count")).toHaveText("1 matching transaction");
    await expect(page.getByTestId("transaction-row")).toContainText("Maple Market");
  });

  test("clearing a period resets the controls and cannot silently reapply old filters", async ({ page }) => {
    await page.goto("/spending");
    const form = page.getByRole("form", { name: "Choose a period" });
    await form.getByLabel("From", { exact: true }).fill("2026-03-01");
    await form.getByLabel("To", { exact: true }).fill("2026-03-31");
    await form.getByRole("combobox", { name: "Currency" }).selectOption("USD");
    await form.getByRole("button", { name: "Apply" }).click();
    await expect(page).toHaveURL("/spending?from=2026-03-01&to=2026-03-31&currency=USD");
    await expect(currencySection(page, "EUR")).toHaveCount(0);

    await form.getByRole("link", { name: "Clear", exact: true }).click();
    await expect(page).toHaveURL("/spending");
    await expectTotals(currencySection(page, "USD"), spendingOf("demo", "USD").totals, "USD");
    await expect(form.getByLabel("From", { exact: true })).toHaveValue("");
    await expect(form.getByLabel("To", { exact: true })).toHaveValue("");
    await expect(form.getByRole("combobox", { name: "Currency" })).toHaveValue("");

    await page.goBack();
    await expect(page).toHaveURL("/spending?from=2026-03-01&to=2026-03-31&currency=USD");
    await expect(form.getByLabel("From", { exact: true })).toHaveValue("2026-03-01");
    await expect(form.getByLabel("To", { exact: true })).toHaveValue("2026-03-31");
    await expect(form.getByRole("combobox", { name: "Currency" })).toHaveValue("USD");
    await expect(currencySection(page, "EUR")).toHaveCount(0);
    await page.goForward();
    await expect(page).toHaveURL("/spending");
    await expect(form.getByLabel("From", { exact: true })).toHaveValue("");
    await expect(form.getByLabel("To", { exact: true })).toHaveValue("");
    await expect(form.getByRole("combobox", { name: "Currency" })).toHaveValue("");

    await form.getByRole("button", { name: "Apply" }).click();
    await expect(page).toHaveURL("/spending?from=&to=&currency=");
    await expectTotals(currencySection(page, "EUR"), spendingOf("demo", "EUR").totals, "EUR");
    await expectTotals(currencySection(page, "USD"), spendingOf("demo", "USD").totals, "USD");
  });

  test("Clear discards an unsubmitted period even when the URL is already unfiltered", async ({ page }) => {
    await page.goto("/spending");
    const form = page.getByRole("form", { name: "Choose a period" });
    await form.getByLabel("From", { exact: true }).fill("2026-03-01");
    await form.getByLabel("To", { exact: true }).fill("2026-03-31");
    await form.getByRole("combobox", { name: "Currency" }).selectOption("USD");
    await form.getByRole("link", { name: "Clear", exact: true }).click();
    await expect(page).toHaveURL("/spending");
    await expect(form.getByLabel("From", { exact: true })).toHaveValue("");
    await expect(form.getByLabel("To", { exact: true })).toHaveValue("");
    await expect(form.getByRole("combobox", { name: "Currency" })).toHaveValue("");
    await form.getByRole("button", { name: "Apply" }).click();
    await expectTotals(currencySection(page, "EUR"), spendingOf("demo", "EUR").totals, "EUR");
    await expectTotals(currencySection(page, "USD"), spendingOf("demo", "USD").totals, "USD");
  });

  test("modifier-clicking Clear leaves this tab's period and draft untouched", async ({
    page,
    context,
  }) => {
    await page.goto("/spending?from=2026-03-01&to=2026-03-31&currency=USD");
    const form = page.getByRole("form", { name: "Choose a period" });
    await form.getByLabel("From", { exact: true }).fill("2026-02-01");

    await form
      .getByRole("link", { name: "Clear", exact: true })
      .click({ modifiers: ["ControlOrMeta"] });

    await expect(page).toHaveURL("/spending?from=2026-03-01&to=2026-03-31&currency=USD");
    await expect(currencySection(page, "USD")).toBeVisible();
    await expect(currencySection(page, "EUR")).toHaveCount(0);
    await expect(form.getByLabel("From", { exact: true })).toHaveValue("2026-02-01");
    await expect(form.getByLabel("To", { exact: true })).toHaveValue("2026-03-31");
    await expect(form.getByRole("combobox", { name: "Currency" })).toHaveValue("USD");
    for (const opened of context.pages()) if (opened !== page) await opened.close();
  });

  test("the uncategorized row drills to exactly the rows with no category", async ({ page }) => {
    await page.goto("/spending");
    const usd = currencySection(page, "USD");
    await usd.getByRole("link", { name: "Uncategorized" }).click({ timeout: 30_000 });

    await expect(page).toHaveURL("/transactions?category=uncategorized&currency=USD");
    const uncategorizedUsdRows = SEED_TRANSACTIONS.filter(
      (t) => t.persona === "demo" && t.currency === "USD" && !t.categoryId,
    ).length;
    await expect(page.getByTestId("transactions-count")).toHaveText(
      `${uncategorizedUsdRows} matching transactions`,
    );
  });

  test("a neighbor sees only their spending and none of the demo ledger", async ({
    page,
    browser,
    baseURL,
  }) => {
    await page.goto("/spending");
    await expect(page.getByTestId("spend-transfer-note")).toBeVisible({ timeout: 30_000 });

    const contextB = await browser.newContext({
      baseURL,
      storageState: await signedInState(browser, "b"),
    });
    try {
      const pageB = await contextB.newPage();
      await pageB.goto("/spending");
      const usd = currencySection(pageB, "USD");
      await expectTotals(usd, spendingOf("neighbor", "USD").totals, "USD");
      await expect(usd.getByTestId("spend-group")).toHaveCount(1);
      await expect(usd.getByTestId("spend-group")).toContainText("Shopping");
      await expect(usd.getByRole("link", { name: "Electronics" })).toBeVisible();
      await expect(pageB.getByTestId("spend-currency-EUR")).toHaveCount(0);
      await expect(pageB.getByTestId("spend-transfer-note")).toHaveCount(0);
      await expect(pageB.getByTestId("spend-pending-note")).toHaveCount(0);
      await expect(pageB.locator("main")).not.toContainText(
        formatMinorUnits(spendingOf("demo", "USD").totals.receivedMinor, "USD"),
      );
    } finally {
      await contextB.close();
    }
  });

  test("parameters outside the closed schema reject before any numbers", async ({ page }) => {
    await page.goto("/spending?q=coffee");
    await expect(page.getByTestId("filter-error")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("spend-group")).toHaveCount(0);
    await expect(page.getByTestId("spend-in")).toHaveCount(0);
  });

  test("an emptied ledger lands on the empty state, not zero rows", async ({ page }) => {
    await adminQuery("delete from accounts where user_id = $1", [await userIdOf("a")]);
    await page.goto("/spending");
    await expect(page.getByRole("heading", { name: "No spending yet" })).toBeVisible();
    await expect(page.getByTestId("spend-group")).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Go to accounts" })).toBeVisible();
  });

  test.describe("phone viewport", () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

    test("sections reflow with every labeled amount visible and no sideways scroll", async ({
      page,
    }) => {
      await page.goto("/spending");
      await expect(page.getByTestId("spend-transfer-note")).toBeVisible({ timeout: 30_000 });

      const usd = currencySection(page, "USD");
      await expect(usd.getByTestId("spend-net")).toHaveText(
        signed(spendingOf("demo", "USD").totals.netMinor, "USD"),
      );
      await usd.getByTestId("spend-in").scrollIntoViewIfNeeded();
      await expect(usd.getByTestId("spend-in")).toBeInViewport();
      await expect(usd.getByTestId("spend-out")).toBeInViewport();
      await usd.getByRole("link", { name: "Groceries" }).scrollIntoViewIfNeeded();
      await expect(usd.getByRole("link", { name: "Groceries" })).toBeInViewport();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        ),
      ).toBeLessThanOrEqual(0);
    });
  });
});
