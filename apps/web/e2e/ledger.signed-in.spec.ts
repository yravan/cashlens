import fs from "node:fs";
import { expect, test, type Page } from "@playwright/test";

import { EXPECTED, SEED_USERS } from "../db/seed/dataset";
import { E2E_USERS_FILE, STORAGE_STATE_B } from "../playwright.config";
import { adminQuery, appQuery, appQueryScopedAs, seedLedgerFixture } from "./db";

const PROBE_A = "ledger_rls_probe_a";
const PROBE_B = "ledger_rls_probe_b";

const INSERT_TXN = `insert into transactions
  (user_id, account_id, amount_minor, currency, date, description, merchant, status, source, source_id)
  values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) returning id`;

async function insertAccount(
  userId: string,
  name: string,
  sourceId: string | null,
): Promise<string> {
  const result = await adminQuery(
    `insert into accounts (user_id, name, type, subtype, mask, currency, source, source_id)
     values ($1, $2, 'depository', 'checking', '0001', 'USD', $3, $4) returning id`,
    [userId, name, sourceId ? "plaid" : "manual", sourceId],
  );
  return result.rows[0].id;
}

function insertBalance(
  accountId: string,
  userId: string,
  available: number | null,
  current: number,
) {
  return adminQuery(
    `insert into account_balances (account_id, user_id, available_minor, current_minor, as_of)
     values ($1, $2, $3, $4, '2026-01-02T03:04:05Z')`,
    [accountId, userId, available, current],
  );
}

test.describe("ledger row-level security backstop", () => {
  let a: { userId: string; accountId: string };
  let b: { userId: string; accountId: string };

  async function seedProbe(clerkId: string, name: string, sourceId: string) {
    const user = await adminQuery(
      "insert into users (clerk_user_id) values ($1) returning id",
      [clerkId],
    );
    const userId = user.rows[0].id;
    return { userId, accountId: await insertAccount(userId, name, sourceId) };
  }

  test.beforeAll(async () => {
    await adminQuery("delete from users where clerk_user_id in ($1, $2)", [
      PROBE_A,
      PROBE_B,
    ]);
    a = await seedProbe(PROBE_A, "Probe Checking", "probe-acct-a");
    b = await seedProbe(PROBE_B, "Probe Savings", "probe-acct-b");

    await insertBalance(a.accountId, a.userId, 105000, 123456);
    await insertBalance(b.accountId, b.userId, null, 999999);

    await adminQuery(INSERT_TXN, [
      a.userId, a.accountId, -1234, "USD", "2026-01-15",
      "COFFEE SHOP #42", "Coffee Shop", "posted", "plaid", "probe-txn-a1",
    ]);
    await adminQuery(INSERT_TXN, [
      a.userId, a.accountId, 250000, "USD", "2026-01-16",
      "ACME PAYROLL", "Acme", "posted", "plaid", "probe-txn-a2",
    ]);
    await adminQuery(INSERT_TXN, [
      b.userId, b.accountId, -4321, "USD", "2026-01-17",
      "HOTEL HOLD", null, "pending", "plaid", "probe-txn-b1",
    ]);
  });

  test.afterAll(async () => {
    await adminQuery("delete from users where clerk_user_id in ($1, $2)", [
      PROBE_A,
      PROBE_B,
    ]);
  });

  test("a scoped ledger query sees only the scoped user's rows", async () => {
    const accounts = await appQueryScopedAs(
      PROBE_A,
      "select name, type, subtype, mask, currency, source, source_id from accounts",
    );
    expect(accounts.rows).toEqual([
      {
        name: "Probe Checking",
        type: "depository",
        subtype: "checking",
        mask: "0001",
        currency: "USD",
        source: "plaid",
        source_id: "probe-acct-a",
      },
    ]);

    const transactions = await appQueryScopedAs(
      PROBE_A,
      `select amount_minor, currency, date::text as date, description, merchant, status, source, source_id
       from transactions order by date`,
    );
    expect(transactions.rows).toEqual([
      {
        amount_minor: "-1234",
        currency: "USD",
        date: "2026-01-15",
        description: "COFFEE SHOP #42",
        merchant: "Coffee Shop",
        status: "posted",
        source: "plaid",
        source_id: "probe-txn-a1",
      },
      {
        amount_minor: "250000",
        currency: "USD",
        date: "2026-01-16",
        description: "ACME PAYROLL",
        merchant: "Acme",
        status: "posted",
        source: "plaid",
        source_id: "probe-txn-a2",
      },
    ]);

    const balances = await appQueryScopedAs(
      PROBE_A,
      "select available_minor, current_minor, limit_minor from account_balances",
    );
    expect(balances.rows).toEqual([
      { available_minor: "105000", current_minor: "123456", limit_minor: null },
    ]);
  });

  test("an unscoped app connection sees zero ledger rows", async () => {
    for (const table of ["accounts", "transactions", "account_balances"]) {
      const rows = await appQuery(`select * from ${table}`);
      expect(rows.rowCount).toBe(0);
    }
  });

  test("the app role can insert its own rows but never another user's", async () => {
    const own = await appQueryScopedAs(
      PROBE_A,
      `insert into accounts (user_id, name, type, currency, source)
       values ($1, 'Own Manual', 'depository', 'USD', 'manual') returning id`,
      [a.userId],
    );
    expect(own.rowCount).toBe(1);

    await expect(
      appQueryScopedAs(
        PROBE_A,
        `insert into accounts (user_id, name, type, currency, source)
         values ($1, 'Forged Owner', 'depository', 'USD', 'manual')`,
        [b.userId],
      ),
    ).rejects.toMatchObject({ code: "42501" });
  });

  test("a transaction can never reference another user's account", async () => {
    const own = await appQueryScopedAs(
      PROBE_A,
      INSERT_TXN,
      [a.userId, a.accountId, -500, "USD", "2026-01-20",
       "OWN SPEND", null, "posted", "manual", null],
    );
    expect(own.rowCount).toBe(1);

    await expect(
      appQueryScopedAs(
        PROBE_A,
        INSERT_TXN,
        [a.userId, b.accountId, -500, "USD", "2026-01-20",
         "FORGED REF", null, "posted", "manual", null],
      ),
    ).rejects.toMatchObject({ code: "23503" });
  });

  test("one source row lands exactly once per account", async () => {
    await expect(
      appQueryScopedAs(
        PROBE_A,
        INSERT_TXN,
        [a.userId, a.accountId, -1234, "USD", "2026-01-15",
         "COFFEE SHOP #42", "Coffee Shop", "posted", "plaid", "probe-txn-a1"],
      ),
    ).rejects.toMatchObject({ code: "23505" });
  });

  test("currency must be an uppercase ISO 4217 code", async () => {
    await expect(
      appQueryScopedAs(
        PROBE_A,
        `insert into accounts (user_id, name, type, currency, source)
         values ($1, 'Bad Currency', 'depository', 'usd', 'manual')`,
        [a.userId],
      ),
    ).rejects.toMatchObject({ code: "23514" });
  });

  test("the app role has no update or delete path on ledger rows", async () => {
    for (const statement of [
      "update accounts set name = 'overwritten'",
      "delete from accounts",
      "update transactions set amount_minor = 0",
      "delete from transactions",
      "update account_balances set current_minor = 0",
      "delete from account_balances",
    ]) {
      await expect(
        appQueryScopedAs(PROBE_A, statement),
      ).rejects.toMatchObject({ code: "42501" });
    }
  });

  test("deleting a user cascades through accounts, balances, and transactions", async () => {
    await adminQuery("delete from users where clerk_user_id = $1", [PROBE_A]);
    const leftovers = await adminQuery(
      `select (select count(*)::int from accounts where user_id = $1)
            + (select count(*)::int from transactions where user_id = $1)
            + (select count(*)::int from account_balances where user_id = $1) as n`,
      [a.userId],
    );
    expect(leftovers.rows[0].n).toBe(0);
  });
});

