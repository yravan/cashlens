import fs from "node:fs";
import { type Page } from "@playwright/test";

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

const streams = (page: Page) => page.getByTestId("recurring-stream");
const section = (page: Page, status: "proposed" | "confirmed" | "dismissed") =>
  page.getByTestId(`recurring-${status}`);

test.describe("recurring charge detection", () => {
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

  test("the seeded detections list exactly, and confirm/dismiss survive a reload", async ({
    page,
  }) => {
    await page.goto("/recurring");
    await expect(streams(page)).toHaveCount(2, { timeout: 30_000 });

    const proposed = section(page, "proposed");
    const streamflix = proposed.getByTestId("recurring-stream").filter({ hasText: "Streamflix" });
    await expect(streamflix).toContainText(
      "Monthly · last on Mar 29, 2026 · 3 occurrences, on schedule every time",
    );
    await expect(streamflix.getByTestId("stream-amount")).toHaveText("-$23.00");
    const acme = proposed.getByTestId("recurring-stream").filter({ hasText: "Acme Corp" });
    await expect(acme).toContainText(
      "Monthly · last on Mar 27, 2026 · 3 occurrences, on schedule every time",
    );
    await expect(acme.getByTestId("stream-amount")).toHaveText("+$2,500.00");

    await acme.getByRole("button", { name: "Confirm: Acme Corp" }).click();
    await expect(section(page, "confirmed")).toContainText("Acme Corp");
    await expect(section(page, "proposed").getByTestId("recurring-stream")).toHaveCount(1);

    await streamflix.getByRole("button", { name: "Not recurring: Streamflix" }).click();
    await expect(section(page, "dismissed")).toContainText("Streamflix");
    await expect(section(page, "proposed")).toHaveCount(0);

    await page.reload();
    await expect(streams(page)).toHaveCount(2);
    await expect(section(page, "confirmed")).toContainText("Acme Corp");
    await expect(section(page, "dismissed")).toContainText("Streamflix");
    await expect(section(page, "proposed")).toHaveCount(0);

    await section(page, "dismissed")
      .getByRole("button", { name: "Mark recurring: Streamflix" })
      .click();
    await expect(
      section(page, "confirmed").getByTestId("recurring-stream"),
    ).toHaveCount(2);
    await expect(section(page, "dismissed")).toHaveCount(0);
  });

  test("a neighbor's recurring page is empty and knows nothing of demo streams", async ({
    page,
    browser,
    baseURL,
  }) => {
    await page.goto("/recurring");
    await expect(streams(page)).toHaveCount(2, { timeout: 30_000 });

    const contextB = await browser.newContext({
      baseURL,
      storageState: await signedInState(browser, "b"),
    });
    try {
      const pageB = await contextB.newPage();
      await pageB.goto("/recurring");
      await expect(pageB.getByTestId("recurring-empty")).toBeVisible({ timeout: 30_000 });
      await expect(pageB.getByTestId("recurring-stream")).toHaveCount(0);
      await expect(pageB.locator("main")).not.toContainText("Acme");
      await expect(pageB.locator("main")).not.toContainText("Streamflix");
    } finally {
      await contextB.close();
    }
  });

  test.describe("phone viewport", () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

    test("the list and actions work by touch", async ({ page }) => {
      await page.goto("/recurring");
      await expect(streams(page)).toHaveCount(2, { timeout: 30_000 });

      const acme = streams(page).filter({ hasText: "Acme Corp" });
      await expect(acme.getByTestId("stream-amount")).toHaveText("+$2,500.00");
      await acme.getByRole("button", { name: "Confirm: Acme Corp" }).click();
      await expect(section(page, "confirmed")).toContainText("Acme Corp");
    });
  });
});
