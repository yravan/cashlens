import fs from "node:fs";

import { SEED_CLERK_IDS } from "../db/seed/dataset";
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

test.describe("upcoming expenses view", () => {
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

  test("the pinned April projection shows the exact total, the calendar, and both lists", async ({
    page,
  }) => {
    await page.goto("/upcoming?on=2026-04-01");

    await expect(page.getByTestId("upcoming-to-leave")).toHaveText("-$23.00", {
      timeout: 30_000,
    });
    await expect(page.getByTestId("upcoming-to-arrive")).toHaveText("+$2,500.00");

    const charge = page.getByTestId("upcoming-charge");
    await expect(charge).toHaveCount(1);
    await expect(charge).toContainText("Streamflix");
    await expect(charge).toContainText("Monthly · expected Apr 29, 2026 · last on Mar 29, 2026");
    await expect(charge).toContainText("-$23.00");
    await expect(charge).not.toContainText("not seen");

    const deposit = page.getByTestId("upcoming-deposit");
    await expect(deposit).toHaveCount(1);
    await expect(deposit).toContainText("Acme Corp");
    await expect(deposit).toContainText("expected Apr 27, 2026");
    await expect(deposit).toContainText("+$2,500.00");

    const calendar = page.getByTestId("upcoming-calendar");
    await expect(calendar.locator("caption")).toHaveText("April 2026");
    await expect(calendar.locator("td").filter({ hasText: "Streamflix" })).toContainText("29");
    await expect(calendar.locator("td").filter({ hasText: "Acme Corp" })).toContainText("27");

    await expect(page.getByTestId("upcoming-pinned")).toContainText("Projected as of Apr 1, 2026");
    await page.getByRole("link", { name: "Back to today" }).click();
    await expect(page).toHaveURL("/upcoming");
  });

  test("an expected date the reference has passed is labeled not-seen and still counted", async ({
    page,
  }) => {
    await page.goto("/upcoming?on=2026-04-28");

    await expect(page.getByTestId("upcoming-to-leave")).toHaveText("-$23.00", {
      timeout: 30_000,
    });
    const deposit = page.getByTestId("upcoming-deposit");
    await expect(deposit).toContainText("expected Apr 27, 2026 — not seen yet");
    await expect(page.getByTestId("upcoming-to-arrive")).toHaveText("+$2,500.00");
    await expect(page.getByTestId("upcoming-charge")).not.toContainText("not seen");
  });

  test("a reference far past the data projects nothing and says so, instead of phantom bills", async ({
    page,
  }) => {
    await page.goto("/upcoming?on=2026-09-01");

    await expect(page.getByTestId("upcoming-quiet")).toContainText(
      "No expected charges between Sep 1, 2026 and the end of September",
      { timeout: 30_000 },
    );
    await expect(page.getByTestId("upcoming-to-leave")).toHaveCount(0);
    await expect(page.getByTestId("upcoming-charge")).toHaveCount(0);

    const stale = page.getByTestId("upcoming-stale");
    await expect(stale).toContainText("Gone quiet");
    const staleStreams = page.getByTestId("upcoming-stale-stream");
    await expect(staleStreams).toHaveCount(2);
    await expect(staleStreams.filter({ hasText: "Streamflix" })).toContainText(
      "nothing since Mar 29, 2026",
    );
    await expect(staleStreams.filter({ hasText: "Acme Corp" })).toContainText(
      "nothing since Mar 27, 2026",
    );
  });

  test("an invalid or unknown date filter is refused with no data rendered", async ({ page }) => {
    for (const query of ["on=2026-02-30", "on=westeros", "until=2026-04-01"]) {
      await page.goto(`/upcoming?${query}`);
      await expect(page.getByTestId("filter-error")).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId("upcoming-calendar")).toHaveCount(0);
      await expect(page.getByTestId("upcoming-charge")).toHaveCount(0);
    }
  });

  test("a neighbor's upcoming page knows nothing of demo projections", async ({
    page,
    browser,
    baseURL,
  }) => {
    await page.goto("/upcoming?on=2026-04-01");
    await expect(page.getByTestId("upcoming-to-leave")).toHaveText("-$23.00", {
      timeout: 30_000,
    });

    const contextB = await browser.newContext({
      baseURL,
      storageState: await signedInState(browser, "b"),
    });
    try {
      const pageB = await contextB.newPage();
      await pageB.goto("/upcoming?on=2026-04-01");
      await expect(pageB.getByTestId("upcoming-empty")).toBeVisible({ timeout: 30_000 });
      await expect(pageB.getByTestId("upcoming-charge")).toHaveCount(0);
      await expect(pageB.locator("main")).not.toContainText("Streamflix");
      await expect(pageB.locator("main")).not.toContainText("Acme");
    } finally {
      await contextB.close();
    }
  });

  test.describe("phone viewport", () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

    test("the total, the list, and the calendar all reach a phone screen", async ({ page }) => {
      await page.goto("/upcoming?on=2026-04-01");

      await expect(page.getByTestId("upcoming-to-leave")).toHaveText("-$23.00", {
        timeout: 30_000,
      });
      await expect(page.getByTestId("upcoming-charge")).toContainText("Streamflix");
      await expect(page.getByTestId("upcoming-calendar")).toBeVisible();
      const noHorizontalScroll = await page.evaluate(
        () => document.body.scrollWidth <= window.innerWidth,
      );
      expect(noHorizontalScroll).toBe(true);
    });
  });
});
