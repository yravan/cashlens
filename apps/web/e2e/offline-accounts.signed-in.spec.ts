import fs from "node:fs";
import type { Page } from "@playwright/test";

import { EXPECTED, SEED_CLERK_IDS } from "../db/seed/dataset";
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

const accountRow = (page: Page, name: string) =>
  page.getByTestId("account-row").filter({ hasText: name });

async function waitForMutation(page: Page, pathname: string, status: number, action: () => Promise<void>) {
  const response = page.waitForResponse(
    (candidate) =>
      new URL(candidate.url()).pathname === pathname && candidate.request().method() === "POST",
  );
  await action();
  expect((await response).status()).toBe(status);
}

async function offlineAccount(userId: string, name: string) {
  return adminQuery(
    `select a.id, a.type, a.currency, a.source, b.current_minor, b.reported_on::text,
            (select count(*)::int from transactions t
              where t.account_id = a.id and t.user_id = a.user_id) as transactions
       from accounts a
       left join account_balances b on b.account_id = a.id
      where a.user_id = $1 and a.name = $2`,
    [userId, name],
  );
}

const SEED_CASH = EXPECTED.demo.overview.cashOnHand.USD;
const SEED_OWED = EXPECTED.demo.overview.creditOwed.USD;
const usd = (minor: number) => formatMinorUnits(minor, "USD");

test.use({ timezoneId: "America/Los_Angeles" });

