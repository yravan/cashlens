import fs from "node:fs";
import { type Page } from "@playwright/test";

import { SEED_CLERK_IDS } from "../db/seed/dataset";
import { E2E_USERS_FILE } from "../playwright.config";
import { adminQuery, seedLedgerFixture } from "./db";
import { expect, test } from "./fixtures";
import { refreshPageSession, signedInContext, signedInState } from "./session";

const clerkIdOf = (key: "a" | "b"): string =>
  JSON.parse(fs.readFileSync(E2E_USERS_FILE, "utf8"))[key].clerkUserId;

async function userIdOf(key: "a" | "b"): Promise<string> {
  const result = await adminQuery("select id from users where clerk_user_id = $1", [clerkIdOf(key)]);
  return result.rows[0].id;
}

async function ledgerSnapshot(userId: string) {
  const result = await adminQuery(
    "select * from transactions where user_id = $1 order by id",
    [userId],
  );
  return result.rows;
}

const streams = (page: Page) => page.getByTestId("recurring-stream");
const section = (page: Page, status: "proposed" | "confirmed" | "dismissed" | "canceled") =>
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

  test("beyond-safe recurring amounts render exactly and remain actionable", async ({ page }) => {
    const userId = await userIdOf("a");
    const { rows: [account] } = await adminQuery(
      `insert into accounts (user_id, name, type, currency, source)
       values ($1, 'Exact recurring wallet', 'depository', 'KWD', 'manual') returning id`,
      [userId],
    );
    await adminQuery(
      `insert into transactions
       (user_id, account_id, amount_minor, currency, date, description, status, source)
       select $1, $2, amount, 'KWD', date, 'Exact recurring', 'posted', 'manual'
       from unnest(array['2026-01-05','2026-02-05','2026-03-05']::date[]) as date
       cross join unnest(array[$3::bigint, -2::bigint]) as amount`,
      [userId, account.id, -Number.MAX_SAFE_INTEGER],
    );
    await page.goto("/recurring");
    const stream = streams(page).filter({ hasText: "EXACT RECURRING" });
    await expect(stream.getByTestId("stream-amount")).toHaveText("-KWD\u00a09,007,199,254,740.993");
    await expect(stream.getByTestId("stream-annual")).toHaveText("-KWD\u00a0108,086,391,056,891.916/yr");
    await expect(page.getByTestId("annual-KWD").getByTestId("annual-out"))
      .toHaveText("-KWD\u00a0108,086,391,056,891.916");
    await stream.getByRole("button", { name: "Confirm: EXACT RECURRING" }).click();
    await expect(section(page, "confirmed")).toContainText("EXACT RECURRING");
    await page.goto("/upcoming?on=2026-04-01");
    const kwd = page.getByTestId("upcoming-currency-KWD");
    await expect(kwd.getByTestId("upcoming-to-leave")).toHaveText("-KWD\u00a09,007,199,254,740.993");
    await expect(kwd.getByTestId("upcoming-to-arrive")).toHaveCount(0);
    await expect(kwd.getByTestId("upcoming-charge")).toHaveCount(1);
    await page.goto("/recurring");
    await section(page, "confirmed").getByRole("button", { name: "Mark canceled: EXACT RECURRING" }).click();
    await expect(section(page, "canceled")).toContainText("EXACT RECURRING");
    await expect(page.getByTestId("annual-KWD")).toHaveCount(0);
    await page.goto("/upcoming?on=2026-04-01");
    await expect(page.getByTestId("upcoming-currency-KWD")).toHaveCount(0);
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

  test("yearly cost per stream and per currency; marking one canceled drops Upcoming by exactly its amount", async ({
    page,
  }) => {
    await page.goto("/recurring");
    await expect(streams(page)).toHaveCount(2, { timeout: 30_000 });
    await expect(page.getByTestId("annual-out")).toHaveText("-$276.00");
    await expect(page.getByTestId("annual-in")).toHaveText("+$30,000.00");
    const streamflix = streams(page).filter({ hasText: "Streamflix" });
    await expect(streamflix.getByTestId("stream-annual")).toHaveText("-$276.00/yr");
    await expect(
      streams(page).filter({ hasText: "Acme Corp" }).getByTestId("stream-annual"),
    ).toHaveText("+$30,000.00/yr");
    await expect(page.getByTestId("price-increase")).toHaveCount(0);
    await expect(page.getByTestId("charged-after-cancel")).toHaveCount(0);

    await streamflix.getByRole("button", { name: "Mark canceled: Streamflix" }).click();
    await expect(section(page, "canceled")).toContainText("Streamflix");
    await expect(section(page, "canceled")).toContainText("Left out of Upcoming and the yearly total");
    await expect(page.getByTestId("annual-out")).toHaveText("$0.00");
    await expect(page.getByTestId("annual-in")).toHaveText("+$30,000.00");

    await page.goto("/upcoming?on=2026-04-01");
    await expect(page.getByTestId("upcoming-to-leave")).toHaveText("-$2,473.00");
    await expect(page.getByTestId("upcoming-to-arrive")).toHaveText("+$2,500.00");
    await expect(page.getByTestId("upcoming-charge")).toHaveCount(3);
    await expect(page.getByTestId("upcoming-deposit")).toHaveCount(1);
    const canceledStreamflix = page.getByTestId("upcoming-charge").filter({ hasText: "Streamflix" });
    await expect(canceledStreamflix).toHaveCount(1);
    await expect(canceledStreamflix).toContainText("Known");
    await expect(canceledStreamflix).not.toContainText("Predicted");

    await page.goto("/upcoming?on=2026-09-01");
    await expect(page.getByTestId("upcoming-to-leave")).toHaveText("-$4,296.00");
    await expect(page.getByTestId("upcoming-charge")).toHaveCount(5);
    await expect(page.getByTestId("upcoming-stale-stream")).toHaveCount(1);
    await expect(page.getByTestId("upcoming-stale")).toContainText("mark it canceled under Recurring");
    const continuingStreamflix = page
      .getByTestId("upcoming-charge")
      .filter({ hasText: "Streamflix" });
    await expect(continuingStreamflix).toHaveCount(2);
    await expect(continuingStreamflix.filter({ hasText: "Known" })).toHaveCount(2);
    await expect(continuingStreamflix.filter({ hasText: "Predicted" })).toHaveCount(0);

    await page.goto("/recurring");
    await section(page, "canceled").getByRole("button", { name: "It's back: Streamflix" }).click();
    await expect(section(page, "confirmed")).toContainText("Streamflix");
    await expect(section(page, "canceled")).toHaveCount(0);
    await expect(page.getByTestId("annual-out")).toHaveText("-$276.00");
    await page.goto("/upcoming?on=2026-04-01");
    await expect(page.getByTestId("upcoming-to-leave")).toHaveText("-$2,496.00");
    await expect(page.getByTestId("upcoming-charge")).toHaveCount(4);
    const restoredStreamflix = page.getByTestId("upcoming-charge").filter({ hasText: "Streamflix" });
    await expect(restoredStreamflix).toHaveCount(2);
    await expect(restoredStreamflix.filter({ hasText: "Known" })).toHaveCount(1);
    await expect(restoredStreamflix.filter({ hasText: "Predicted" })).toHaveCount(1);
  });

  test("a 500-unit Unicode descriptor can be confirmed, canceled, and reloaded", async ({
    page,
  }) => {
    const descriptor = "\uFB03".repeat(500);
    await adminQuery(
      "update transactions set description = $1, merchant = $1 where user_id = $2 and merchant = 'Streamflix'",
      [descriptor, await userIdOf("a")],
    );

    await page.goto("/recurring");
    await expect(streams(page)).toHaveCount(2, { timeout: 30_000 });
    const longStream = section(page, "proposed").getByTestId("recurring-stream").nth(0);
    await expect(longStream.getByTestId("stream-amount")).toHaveText("-$23.00");
    await longStream.getByRole("button", { name: /^Confirm:/ }).click();
    const confirmed = section(page, "confirmed").getByTestId("recurring-stream");
    await expect(confirmed.getByTestId("stream-amount")).toHaveText("-$23.00");
    await confirmed.getByRole("button", { name: /^Mark canceled:/ }).click();
    const canceled = section(page, "canceled").getByTestId("recurring-stream");
    await expect(canceled.getByTestId("stream-amount")).toHaveText("-$23.00");
    await expect(page.getByTestId("annual-out")).toHaveText("$0.00");

    await page.reload();
    await expect(section(page, "canceled").getByTestId("recurring-stream")).toHaveCount(1);
    await expect(page.getByTestId("annual-out")).toHaveText("$0.00");
  });

  test("a dropped recurring action reports an error and retries the real mutation", async ({
    page,
  }) => {
    let attempts = 0;
    await page.route("**/api/recurring/streams", async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      attempts += 1;
      if (attempts === 1) return route.abort("connectionreset");
      return route.continue();
    });

    await page.goto("/recurring");
    const acme = section(page, "proposed").getByTestId("recurring-stream").filter({ hasText: "Acme Corp" });
    await acme.getByRole("button", { name: "Confirm: Acme Corp" }).click();
    await expect(acme.getByRole("alert")).toContainText("Try again");
    await expect(acme.getByRole("button", { name: "Retry" })).toBeEnabled();
    expect(
      (await adminQuery("select status from recurring_streams where user_id = $1", [await userIdOf("a")])).rows,
    ).toEqual([]);

    await acme.getByRole("button", { name: "Retry" }).click();
    await expect(section(page, "confirmed")).toContainText("Acme Corp");
  });

  test("a real API 403 reports an error and retries after the request is allowed", async ({ page }) => {
    let attempts = 0;
    await page.route("**/api/recurring/streams", async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      attempts += 1;
      if (attempts === 1) {
        const response = await route.fetch({
          headers: { ...route.request().headers(), origin: "https://evil.example" },
        });
        return route.fulfill({ response });
      }
      return route.continue();
    });

    await page.goto("/recurring");
    const acme = section(page, "proposed").getByTestId("recurring-stream").filter({ hasText: "Acme Corp" });
    const deniedResponse = page.waitForResponse((response) =>
      response.url().endsWith("/api/recurring/streams") && response.request().method() === "POST",
    );
    await acme.getByRole("button", { name: "Confirm: Acme Corp" }).click();
    expect((await deniedResponse).status()).toBe(403);
    await expect(acme.getByRole("alert")).toContainText("Try again");
    await expect(acme.getByRole("button", { name: "Retry" })).toBeEnabled();
    expect(
      (await adminQuery("select status from recurring_streams where user_id = $1", [await userIdOf("a")])).rows,
    ).toEqual([]);

    await acme.getByRole("button", { name: "Retry" }).click();
    await expect(section(page, "confirmed")).toContainText("Acme Corp");
  });

  test("a stale stream 404 refreshes without showing a transport error", async ({ page }) => {
    await page.goto("/recurring");
    const acme = section(page, "proposed").getByTestId("recurring-stream").filter({ hasText: "Acme Corp" });
    await expect(acme.getByRole("button", { name: "Confirm: Acme Corp" })).toBeVisible();
    await adminQuery("delete from transactions where user_id = $1 and merchant = $2", [await userIdOf("a"), "Acme Corp"]);
    const response = page.waitForResponse((item) =>
      item.url().endsWith("/api/recurring/streams") && item.request().method() === "POST",
    );
    await acme.getByRole("button", { name: "Confirm: Acme Corp" }).click();
    expect((await response).status()).toBe(404);
    await expect(page.locator("main").getByRole("alert")).toHaveCount(0);
    await expect(section(page, "proposed").getByTestId("recurring-stream").filter({ hasText: "Acme Corp" })).toHaveCount(0);
  });

  test("a lost successful response explains the uncertain outcome and retries idempotently", async ({ page }) => {
    let first = true;
    await page.route("**/api/recurring/streams", async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      if (!first) return route.continue();
      first = false;
      const response = await route.fetch();
      expect(response.status()).toBe(200);
      await route.abort("connectionreset");
    });

    const userId = await userIdOf("a");
    const before = await ledgerSnapshot(userId);
    await page.goto("/recurring");
    const streamflix = section(page, "proposed").getByTestId("recurring-stream").filter({ hasText: "Streamflix" });
    await streamflix.getByRole("button", { name: "Mark canceled: Streamflix" }).click();
    await expect(streamflix.getByRole("alert")).toContainText("may have succeeded");
    await expect(streamflix.getByRole("button", { name: "Retry" })).toBeEnabled();
    expect(
      (await adminQuery("select status from recurring_streams where user_id = $1", [userId])).rows,
    ).toEqual([{ status: "canceled" }]);
    expect(await ledgerSnapshot(userId)).toEqual(before);

    await streamflix.getByRole("button", { name: "Retry" }).click();
    await expect(section(page, "canceled")).toContainText("Streamflix");
    await expect(page.getByTestId("annual-out")).toHaveText("$0.00");
    expect(await ledgerSnapshot(userId)).toEqual(before);
  });

  test("a last charge above the usual amount is flagged as a price increase with both figures", async ({
    page,
  }) => {
    await adminQuery(
      "update transactions set amount_minor = -2599 where user_id = $1 and merchant = 'Streamflix' and date = '2026-03-29'",
      [await userIdOf("a")],
    );
    await page.goto("/recurring");
    await expect(streams(page)).toHaveCount(2, { timeout: 30_000 });
    const streamflix = streams(page).filter({ hasText: "Streamflix" });
    await expect(streamflix.getByTestId("price-increase")).toHaveText(
      "Price up · last -$25.99, usually -$23.00",
    );
    await expect(streamflix.getByTestId("stream-amount")).toHaveText("-$23.00");
    await expect(streamflix.getByTestId("stream-annual")).toHaveText("-$276.00/yr");
    await expect(streamflix).toContainText("3 occurrences, some variation");
    await expect(page.getByTestId("price-increase")).toHaveCount(1);
    await expect(page.getByTestId("annual-out")).toHaveText("-$276.00");
  });

  test("a charge dated after the cancel day is flagged until the user says it is still canceled", async ({
    page,
  }) => {
    await page.goto("/recurring");
    await expect(streams(page)).toHaveCount(2, { timeout: 30_000 });
    await streams(page)
      .filter({ hasText: "Streamflix" })
      .getByRole("button", { name: "Mark canceled: Streamflix" })
      .click();
    await expect(section(page, "canceled")).toContainText("Streamflix");
    await expect(page.getByTestId("charged-after-cancel")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Still canceled: Streamflix" })).toHaveCount(0);

    await adminQuery("update recurring_streams set updated_at = '2026-03-01T12:00:00Z' where user_id = $1", [
      await userIdOf("a"),
    ]);
    await refreshPageSession(page);
    await page.goto("/recurring");
    const streamflix = section(page, "canceled").getByTestId("recurring-stream");
    await expect(streamflix.getByTestId("charged-after-cancel")).toHaveText(
      "Charged Mar 29, 2026, after you marked it canceled on Mar 1, 2026",
    );
    await expect(page.getByTestId("annual-out")).toHaveText("$0.00");

    await streamflix.getByRole("button", { name: "Still canceled: Streamflix" }).click();
    await expect(streamflix.getByTestId("charged-after-cancel")).toHaveCount(0);
    await expect(streamflix.getByRole("button", { name: "Still canceled: Streamflix" })).toHaveCount(0);
    await expect(section(page, "canceled")).toContainText("Streamflix");
    await refreshPageSession(page);
    await page.goto("/recurring");
    await expect(section(page, "canceled")).toContainText("Streamflix");
    await expect(page.getByTestId("charged-after-cancel")).toHaveCount(0);
  });

  test("a neighbor's recurring page is empty and knows nothing of demo streams", async ({
    page,
    browser,
    baseURL,
  }) => {
    await page.goto("/recurring");
    await expect(streams(page)).toHaveCount(2, { timeout: 30_000 });

    const contextB = await signedInContext(browser, "b", baseURL);
    try {
      const pageB = await contextB.newPage();
      await pageB.goto("/recurring");
      await expect(pageB.getByTestId("recurring-empty")).toBeVisible({ timeout: 30_000 });
      await expect(pageB.getByTestId("recurring-stream")).toHaveCount(0);
      await expect(pageB.getByTestId("recurring-annual")).toHaveCount(0);
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

  test.describe("narrow phone viewport", () => {
    test.use({ viewport: { width: 320, height: 568 }, hasTouch: true });

    test("yearly totals, the cancel action, and its result fit 320px without sideways scrolling", async ({
      page,
    }) => {
      await page.goto("/recurring");
      await expect(streams(page)).toHaveCount(2, { timeout: 30_000 });
      await expect(page.getByTestId("annual-out")).toHaveText("-$276.00");
      await expect(page.getByTestId("annual-in")).toHaveText("+$30,000.00");

      await streams(page)
        .filter({ hasText: "Streamflix" })
        .getByRole("button", { name: "Mark canceled: Streamflix" })
        .click();
      await expect(section(page, "canceled")).toContainText("Streamflix");
      await expect(page.getByTestId("annual-out")).toHaveText("$0.00");
      const noHorizontalScroll = await page.evaluate(
        () => document.body.scrollWidth <= window.innerWidth,
      );
      expect(noHorizontalScroll).toBe(true);
    });
  });
});
