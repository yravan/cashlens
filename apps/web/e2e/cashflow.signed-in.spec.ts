import fs from "node:fs";
import { type Locator, type Page } from "@playwright/test";

import { EXPECTED, SEED_CLERK_IDS, SEED_TRANSACTIONS } from "../db/seed/dataset";
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
  page.getByTestId(`flow-currency-${currency}`);

const monthRow = (section: Locator, label: string) =>
  section.getByTestId("flow-month").filter({ has: section.page().getByRole("link", { name: label }) });

const flowOf = (persona: "demo" | "neighbor", currency: string) =>
  EXPECTED[persona].flow.find((entry) => entry.currency === currency)!;

const net = (minor: bigint, currency: string) =>
  `${minor > 0 ? "+" : ""}${formatMinorUnits(minor, currency)}`;

async function expectMonth(
  section: Locator,
  label: string,
  flow: { inflowMinor: bigint; outflowMinor: bigint; netMinor: bigint },
  currency: string,
) {
  const row = monthRow(section, label);
  await expect(row.getByTestId("flow-in")).toHaveText(formatMinorUnits(flow.inflowMinor, currency));
  await expect(row.getByTestId("flow-out")).toHaveText(formatMinorUnits(flow.outflowMinor, currency));
  await expect(row.getByTestId("flow-net")).toHaveText(net(flow.netMinor, currency));
}

test.describe("cash-flow summary", () => {
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

  test("the dashboard lands on exact true-spend months per currency, transfers excluded and disclosed", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page.getByTestId("flow-transfer-note")).toHaveText(
      `${EXPECTED.demo.transfers.pairedRows} transactions are internal transfer legs — left out so nothing counts twice.`,
      { timeout: 30_000 },
    );

    const usd = currencySection(page, "USD");
    await expect(usd.getByTestId("flow-month")).toHaveCount(3);
    const [march, february, january] = flowOf("demo", "USD").months;
    await expectMonth(usd, "March 2026", march, "USD");
    await expectMonth(usd, "February 2026", february, "USD");
    await expectMonth(usd, "January 2026", january, "USD");
    await expect(usd.getByTestId("flow-month").first().getByRole("link")).toHaveText("March 2026");

    const eur = currencySection(page, "EUR");
    await expect(eur.getByTestId("flow-month")).toHaveCount(1);
    await expectMonth(eur, "March 2026", flowOf("demo", "EUR").months[0], "EUR");

    await expect(page.getByTestId("flow-pending-note")).toHaveText(
      "1 pending transaction will count once it posts.",
    );
  });

  test("a month links into the ledger scoped to that month and currency", async ({ page }) => {
    await page.goto("/");
    const usd = currencySection(page, "USD");
    await monthRow(usd, "March 2026").getByRole("link").click({ timeout: 30_000 });

    await expect(page).toHaveURL("/transactions?from=2026-03-01&to=2026-03-31&currency=USD");
    const marchUsdRows = SEED_TRANSACTIONS.filter(
      (t) => t.persona === "demo" && t.currency === "USD" && t.date.startsWith("2026-03"),
    ).length;
    await expect(page.getByTestId("transactions-count")).toHaveText(
      `${marchUsdRows} matching transactions`,
    );
  });

  test("an odd aggregate beyond Number's safe range renders exactly across money views", async ({
    page,
  }) => {
    const userId = await userIdOf("a");
    const account = await adminQuery(
      `insert into accounts (user_id, name, type, currency, source)
       values ($1, 'Exact KWD wallet', 'depository', 'KWD', 'manual') returning id`,
      [userId],
    );
    const accountId = account.rows[0].id;
    await adminQuery(
      `insert into account_balances
         (account_id, user_id, current_minor, as_of, reported_on)
       values ($1, $2, 0, '2026-04-01T12:00:00Z', '2026-04-01')`,
      [accountId, userId],
    );
    await adminQuery(
      `insert into transactions
         (user_id, account_id, amount_minor, currency, date, description, status, source)
       values ($1, $2, $3, 'KWD', '2026-04-02', 'EXACT ONE', 'posted', 'manual'),
              ($1, $2, 2, 'KWD', '2026-04-02', 'EXACT TWO', 'posted', 'manual')`,
      [userId, accountId, Number.MAX_SAFE_INTEGER],
    );
    const exact = "KWD\u00a09,007,199,254,740.993";

    await page.goto("/");
    await expect(monthRow(currencySection(page, "KWD"), "April 2026").getByTestId("flow-in"))
      .toHaveText(exact);

    await page.goto("/spending?currency=KWD");
    await expect(page.getByTestId("spend-currency-KWD").getByTestId("spend-in")).toHaveText(exact);

    await page.goto("/accounts");
    await expect(page.getByTestId("cash-on-hand-KWD")).toHaveText(exact);
    const row = page.getByTestId("account-row").filter({ hasText: "Exact KWD wallet" });
    await expect(row).toContainText(exact);
    await row.getByRole("button", { name: "Update balance" }).click();
    await expect(row.getByLabel("Current balance")).toHaveValue("0");
    await row.getByRole("button", { name: "Cancel" }).click();
    await expect(row).toContainText(exact);
  });

  test("a neighbor's dashboard shows only their flow and none of the demo ledger", async ({
    page,
    browser,
    baseURL,
  }) => {
    await page.goto("/");
    await expect(page.getByTestId("flow-transfer-note")).toBeVisible({ timeout: 30_000 });

    const contextB = await browser.newContext({
      baseURL,
      storageState: await signedInState(browser, "b"),
    });
    try {
      const pageB = await contextB.newPage();
      await pageB.goto("/");
      const usd = currencySection(pageB, "USD");
      await expect(usd.getByTestId("flow-month")).toHaveCount(1);
      await expectMonth(usd, "March 2026", flowOf("neighbor", "USD").months[0], "USD");
      await expect(pageB.getByTestId("flow-currency-EUR")).toHaveCount(0);
      await expect(pageB.getByTestId("flow-transfer-note")).toHaveCount(0);
      await expect(pageB.getByTestId("flow-pending-note")).toHaveCount(0);
      const demoMarch = flowOf("demo", "USD").months[0];
      await expect(pageB.locator("main")).not.toContainText(
        formatMinorUnits(demoMarch.inflowMinor, "USD"),
      );
    } finally {
      await contextB.close();
    }
  });

  test("an emptied ledger lands on the empty state, not zero rows", async ({ page }) => {
    await adminQuery("delete from accounts where user_id = $1", [await userIdOf("a")]);
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "No cash flow yet" })).toBeVisible();
    await expect(page.getByTestId("flow-month")).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Go to accounts" })).toBeVisible();
  });

  test.describe("phone viewport", () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

    test("month rows reflow with every labeled amount visible and no sideways scroll", async ({
      page,
    }) => {
      await page.goto("/");
      await expect(page.getByTestId("flow-transfer-note")).toBeVisible({ timeout: 30_000 });

      const march = monthRow(currencySection(page, "USD"), "March 2026");
      const demoMarch = flowOf("demo", "USD").months[0];
      await expect(march.getByTestId("flow-net")).toHaveText(net(demoMarch.netMinor, "USD"));
      await expect(march.getByTestId("flow-in")).toBeInViewport();
      await expect(march.getByTestId("flow-out")).toBeInViewport();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        ),
      ).toBeLessThanOrEqual(0);
    });
  });
});