test.describe("offline accounts", () => {
  let userA: string;
  let userB: string;

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

  test("anchors, moves with a cash transaction, re-anchors, deletes, and isolates", async ({
    page,
    browser,
    baseURL,
  }) => {
    await page.clock.setFixedTime(new Date("2026-09-11T19:00:00.000Z"));
    await page.goto("/accounts");
    await expect(page.getByTestId("accounts-count")).toHaveText("5 accounts in the ledger");
    await page.getByTestId("add-offline-account").click();
    const add = page.getByRole("form", { name: "Add offline account" });
    await add.getByLabel("Name").fill("Petty Cash");
    await add.getByLabel("Type").selectOption({ label: "Cash" });
    await add.getByLabel("Currency").selectOption("USD");
    await add.getByLabel("Current balance").fill("100.00");
    await waitForMutation(page, "/api/accounts/manual", 201, () =>
      add.getByRole("button", { name: "Add account" }).click(),
    );

    const created = await offlineAccount(userA, "Petty Cash");
    expect(created.rows).toEqual([
      {
        id: expect.any(String),
        type: "depository",
        currency: "USD",
        source: "manual",
        current_minor: "10000",
        reported_on: "2026-09-11",
        transactions: 0,
      },
    ]);
    const accountId = created.rows[0].id;
    await expect(page.getByTestId("accounts-count")).toHaveText("6 accounts in the ledger");
    await expect(page.getByTestId("account-group-depository")).toContainText("Petty Cash");
    await expect(accountRow(page, "Petty Cash")).toContainText(usd(10000));
    await expect(accountRow(page, "Petty Cash").getByTestId("reported-balance")).toHaveText(
      `Reported ${usd(10000)} on 2026-09-11`,
    );
    await expect(page.getByTestId("cash-on-hand-USD")).toHaveText(usd(SEED_CASH + 10000));

    await page.goto("/transactions");
    await page.getByRole("button", { name: "Add transaction" }).click();
    const form = page.getByRole("form", { name: "Add transaction" });
    await form.getByLabel("Account").selectOption({ label: "Petty Cash · USD" });
    await form.getByLabel("Direction").selectOption("outflow");
    await form.getByLabel("Amount").fill("25.00");
    await form.getByLabel("Date").fill("2026-09-11");
    await form.getByLabel("Description").fill("E2E PETTY COFFEE");
    await waitForMutation(page, "/api/transactions/manual", 201, () =>
      form.getByRole("button", { name: "Add transaction" }).click(),
    );

    await page.goto("/accounts");
    await expect(accountRow(page, "Petty Cash")).toContainText(usd(7500));
    await expect(accountRow(page, "Petty Cash").getByTestId("reported-balance")).toHaveText(
      `Reported ${usd(10000)} on 2026-09-11 · 1 transaction since`,
    );
    await expect(page.getByTestId("cash-on-hand-USD")).toHaveText(usd(SEED_CASH + 7500));

    await accountRow(page, "Petty Cash").getByRole("button", { name: "Update balance" }).click();
    const update = page.getByRole("form", { name: "Update balance" });
    await expect(update.getByLabel("Current balance")).toHaveValue("100");
    await update.getByLabel("Current balance").fill("80.00");
    await waitForMutation(page, `/api/accounts/${accountId}/manual`, 200, () =>
      update.getByRole("button", { name: "Save balance" }).click(),
    );
    await expect(accountRow(page, "Petty Cash")).toContainText(usd(8000));
    await expect(accountRow(page, "Petty Cash").getByTestId("reported-balance")).toHaveText(
      `Reported ${usd(8000)} on 2026-09-11`,
    );
    await expect(page.getByTestId("cash-on-hand-USD")).toHaveText(usd(SEED_CASH + 8000));

    const contextB = await browser.newContext({
      baseURL,
      storageState: await signedInState(browser, "b"),
    });
    try {
      const pageB = await contextB.newPage();
      await pageB.goto("/accounts");
      await expect(pageB.getByTestId("accounts-count")).toHaveText("1 account in the ledger");
      await expect(pageB.getByText("Petty Cash")).toHaveCount(0);
      await expect(pageB.getByTestId("cash-on-hand-USD")).toHaveText(
        usd(EXPECTED.neighbor.overview.cashOnHand.USD),
      );
    } finally {
      await contextB.close();
    }

    await accountRow(page, "Petty Cash").getByRole("button", { name: "Delete", exact: true }).click();
    const confirm = page.getByTestId("delete-account-confirm");
    await expect(confirm).toContainText(
      "Delete Petty Cash and its 1 transaction? This cannot be undone.",
    );
    await confirm.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByTestId("delete-account-confirm")).toHaveCount(0);
    await accountRow(page, "Petty Cash").getByRole("button", { name: "Delete", exact: true }).click();
    await waitForMutation(page, `/api/accounts/${accountId}/manual/delete`, 200, () =>
      page
        .getByTestId("delete-account-confirm")
        .getByRole("button", { name: "Delete account" })
        .click(),
    );
    await expect(accountRow(page, "Petty Cash")).toHaveCount(0);
    await expect(page.getByTestId("accounts-count")).toHaveText("5 accounts in the ledger");
    await expect(page.getByTestId("cash-on-hand-USD")).toHaveText(usd(SEED_CASH));
    expect((await offlineAccount(userA, "Petty Cash")).rowCount).toBe(0);
    expect(
      (
        await adminQuery(
          "select count(*)::int as n from transactions where user_id = $1 and description = 'E2E PETTY COFFEE'",
          [userA],
        )
      ).rows[0].n,
    ).toBe(0);
    await expect(page.getByTestId("account-group-other")).toContainText("Cash Wallet");
    await expect(
      accountRow(page, "Cash Rewards Card").getByRole("button", { name: "Update balance" }),
    ).toHaveCount(0);
  });

  test("adds an owed account and re-anchors at 320px without horizontal overflow", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 800 });
    await page.clock.setFixedTime(new Date("2026-09-11T19:00:00.000Z"));
    await page.goto("/accounts");
    await page.getByTestId("add-offline-account").click();
    const add = page.getByRole("form", { name: "Add offline account" });
    await add.getByLabel("Name").fill("Store Card");
    await add.getByLabel("Type").selectOption({ label: "Credit card" });
    await add.getByLabel("Amount owed").fill("40");
    await waitForMutation(page, "/api/accounts/manual", 201, () =>
      add.getByRole("button", { name: "Add account" }).click(),
    );
    await expect(page.getByTestId("credit-owed-USD")).toHaveText(usd(SEED_OWED + 4000));

    await accountRow(page, "Store Card").getByRole("button", { name: "Update balance" }).click();
    const update = page.getByRole("form", { name: "Update balance" });
    await update.getByLabel("Amount owed").fill("-5");
    const id = (await offlineAccount(userA, "Store Card")).rows[0].id;
    await waitForMutation(page, `/api/accounts/${id}/manual`, 200, () =>
      update.getByRole("button", { name: "Save balance" }).click(),
    );
    await expect(page.getByTestId("credit-owed-USD")).toHaveText(usd(SEED_OWED - 500));
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      ),
    ).toBeLessThanOrEqual(0);
  });
});
