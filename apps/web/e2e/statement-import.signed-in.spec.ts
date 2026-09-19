import fs from "node:fs";
import path from "node:path";
import type { Page } from "@playwright/test";

import { EXPECTED, SEED_ACCOUNTS, SEED_CLERK_IDS } from "../db/seed/dataset";
import { formatMinorUnits } from "../lib/ledger/minor-units";
import { E2E_USERS_FILE } from "../playwright.config";
import { adminQuery, seedLedgerFixture } from "./db";
import { expect, test } from "./fixtures";
import { signedInContext, signedInState } from "./session";

const FIXTURE = path.join(__dirname, "statement-fixture.csv");
const WALLET_ID = SEED_ACCOUNTS.find((row) => row.name === "Cash Wallet")!.id;
const WALLET = EXPECTED.demo.overview.accounts.find((row) => row.name === "Cash Wallet")!;
const AFTER_ANCHOR_MINOR = 2000 - 1525 - 1525 - 600 + 975;
const usd = (minor: number | bigint) => formatMinorUnits(minor, "USD");

const clerkIdOf = (key: "a" | "b"): string =>
  JSON.parse(fs.readFileSync(E2E_USERS_FILE, "utf8"))[key].clerkUserId;

async function userIdOf(key: "a" | "b"): Promise<string> {
  const result = await adminQuery("select id from users where clerk_user_id = $1", [clerkIdOf(key)]);
  return result.rows[0].id;
}

const accountRow = (page: Page, name: string) =>
  page.getByTestId("account-row").filter({ hasText: name });
const transactionRow = (page: Page, text: string) =>
  page.getByTestId("transaction-row").filter({ hasText: text });

async function waitForMutation(page: Page, pathname: string, status: number, action: () => Promise<void>) {
  const response = page.waitForResponse(
    (candidate) =>
      new URL(candidate.url()).pathname === pathname && candidate.request().method() === "POST",
  );
  await action();
  expect((await response).status()).toBe(status);
}

async function uploadFixture(page: Page) {
  await accountRow(page, "Cash Wallet").getByRole("button", { name: "Import", exact: true }).click();
  const form = page.getByRole("form", { name: "Import statement" });
  await form.getByTestId("import-file").setInputFiles(FIXTURE);
  await expect(form.getByTestId("import-summary")).toHaveText(
    "6 rows · 6 can’t be read (rows 2, 3, 4, 5, 6 and 1 more)",
  );
  await expect(form.getByRole("button", { name: "Import 0 rows" })).toBeDisabled();
  await form.getByLabel("Date order").selectOption("mdy");
  await expect(form.getByTestId("import-summary")).toHaveText(
    `6 rows · 5 dated on or after ${WALLET.reportedOn} will change the balance`,
  );
  return form;
}

const reported = (since: number) =>
  `Reported ${usd(WALLET.reportedMinor!)} on ${WALLET.reportedOn} · ${since} transactions since`;

