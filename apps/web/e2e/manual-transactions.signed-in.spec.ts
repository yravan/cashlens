import fs from "node:fs";
import type { Locator, Page } from "@playwright/test";

import { SEED_ACCOUNTS, SEED_CATEGORIES, SEED_CLERK_IDS } from "../db/seed/dataset";
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

const accountId = (name: string) => SEED_ACCOUNTS.find((row) => row.name === name)!.id;
const categoryId = (name: string) =>
  SEED_CATEGORIES.find(
    (row) => row.persona === "demo" && row.name === name && row.parentId !== null,
  )!.id;
const transactionRow = (page: Page, text: string) =>
  page.getByTestId("transaction-row").filter({ hasText: text });
const form = (page: Page, name: "Add transaction" | "Edit transaction") =>
  page.getByRole("form", { name });

async function fillManualForm(
  target: Locator,
  values: {
    account: string;
    direction: "outflow" | "inflow";
    amount: string;
    date: string;
    description: string;
    merchant?: string;
    category?: string;
  },
) {
  await target.getByLabel("Account").selectOption({ label: values.account });
  await target.getByLabel("Direction").selectOption(values.direction);
  await target.getByLabel("Amount").fill(values.amount);
  await target.getByLabel("Date").fill(values.date);
  await target.getByLabel("Description").fill(values.description);
  await target.getByLabel("Merchant").fill(values.merchant ?? "");
  if (values.category) await target.getByLabel("Category").selectOption({ label: values.category });
}

async function waitForMutation(page: Page, pathname: string, status: number, action: () => Promise<void>) {
  const response = page.waitForResponse(
    (candidate) =>
      new URL(candidate.url()).pathname === pathname && candidate.request().method() === "POST",
  );
  await action();
  expect((await response).status()).toBe(status);
}

async function manualRows(
  userId: string,
  match: { id?: string; description?: string },
) {
  return adminQuery(
    `select t.id, t.account_id, a.name as account_name, t.amount_minor, t.currency,
            t.date::text, t.description, t.merchant, t.category_id, c.name as category_name,
            t.source, t.status, t.source_id
       from transactions t
       join accounts a on a.id = t.account_id and a.user_id = t.user_id
       left join categories c on c.id = t.category_id and c.user_id = t.user_id
      where t.user_id = $1
        and ($2::uuid is null or t.id = $2::uuid)
        and ($3::text is null or t.description = $3::text)
      order by t.id`,
    [userId, match.id ?? null, match.description ?? null],
  );
}

test.use({ timezoneId: "America/Los_Angeles" });