test.describe("ledger read seam", () => {
  function clerkIdOf(key: "a" | "b"): string {
    return JSON.parse(fs.readFileSync(E2E_USERS_FILE, "utf8"))[key].clerkUserId;
  }

  async function userIdOf(key: "a" | "b"): Promise<string> {
    const result = await adminQuery(
      "select id from users where clerk_user_id = $1",
      [clerkIdOf(key)],
    );
    return result.rows[0].id;
  }

  async function expectCounts(page: Page, accounts: string, transactions: string) {
    await page.goto("/accounts");
    await expect(page.getByTestId("accounts-count")).toHaveText(accounts);
    await page.goto("/transactions");
    await expect(page.getByTestId("transactions-count")).toHaveText(transactions);
  }

  function inLedger(n: number, noun: string): string {
    return `${n} ${noun}${n === 1 ? "" : "s"} in the ledger`;
  }

  test.afterAll(async () => {
    await adminQuery(
      "delete from accounts where user_id in (select id from users where clerk_user_id in ($1, $2))",
      [clerkIdOf("a"), clerkIdOf("b")],
    );
    await adminQuery("delete from users where clerk_user_id = any($1)", [
      Object.values(SEED_USERS).map((user) => user.clerkUserId),
    ]);
  });

  test("pages show an empty ledger as zero counts", async ({ page, request }) => {
    await request.get("/api/me");
    await adminQuery(
      "delete from accounts where user_id = (select id from users where clerk_user_id = $1)",
      [clerkIdOf("a")],
    );

    await expectCounts(page, "0 accounts in the ledger", "0 transactions in the ledger");
  });

  test("pages count exactly the signed-in user's ledger, not anyone else's", async ({
    page,
    request,
    playwright,
    browser,
    baseURL,
  }) => {
    await request.get("/api/me");
    const requestB = await playwright.request.newContext({
      baseURL,
      storageState: STORAGE_STATE_B,
    });
    await requestB.get("/api/me");
    await requestB.dispose();

    const userA = await userIdOf("a");
    const userB = await userIdOf("b");

    await adminQuery("delete from accounts where user_id in ($1, $2)", [
      userA,
      userB,
    ]);
    await seedLedgerFixture({ demo: userA, neighbor: userB });

    await expectCounts(
      page,
      inLedger(EXPECTED.demo.accounts, "account"),
      inLedger(EXPECTED.demo.transactions, "transaction"),
    );

    const contextB = await browser.newContext({
      baseURL,
      storageState: STORAGE_STATE_B,
    });
    try {
      const pageB = await contextB.newPage();
      await expectCounts(
        pageB,
        inLedger(EXPECTED.neighbor.accounts, "account"),
        inLedger(EXPECTED.neighbor.transactions, "transaction"),
      );
    } finally {
      await contextB.close();
    }
  });
});