test.describe("statement import", () => {
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

  test("imports a CSV into the seeded wallet, skips a re-upload, undoes one row, and isolates", async ({
    page,
    browser,
    baseURL,
  }) => {
    await page.goto("/accounts");
    const wallet = accountRow(page, "Cash Wallet");
    await expect(wallet).toContainText(usd(WALLET.currentMinor!));
    await expect(wallet.getByTestId("reported-balance")).toHaveText(
      `Reported ${usd(WALLET.reportedMinor!)} on ${WALLET.reportedOn} · 1 transaction since`,
    );

    const form = await uploadFixture(page);
    const preview = form.getByTestId("import-preview");
    await expect(preview.locator("tbody tr")).toHaveCount(5);
    await expect(preview.locator("tbody tr").first().locator("td")).toHaveText([
      "2026-03-10",
      usd(-1250),
      "E2E FARMERS MARKET",
    ]);
    await waitForMutation(page, `/api/accounts/${WALLET_ID}/manual/import`, 200, () =>
      form.getByRole("button", { name: "Import 6 rows" }).click(),
    );
    await expect(page.getByTestId("import-result")).toHaveText(
      "Imported 6 transactions · 0 were already in the ledger",
    );
    await expect(wallet).toContainText(usd(WALLET.currentMinor! + BigInt(AFTER_ANCHOR_MINOR)));
    await expect(wallet.getByTestId("reported-balance")).toHaveText(reported(WALLET.sinceCount + 5));

    const imported = await adminQuery(
      `select id, description, amount_minor::int as amount_minor, date::text, source, source_id
         from transactions
        where user_id = $1 and account_id = $2 and source = 'import'
        order by date, description, source_id`,
      [userA, WALLET_ID],
    );
    expect(
      imported.rows.map(({ description, amount_minor, date, source }) => ({
        description,
        amount_minor,
        date,
        source,
      })),
    ).toEqual([
      { description: "E2E FARMERS MARKET", amount_minor: -1250, date: "2026-03-10", source: "import" },
      { description: "E2E BIRTHDAY CASH", amount_minor: 2000, date: "2026-03-14", source: "import" },
      { description: "E2E TAXI", amount_minor: -1525, date: "2026-03-15", source: "import" },
      { description: "E2E TAXI", amount_minor: -1525, date: "2026-03-15", source: "import" },
      { description: "E2E LAUNDRY", amount_minor: -600, date: "2026-03-20", source: "import" },
      { description: "E2E BOOK SALE, USED", amount_minor: 975, date: "2026-04-01", source: "import" },
    ]);
    expect(new Set(imported.rows.map((row) => row.source_id)).size).toBe(6);

    await page.getByRole("button", { name: "Done" }).click();
    const again = await uploadFixture(page);
    await waitForMutation(page, `/api/accounts/${WALLET_ID}/manual/import`, 200, () =>
      again.getByRole("button", { name: "Import 6 rows" }).click(),
    );
    await expect(page.getByTestId("import-result")).toHaveText(
      "Imported 0 transactions · 6 were already in the ledger",
    );
    await expect(wallet).toContainText(usd(WALLET.currentMinor! + BigInt(AFTER_ANCHOR_MINOR)));
    expect(
      (
        await adminQuery(
          "select count(*)::int as n from transactions where user_id = $1 and account_id = $2 and source = 'import'",
          [userA, WALLET_ID],
        )
      ).rows[0].n,
    ).toBe(6);

    await page.goto("/transactions");
    await expect(transactionRow(page, "E2E TAXI")).toHaveCount(2);
    const laundry = transactionRow(page, "E2E LAUNDRY");
    await expect(laundry).toContainText("import · posted");
    await expect(laundry.getByRole("button", { name: "Edit" })).toHaveCount(0);
    await laundry.getByRole("button", { name: "Delete", exact: true }).click();
    await expect(laundry).toContainText("Delete permanently?");
    const laundryId = imported.rows.find((row) => row.description === "E2E LAUNDRY")!.id;
    await waitForMutation(page, `/api/transactions/${laundryId}/manual/delete`, 200, () =>
      laundry.getByRole("button", { name: "Confirm" }).click(),
    );
    await expect(transactionRow(page, "E2E LAUNDRY")).toHaveCount(0);
    await expect(transactionRow(page, "E2E TAXI")).toHaveCount(2);

    await page.goto("/accounts");
    await expect(wallet).toContainText(usd(WALLET.currentMinor! + BigInt(AFTER_ANCHOR_MINOR + 600)));
    await expect(wallet.getByTestId("reported-balance")).toHaveText(reported(WALLET.sinceCount + 4));

    const contextB = await signedInContext(browser, "b", baseURL);
    try {
      const pageB = await contextB.newPage();
      await pageB.goto("/transactions");
      await expect(pageB.getByTestId("transaction-row")).toHaveCount(EXPECTED.neighbor.transactions);
      await expect(transactionRow(pageB, "E2E")).toHaveCount(0);
      await pageB.goto("/accounts");
      await expect(pageB.getByTestId("accounts-count")).toHaveText("1 account in the ledger");
    } finally {
      await contextB.close();
    }
  });

  test("switching from flipped amounts to explicit out/in columns preserves ledger direction", async ({ page }) => {
    await page.goto("/accounts");
    const wallet = accountRow(page, "Cash Wallet");
    await wallet.getByRole("button", { name: "Import", exact: true }).click();
    const form = page.getByRole("form", { name: "Import statement" });
    await form.getByTestId("import-file").setInputFiles({
      name: "direction.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(
        "Date,Amount,Debit,Credit,Description\n2026-03-20,12.50,12.50,,E2E DIRECTION PURCHASE\n2026-03-21,-9.75,,9.75,E2E DIRECTION REFUND\n",
      ),
    });
    await form.getByLabel("Money out is positive in this file").check();
    const amounts = form.getByTestId("import-preview").locator("tbody tr td:nth-child(2)");
    await expect(amounts).toHaveText([usd(-1250), usd(975)]);
    await form.getByLabel("Amount columns").selectOption("split");
    await expect(amounts).toHaveText([usd(-1250), usd(975)]);
    await expect(form.getByLabel("Money out is positive in this file")).toHaveCount(0);
    await waitForMutation(page, `/api/accounts/${WALLET_ID}/manual/import`, 200, () =>
      form.getByRole("button", { name: "Import 2 rows" }).click(),
    );
    await expect(page.getByTestId("import-result")).toHaveText(
      "Imported 2 transactions · 0 were already in the ledger",
    );
    await expect(wallet).toContainText(usd(WALLET.currentMinor! - BigInt(1250) + BigInt(975)));
    const saved = await adminQuery(
      "select amount_minor::int as amount from transactions where user_id = $1 and account_id = $2 and source = 'import' order by date",
      [userA, WALLET_ID],
    );
    expect(saved.rows).toEqual([{ amount: -1250 }, { amount: 975 }]);
  });

  test("imports at 320px without horizontal overflow", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 800 });
    await page.goto("/accounts");
    const overflow = () =>
      page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
    const form = await uploadFixture(page);
    await expect(form.getByTestId("import-preview").locator("tbody tr")).toHaveCount(5);
    expect(await overflow()).toBeLessThanOrEqual(0);
    await waitForMutation(page, `/api/accounts/${WALLET_ID}/manual/import`, 200, () =>
      form.getByRole("button", { name: "Import 6 rows" }).click(),
    );
    await expect(page.getByTestId("import-result")).toHaveText(
      "Imported 6 transactions · 0 were already in the ledger",
    );
    await expect(accountRow(page, "Cash Wallet")).toContainText(
      usd(WALLET.currentMinor! + BigInt(AFTER_ANCHOR_MINOR)),
    );
    expect(await overflow()).toBeLessThanOrEqual(0);
  });

  test("an oversized CSV explains complete-date recovery", async ({ page }) => {
    await page.goto("/accounts");
    await accountRow(page, "Cash Wallet").getByRole("button", { name: "Import", exact: true }).click();
    const form = page.getByRole("form", { name: "Import statement" });
    await form.getByTestId("import-file").setInputFiles({
      name: "oversized.csv",
      mimeType: "text/csv",
      buffer: Buffer.alloc(1024 * 1024 + 1, 120),
    });
    await expect(form.getByRole("alert")).toHaveText(
      "That file is too large to import in one go. Split it into files by complete dates, keeping every row for a date together. A single date over the limit cannot be imported yet; do not split that date across files.",
    );
  });
});