test.describe("manual transactions", () => {
  let userA: string;
  let userB: string;
  let yenAccountId: string;

  test.beforeEach(async ({ request, playwright, browser, baseURL }) => {
    expect((await request.get("/api/me")).status()).toBe(200);
    const requestB = await playwright.request.newContext({
      baseURL,
      storageState: await signedInState(browser, "b"),
    });
    expect((await requestB.get("/api/me")).status()).toBe(200);
    await requestB.dispose();

    userA = await userIdOf("a");
    userB = await userIdOf("b");
    await adminQuery("delete from accounts where user_id in ($1, $2)", [userA, userB]);
    await adminQuery("delete from categories where user_id in ($1, $2)", [userA, userB]);
    await seedLedgerFixture({ demo: userA, neighbor: userB });
    const inserted = await adminQuery(
      `insert into accounts (user_id, name, type, currency, source)
       values ($1, 'Tokyo Cash', 'other', 'JPY', 'manual') returning id`,
      [userA],
    );
    yenAccountId = inserted.rows[0].id;
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

  test("creates, atomically edits, deduplicates, deletes, and isolates the money path", async ({
    page,
    browser,
    baseURL,
  }) => {
    await page.clock.setFixedTime(new Date("2026-09-11T19:00:00.000Z"));
    await page.goto("/transactions");
    await page.getByRole("button", { name: "Add transaction" }).click();

    const add = form(page, "Add transaction");
    await expect(add.getByLabel("Date")).toHaveValue("2026-09-11");
    await fillManualForm(add, {
      account: "Everyday Checking · USD",
      direction: "outflow",
      amount: "12.34",
      date: "2026-09-11",
      description: "E2E MANUAL MARKET",
      merchant: "Manual Market",
      category: "Groceries",
    });
    await waitForMutation(page, "/api/transactions/manual", 201, () =>
      add.getByRole("button", { name: "Add transaction" }).click(),
    );

    const created = await manualRows(userA, { description: "E2E MANUAL MARKET" });
    expect(created.rows).toEqual([
      {
        id: expect.any(String),
        account_id: accountId("Everyday Checking"),
        account_name: "Everyday Checking",
        amount_minor: "-1234",
        currency: "USD",
        date: "2026-09-11",
        description: "E2E MANUAL MARKET",
        merchant: "Manual Market",
        category_id: categoryId("Groceries"),
        category_name: "Groceries",
        source: "manual",
        status: "posted",
        source_id: null,
      },
    ]);
    const transactionId = created.rows[0].id;

    const createdRow = transactionRow(page, "Manual Market");
    await createdRow.getByRole("button", { name: "Edit" }).click();
    const edit = form(page, "Edit transaction");
    await expect(edit.getByLabel("Account")).toHaveValue(accountId("Everyday Checking"));
    await expect(edit.getByLabel("Direction")).toHaveValue("outflow");
    await expect(edit.getByLabel("Amount")).toHaveValue("12.34");
    await expect(edit.getByLabel("Category").locator("option:checked")).toHaveText("Groceries");

    await fillManualForm(edit, {
      account: "Tokyo Cash · JPY",
      direction: "inflow",
      amount: "1234",
      date: "2026-09-12",
      description: "E2E MANUAL TOKYO",
      merchant: "Tokyo Manual",
      category: "Electronics",
    });
    await waitForMutation(page, `/api/transactions/${transactionId}/manual`, 200, () =>
      edit.getByRole("button", { name: "Save changes" }).click(),
    );

    const edited = await manualRows(userA, { id: transactionId });
    expect(edited.rows).toEqual([
      {
        id: transactionId,
        account_id: yenAccountId,
        account_name: "Tokyo Cash",
        amount_minor: "1234",
        currency: "JPY",
        date: "2026-09-12",
        description: "E2E MANUAL TOKYO",
        merchant: "Tokyo Manual",
        category_id: categoryId("Electronics"),
        category_name: "Electronics",
        source: "manual",
        status: "posted",
        source_id: null,
      },
    ]);

    await page.getByRole("button", { name: "Add transaction" }).click();
    const duplicateForm = form(page, "Add transaction");
    await fillManualForm(duplicateForm, {
      account: "Cash Wallet · USD",
      direction: "outflow",
      amount: "4.56",
      date: "2026-09-13",
      description: "E2E DOUBLE SUBMIT",
      category: "Groceries",
    });
    const createRequests: string[] = [];
    page.on("request", (request) => {
      if (new URL(request.url()).pathname === "/api/transactions/manual") {
        createRequests.push(request.url());
      }
    });
    await waitForMutation(page, "/api/transactions/manual", 201, () =>
      duplicateForm.getByRole("button", { name: "Add transaction" }).evaluate((button) => {
        (button as HTMLButtonElement).click();
        (button as HTMLButtonElement).click();
      }),
    );
    await expect(duplicateForm).toHaveCount(0);
    expect(createRequests).toHaveLength(1);
    const duplicate = await manualRows(userA, { description: "E2E DOUBLE SUBMIT" });
    expect(duplicate.rowCount).toBe(1);

    const duplicateRow = transactionRow(page, "E2E DOUBLE SUBMIT");
    const deleteRequests: string[] = [];
    page.on("request", (request) => {
      if (new URL(request.url()).pathname.endsWith("/manual/delete")) {
        deleteRequests.push(request.url());
      }
    });
    await duplicateRow.getByRole("button", { name: "Delete" }).click();
    await expect(duplicateRow).toContainText("Delete permanently?");
    await duplicateRow.getByRole("button", { name: "Cancel" }).click();
    await expect(duplicateRow).not.toContainText("Delete permanently?");
    expect(deleteRequests).toEqual([]);

    const duplicateId = duplicate.rows[0].id;
    await duplicateRow.getByRole("button", { name: "Delete" }).click();
    await waitForMutation(page, `/api/transactions/${duplicateId}/manual/delete`, 200, () =>
      duplicateRow.getByRole("button", { name: "Confirm" }).click(),
    );
    await expect(transactionRow(page, "E2E DOUBLE SUBMIT")).toHaveCount(0);
    expect((await manualRows(userA, { id: duplicateId })).rowCount).toBe(0);

    const contextB = await browser.newContext({
      baseURL,
      storageState: await signedInState(browser, "b"),
    });
    try {
      const pageB = await contextB.newPage();
      await pageB.goto("/transactions");
      await expect(pageB.getByText("Tokyo Manual")).toHaveCount(0);
      await expect(pageB.getByText("E2E DOUBLE SUBMIT")).toHaveCount(0);
    } finally {
      await contextB.close();
    }
  });

  test("distinguishes account and ledger emptiness while keeping Add usable", async ({ page }) => {
    await page.goto("/transactions?q=does-not-exist");
    await expect(page.getByTestId("no-match")).toContainText("No transactions match");
    await page.getByRole("button", { name: "Add transaction" }).click();
    await expect(form(page, "Add transaction")).toBeVisible();
    await form(page, "Add transaction").getByRole("button", { name: "Cancel" }).click();

    await page.goto("/transactions?from=2026-13-01");
    await expect(page.getByTestId("filter-error")).toBeVisible();
    await page.getByRole("button", { name: "Add transaction" }).click();
    await expect(form(page, "Add transaction")).toBeVisible();

    await adminQuery("delete from accounts where user_id = $1", [userA]);
    await page.goto("/transactions");
    await expect(page.getByRole("heading", { name: "An account is required" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Add transaction" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Go to accounts" })).toBeVisible();

    await adminQuery(
      `insert into accounts (user_id, name, type, currency, source)
       values ($1, 'Empty Cash', 'other', 'EUR', 'manual')`,
      [userA],
    );
    await page.reload();
    await expect(page.getByRole("heading", { name: "No transactions yet" })).toBeVisible();
    await expect(page.getByText(/add one by hand/i)).toBeVisible();
    await page.getByRole("button", { name: "Add transaction" }).click();
    await expect(form(page, "Add transaction").getByLabel("Account")).toContainText(
      "Empty Cash · EUR",
    );
  });

  test("creates and edits at 320px without horizontal overflow", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 800 });
    await page.clock.setFixedTime(new Date("2026-09-11T19:00:00.000Z"));
    await page.goto("/transactions");
    await page.getByRole("button", { name: "Add transaction" }).click();
    const add = form(page, "Add transaction");
    await fillManualForm(add, {
      account: "Cash Wallet · USD",
      direction: "outflow",
      amount: "7.89",
      date: "2026-09-11",
      description: "E2E PHONE CASH",
      merchant: "Phone Cash",
      category: "Groceries",
    });
    await waitForMutation(page, "/api/transactions/manual", 201, () =>
      add.getByRole("button", { name: "Add transaction" }).click(),
    );

    const phoneRow = transactionRow(page, "Phone Cash");
    await phoneRow.getByRole("button", { name: "Edit" }).click();
    const edit = form(page, "Edit transaction");
    await edit.getByLabel("Amount").fill("8.9");
    await edit.getByLabel("Description").fill("E2E PHONE CASH EDITED");
    const id = (await manualRows(userA, { description: "E2E PHONE CASH" })).rows[0].id;
    await waitForMutation(page, `/api/transactions/${id}/manual`, 200, () =>
      edit.getByRole("button", { name: "Save changes" }).click(),
    );
    expect((await manualRows(userA, { id })).rows[0]).toMatchObject({
      amount_minor: "-890",
      description: "E2E PHONE CASH EDITED",
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      ),
    ).toBeLessThanOrEqual(0);
  });
});
