import fs from "node:fs";

import type { Locator, Page } from "@playwright/test";

import { SEED_CLERK_IDS } from "../db/seed/dataset";
import { E2E_USERS_FILE } from "../playwright.config";
import { adminQuery, seedLedgerFixture } from "./db";
import { expect, test } from "./fixtures";
import { signedInContext, signedInState } from "./session";

const clerkIdOf = (key: "a" | "b"): string =>
  JSON.parse(fs.readFileSync(E2E_USERS_FILE, "utf8"))[key].clerkUserId;

async function userIdOf(key: "a" | "b"): Promise<string> {
  const result = await adminQuery("select id from users where clerk_user_id = $1", [clerkIdOf(key)]);
  return result.rows[0].id;
}

async function transactionCount(userId: string): Promise<number> {
  const result = await adminQuery("select count(*)::int as count from transactions where user_id = $1", [
    userId,
  ]);
  return result.rows[0].count;
}

const obligationCard = (management: Locator, name: string) =>
  management.getByTestId("obligation-card").filter({ hasText: name });

const documentOverflow = (page: Page) =>
  page.evaluate(
    () =>
      Math.max(document.body.scrollWidth, document.documentElement.scrollWidth) -
      document.documentElement.clientWidth,
  );

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

  test("the pinned April projection labels known and predicted overlaps while counting both", async ({
    page,
  }) => {
    await page.goto("/upcoming?on=2026-04-01");

    await expect(page.getByTestId("upcoming-to-leave")).toHaveText("-$2,496.00", {
      timeout: 30_000,
    });
    await expect(page.getByTestId("upcoming-to-arrive")).toHaveText("+$2,500.00");

    const charges = page.getByTestId("upcoming-charge");
    await expect(charges).toHaveCount(4);
    const rent = charges.filter({ hasText: "Rent" });
    await expect(rent).toContainText("Known");
    await expect(rent).toContainText("-$1,800.00");
    await expect(rent.locator('a[href^="/transactions?"]')).toHaveCount(0);

    const overlaps = charges.filter({ hasText: "Streamflix" });
    await expect(overlaps).toHaveCount(2);
    const warning = "Possible overlap — both are counted until matching is available.";
    await expect(overlaps.nth(0)).toContainText(warning);
    await expect(overlaps.nth(1)).toContainText(warning);
    const predicted = overlaps.filter({ hasText: "Predicted" });
    const known = overlaps.filter({ hasText: "Known" });
    await expect(predicted).toHaveCount(1);
    await expect(known).toHaveCount(1);
    await expect(predicted.getByRole("link", { name: "Streamflix" })).toHaveAttribute(
      "href",
      /^\/transactions\?account=[0-9a-f-]+&q=Streamflix$/,
    );
    await expect(known.locator('a[href^="/transactions?"]')).toHaveCount(0);
    await expect(predicted).toContainText("Monthly · expected Apr 29, 2026 · last on Mar 29, 2026");

    const deposit = page.getByTestId("upcoming-deposit");
    await expect(deposit).toHaveCount(1);
    await expect(deposit).toContainText("Acme Corp");
    await expect(deposit).toContainText("expected Apr 27, 2026");
    await expect(deposit).toContainText("+$2,500.00");

    await expect(page.getByTestId("upcoming-pinned")).toContainText("Projected as of Apr 1, 2026");
    await page.getByRole("link", { name: "Back to today" }).click();
    await expect(page).toHaveURL("/upcoming");
  });

  test("the explanation distinguishes forecast totals from the posted ledger", async ({ page }) => {
    await page.goto("/upcoming?on=2026-04-01");

    await expect(page.locator("main")).toContainText(
      "Known charges and predicted recurring patterns appear here before they post.",
      { timeout: 30_000 },
    );
    await expect(page.locator("main")).toContainText(
      "The amounts count in this Upcoming forecast, not your ledger totals.",
    );
  });

  test("the calendar labels both sources and warns on both overlap entries", async ({ page }) => {
    await page.goto("/upcoming?on=2026-04-01");

    const calendar = page.getByTestId("upcoming-calendar");
    await expect(calendar.locator("caption")).toHaveText("April 2026", { timeout: 30_000 });
    const overlaps = calendar
      .getByTestId("upcoming-calendar-occurrence")
      .filter({ hasText: "Streamflix" });
    await expect(overlaps).toHaveCount(2);
    await expect(overlaps.filter({ hasText: "Known" })).toHaveCount(1);
    await expect(overlaps.filter({ hasText: "Predicted" })).toHaveCount(1);
    const warning = "Possible overlap — both are counted until matching is available.";
    await expect(overlaps.nth(0)).toContainText(warning);
    await expect(overlaps.nth(1)).toContainText(warning);
    await expect(calendar.locator("p", { hasText: warning })).toHaveCount(0);
    await expect(calendar.locator("td").filter({ hasText: "Streamflix" })).toContainText("29");
    await expect(calendar.locator("td").filter({ hasText: "Acme Corp" })).toContainText("27");
  });

  test("management lists the owner's active declarations with bounded next dates", async ({ page }) => {
    await page.goto("/upcoming?on=2026-04-01");

    const management = page.getByTestId("known-obligations");
    await expect(management.getByRole("heading", { name: "Known obligations" })).toBeVisible({
      timeout: 30_000,
    });
    await expect(management.getByTestId("obligation-card")).toHaveCount(3);
    await expect(management).toContainText("Rent");
    await expect(management).toContainText("Everyday Checking");
    await expect(management).toContainText("Monthly");
    await expect(management).toContainText("Next Apr 5, 2026");
    await expect(management).not.toContainText("Insurance");
  });

  test("management remains available before any declaration reaches the calendar", async ({
    page,
  }) => {
    await page.goto("/upcoming?on=2026-03-01");

    await expect(page.getByTestId("upcoming-quiet")).toContainText(
      "No expected charges between Mar 1, 2026 and the end of March",
      { timeout: 30_000 },
    );
    await expect(page.getByTestId("upcoming-charge")).toHaveCount(0);
    const management = page.getByTestId("known-obligations");
    await expect(management.getByTestId("obligation-card")).toHaveCount(3);
    await expect(obligationCard(management, "Rent")).toContainText("Next Apr 5, 2026");
  });

  test("guides people to Accounts when no account can hold an obligation", async ({ page }) => {
    const userId = await userIdOf("a");
    await adminQuery("delete from accounts where user_id = $1", [userId]);

    await page.goto("/upcoming?on=2026-04-01");

    const management = page.getByTestId("known-obligations");
    await expect(management.getByRole("heading", { name: "Known obligations" })).toBeVisible({
      timeout: 30_000,
    });
    await expect(management).toContainText("An account is required to add a known obligation.");
    await expect(management.getByRole("link", { name: "Go to Accounts" })).toHaveAttribute(
      "href",
      "/accounts",
    );
    await expect(management.getByRole("button", { name: "Add obligation" })).toHaveCount(0);
  });

  test("guides people to add a first obligation when accounts are available", async ({ page }) => {
    const userId = await userIdOf("a");
    await adminQuery("delete from scheduled_obligations where user_id = $1", [userId]);

    await page.goto("/upcoming?on=2026-04-01");

    const management = page.getByTestId("known-obligations");
    await expect(management).toContainText(
      "Add rent, insurance, tuition, or another known charge.",
      { timeout: 30_000 },
    );
    await expect(management.getByRole("button", { name: "Add obligation" })).toBeVisible();
    await expect(management.getByTestId("obligation-card")).toHaveCount(0);
  });

  test("adds a one-time obligation without changing the posted ledger", async ({ page }) => {
    const userId = await userIdOf("a");
    const before = await transactionCount(userId);
    await page.goto("/upcoming?on=2026-04-01");

    const management = page.getByTestId("known-obligations");
    const add = management.getByRole("button", { name: "Add obligation" });
    await add.click();
    const form = management.getByRole("form", { name: "Add obligation" });
    await form.getByLabel("Name").fill("Course materials");
    await form.getByLabel("Account").selectOption({ label: "Everyday Checking" });
    await expect(form.getByLabel("Currency")).toHaveValue("USD");
    await form.getByLabel("Amount").fill("125.50");
    await form.getByLabel("First due date").fill("2026-04-24");
    await form.getByLabel("Repeat").selectOption("once");
    await expect(form.getByLabel("Final date")).toHaveCount(0);
    await form.getByRole("button", { name: "Add obligation" }).click();

    const card = obligationCard(management, "Course materials");
    await expect(card).toContainText("Everyday Checking · One time · starts Apr 24, 2026", {
      timeout: 30_000,
    });
    await expect(card).toContainText("Next Apr 24, 2026");
    await expect(card).toContainText("$125.50");
    await expect(add).toBeFocused();
    const charge = page.getByTestId("upcoming-charge").filter({ hasText: "Course materials" });
    await expect(charge).toContainText("Known");
    await expect(charge).toContainText("expected Apr 24, 2026");
    await expect(charge).toContainText("-$125.50");
    await expect(page.getByTestId("upcoming-to-leave")).toHaveText("-$2,621.50");
    await expect(transactionCount(userId)).resolves.toBe(before);
  });

  test("edits a repeating month-end obligation without changing the posted ledger", async ({
    page,
  }) => {
    const userId = await userIdOf("a");
    const before = await transactionCount(userId);
    await page.goto("/upcoming?on=2026-02-01");

    const management = page.getByTestId("known-obligations");
    await management.getByRole("button", { name: "Add obligation" }).click();
    const addForm = management.getByRole("form", { name: "Add obligation" });
    await addForm.getByLabel("Name").fill("Council tax");
    await addForm.getByLabel("Account").selectOption({ label: "Everyday Checking" });
    await addForm.getByLabel("Amount").fill("100.00");
    await addForm.getByLabel("First due date").fill("2026-01-31");
    await addForm.getByLabel("Repeat").selectOption("monthly");
    await addForm.getByLabel("Final date").fill("2026-04-30");
    await addForm.getByRole("button", { name: "Add obligation" }).click();

    const card = obligationCard(management, "Council tax");
    await expect(card).toContainText("Next Feb 28, 2026", { timeout: 30_000 });
    const edit = card.getByRole("button", { name: "Edit Council tax" });
    await edit.click();
    const editForm = card.getByRole("form", { name: "Edit Council tax" });
    await expect(editForm.getByLabel("Amount")).toHaveValue("100");
    await expect(editForm.getByLabel("Final date")).toHaveValue("2026-04-30");
    await editForm.getByLabel("Amount").fill("110.50");
    await editForm.getByLabel("First due date").fill("2026-02-27");
    await editForm.getByLabel("Final date").fill("2026-05-31");
    await editForm.getByRole("button", { name: "Save changes" }).click();

    await expect(card).toContainText("Monthly · starts Feb 27, 2026 · ends May 31, 2026", {
      timeout: 30_000,
    });
    await expect(card).toContainText("Next Feb 27, 2026");
    await expect(card).toContainText("$110.50");
    await expect(edit).toBeFocused();
    const charge = page.getByTestId("upcoming-charge").filter({ hasText: "Council tax" });
    await expect(charge).toHaveCount(1);
    await expect(charge).toContainText("expected Feb 27, 2026");
    await expect(charge).toContainText("-$110.50");
    await expect(page.getByTestId("upcoming-to-leave")).toHaveText("-$110.50");
    await expect(transactionCount(userId)).resolves.toBe(before);
  });

  test("ends an obligation without changing the posted ledger", async ({ page }) => {
    const userId = await userIdOf("a");
    const before = await transactionCount(userId);
    await page.goto("/upcoming?on=2026-04-01");

    const management = page.getByTestId("known-obligations");
    const card = obligationCard(management, "Tuition");
    const end = card.getByRole("button", { name: "End Tuition" });
    await end.click();
    const confirmation = card.getByRole("form", { name: "End Tuition" });
    await expect(confirmation).toContainText("End Tuition?");
    await confirmation.getByRole("button", { name: "Cancel" }).click();
    await expect(end).toBeFocused();

    await end.click();
    await card
      .getByRole("form", { name: "End Tuition" })
      .getByRole("button", { name: "End obligation" })
      .click();

    await expect(card).toHaveCount(0, { timeout: 30_000 });
    await expect(page.getByTestId("upcoming-charge").filter({ hasText: "Tuition" })).toHaveCount(0);
    await expect(
      page.getByTestId("upcoming-calendar-occurrence").filter({ hasText: "Tuition" }),
    ).toHaveCount(0);
    await expect(page.getByTestId("upcoming-to-leave")).toHaveText("-$1,846.00");
    await expect(management.getByRole("button", { name: "Add obligation" })).toBeFocused();
    await expect(transactionCount(userId)).resolves.toBe(before);

    await management.getByRole("button", { name: "Add obligation" }).click();
    const addForm = management.getByRole("form", { name: "Add obligation" });
    await expect(addForm.getByLabel("Name")).toBeFocused();
    const rent = obligationCard(management, "Rent");
    await rent.getByRole("button", { name: "End Rent" }).click();
    await rent
      .getByRole("form", { name: "End Rent" })
      .getByRole("button", { name: "End obligation" })
      .click();

    await expect(rent).toHaveCount(0, { timeout: 30_000 });
    await expect(page.getByTestId("upcoming-to-leave")).toHaveText("-$46.00");
    await expect(addForm).toHaveCount(1);
    await expect(management.getByRole("heading", { name: "Known obligations" })).toBeFocused();
    await expect(transactionCount(userId)).resolves.toBe(before);
  });

  test("a passed known obligation uses neutral copy and never links to transactions", async ({
    page,
  }) => {
    const userId = await userIdOf("a");
    const account = await adminQuery(
      "select id from accounts where user_id = $1 and name = 'Everyday Checking'",
      [userId],
    );
    await adminQuery("delete from transactions where user_id = $1", [userId]);
    await adminQuery("delete from scheduled_obligations where user_id = $1", [userId]);
    await adminQuery(
      `insert into scheduled_obligations
         (user_id, account_id, name, amount_minor, currency, cadence, starts_on)
       values ($1, $2, 'Rent', 180000, 'USD', 'once', '2026-04-15')`,
      [userId, account.rows[0].id],
    );

    await page.goto("/upcoming?on=2026-04-20");

    await expect(page.getByTestId("upcoming-empty")).toHaveCount(0);
    await expect(page.getByTestId("upcoming-to-leave")).toHaveText("-$1,800.00", {
      timeout: 30_000,
    });
    const charge = page.getByTestId("upcoming-charge");
    await expect(charge).toContainText("Rent");
    await expect(charge).toContainText("One time · expected Apr 15, 2026 — Scheduled date passed");
    await expect(charge).toContainText("-$1,800.00");
    await expect(charge).not.toContainText("not seen yet");
    await expect(charge.locator('a[href^="/transactions?"]')).toHaveCount(0);

    const calendarEntry = page
      .getByTestId("upcoming-calendar")
      .locator("td")
      .filter({ hasText: "Rent" });
    await expect(calendarEntry).toContainText("15");
    await expect(calendarEntry).toContainText("Scheduled date passed");
    await expect(calendarEntry).not.toContainText("not seen yet");
    await expect(calendarEntry.locator("a")).toHaveCount(0);
  });

  test("an expected date the reference has passed is labeled not-seen and still counted", async ({
    page,
  }) => {
    await page.goto("/upcoming?on=2026-04-28");

    await expect(page.getByTestId("upcoming-to-leave")).toHaveText("-$2,496.00", {
      timeout: 30_000,
    });
    const deposit = page.getByTestId("upcoming-deposit");
    await expect(deposit).toContainText("expected Apr 27, 2026 — not seen yet");
    await expect(page.getByTestId("upcoming-to-arrive")).toHaveText("+$2,500.00");
    expect((await page.getByTestId("upcoming-charge").allTextContents()).join(" ")).not.toContain(
      "not seen",
    );
    const calendarEntry = page
      .getByTestId("upcoming-calendar")
      .locator("td")
      .filter({ hasText: "Acme Corp" });
    await expect(calendarEntry).toContainText("expected but not seen yet");
    await expect(calendarEntry).not.toContainText("Scheduled date passed");
  });

  test("a January month-end subscription stays due on March 31 after February", async ({ page }) => {
    await adminQuery(
      `update transactions set date = case date
         when '2026-01-29' then '2025-11-30'::date
         when '2026-02-28' then '2025-12-31'::date
         when '2026-03-29' then '2026-01-31'::date end
       where user_id = $1 and merchant = 'Streamflix'`,
      [await userIdOf("a")],
    );
    await page.goto("/upcoming?on=2026-03-29");
    await expect(page.getByTestId("upcoming-to-leave")).toHaveText("-$46.00");
    const charges = page.getByTestId("upcoming-charge");
    await expect(charges).toHaveCount(2);
    await expect(charges.nth(0)).toContainText("expected Feb 28, 2026");
    await expect(charges.nth(0)).toContainText("not seen yet");
    await expect(charges.nth(1)).toContainText("expected Mar 31, 2026");
    await expect(charges.nth(1)).not.toContainText("not seen yet");
    const calendar = page.getByTestId("upcoming-calendar");
    await expect(calendar.locator("caption")).toHaveText("March 2026");
    await expect(calendar.locator("td").filter({ hasText: "Streamflix" })).toContainText("31");
    await expect(page.getByTestId("upcoming-stale-stream")).toHaveCount(0);
  });

  test("a far-future reference keeps declarations projected while detected streams go quiet", async ({
    page,
  }) => {
    await page.goto("/upcoming?on=2026-09-01");

    await expect(page.getByTestId("upcoming-to-leave")).toHaveText("-$4,296.00", {
      timeout: 30_000,
    });
    const charges = page.getByTestId("upcoming-charge");
    await expect(charges).toHaveCount(5);
    await expect(charges.filter({ hasText: "Rent" })).toHaveCount(2);
    await expect(charges.filter({ hasText: "Tuition" })).toHaveCount(1);
    await expect(charges.filter({ hasText: "Streamflix" })).toHaveCount(2);
    await expect(charges.filter({ hasText: "Predicted" })).toHaveCount(0);
    await expect(charges.filter({ hasText: "Known" })).toHaveCount(5);

    const management = page.getByTestId("known-obligations");
    await expect(management.getByTestId("obligation-card")).toHaveCount(3);
    await expect(obligationCard(management, "Rent")).toContainText("Next Sep 5, 2026");

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

  test("seeded known obligations remain isolated by owner", async ({ page, browser, baseURL }) => {
    await page.goto("/upcoming?on=2026-04-01");
    await expect(page.getByTestId("upcoming-to-leave")).toHaveText("-$2,496.00", {
      timeout: 30_000,
    });

    const contextB = await signedInContext(browser, "b", baseURL);
    try {
      const pageB = await contextB.newPage();
      await pageB.goto("/upcoming?on=2026-04-01");
      await expect(pageB.getByTestId("upcoming-to-leave")).toHaveText("-$1,200.00", {
        timeout: 30_000,
      });
      const charge = pageB.getByTestId("upcoming-charge");
      await expect(charge).toHaveCount(1);
      await expect(charge).toContainText("Insurance");
      await expect(charge).toContainText("Known");
      const management = pageB.getByTestId("known-obligations");
      await expect(management.getByTestId("obligation-card")).toHaveCount(1);
      await expect(management).toContainText("Insurance");
      for (const name of ["Rent", "Tuition", "Streamflix", "Acme Corp"]) {
        await expect(pageB.locator("main")).not.toContainText(name);
      }
    } finally {
      await contextB.close();
    }
  });

  test("a ledger with no streams and no declarations shows the empty state", async ({
    browser,
    baseURL,
  }) => {
    await adminQuery("delete from scheduled_obligations where user_id = $1", [await userIdOf("b")]);
    const contextB = await browser.newContext({
      baseURL,
      storageState: await signedInState(browser, "b"),
    });
    try {
      const pageB = await contextB.newPage();
      await pageB.goto("/upcoming?on=2026-04-01");
      await expect(pageB.getByTestId("upcoming-empty")).toContainText("Nothing to project yet", {
        timeout: 30_000,
      });
      await expect(pageB.getByTestId("upcoming-calendar")).toHaveCount(0);
      await expect(pageB.getByTestId("upcoming-quiet")).toHaveCount(0);
      await expect(pageB.getByTestId("upcoming-to-leave")).toHaveCount(0);
      await expect(pageB.getByTestId("known-obligations")).toContainText(
        "Add rent, insurance, tuition, or another known charge.",
      );
    } finally {
      await contextB.close();
    }
  });

  test.describe("phone viewport", () => {
    test.use({ viewport: { width: 320, height: 800 }, hasTouch: true });

    test("creates, edits, and ends a known obligation without document overflow", async ({ page }) => {
      await page.goto("/upcoming?on=2026-04-01");

      await expect(page.getByTestId("upcoming-to-leave")).toHaveText("-$2,496.00", {
        timeout: 30_000,
      });
      const overlaps = page.getByTestId("upcoming-charge").filter({ hasText: "Streamflix" });
      await expect(overlaps).toHaveCount(2);
      await expect(overlaps.filter({ hasText: "Known" })).toHaveCount(1);
      await expect(overlaps.filter({ hasText: "Predicted" })).toHaveCount(1);
      const warning = "Possible overlap — both are counted until matching is available.";
      await expect(overlaps.nth(0)).toContainText(warning);
      await expect(overlaps.nth(1)).toContainText(warning);
      const calendar = page.getByTestId("upcoming-calendar");
      await expect(calendar).toBeVisible();
      expect(
        await calendar.evaluate((table) => {
          const scroller = table.parentElement;
          return scroller !== null && scroller.scrollWidth > scroller.clientWidth;
        }),
      ).toBe(true);
      expect(await documentOverflow(page)).toBeLessThanOrEqual(0);

      const management = page.getByTestId("known-obligations");
      await management.getByRole("button", { name: "Add obligation" }).click();
      const addForm = management.getByRole("form", { name: "Add obligation" });
      await addForm.getByLabel("Name").fill("Phone bill");
      await addForm.getByLabel("Account").selectOption({ label: "Everyday Checking" });
      await addForm.getByLabel("Amount").fill("45.50");
      await addForm.getByLabel("First due date").fill("2026-04-22");
      expect(await documentOverflow(page)).toBeLessThanOrEqual(0);
      await addForm.getByRole("button", { name: "Add obligation" }).click();

      const card = obligationCard(management, "Phone bill");
      await expect(card).toContainText("Next Apr 22, 2026", { timeout: 30_000 });
      await expect(page.getByTestId("upcoming-to-leave")).toHaveText("-$2,541.50");
      expect(await documentOverflow(page)).toBeLessThanOrEqual(0);

      await card.getByRole("button", { name: "Edit Phone bill" }).click();
      const editForm = card.getByRole("form", { name: "Edit Phone bill" });
      await editForm.getByLabel("Amount").fill("50.00");
      await editForm.getByLabel("First due date").fill("2026-04-23");
      await editForm.getByLabel("Repeat").selectOption("monthly");
      await editForm.getByLabel("Final date").fill("2026-06-30");
      expect(await documentOverflow(page)).toBeLessThanOrEqual(0);
      await editForm.getByRole("button", { name: "Save changes" }).click();

      await expect(card).toContainText("Monthly · starts Apr 23, 2026 · ends Jun 30, 2026", {
        timeout: 30_000,
      });
      await expect(page.getByTestId("upcoming-to-leave")).toHaveText("-$2,546.00");
      expect(await documentOverflow(page)).toBeLessThanOrEqual(0);

      await card.getByRole("button", { name: "End Phone bill" }).click();
      await expect(card.getByRole("form", { name: "End Phone bill" })).toContainText(
        "End Phone bill?",
      );
      expect(await documentOverflow(page)).toBeLessThanOrEqual(0);
      await card
        .getByRole("form", { name: "End Phone bill" })
        .getByRole("button", { name: "End obligation" })
        .click();

      await expect(card).toHaveCount(0, { timeout: 30_000 });
      await expect(page.getByTestId("upcoming-to-leave")).toHaveText("-$2,496.00");
      expect(await documentOverflow(page)).toBeLessThanOrEqual(0);
    });
  });
});
