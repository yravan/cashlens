import fs from "node:fs";
import { type Page } from "@playwright/test";

import { EXPECTED, SEED_CATEGORIES, SEED_CLERK_IDS, SEED_TRANSACTIONS } from "../db/seed/dataset";
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

const rows = (page: Page) => page.getByTestId("transaction-row");
const markers = (page: Page) => page.getByTestId("auto-category");

const SEEDED_AUTO = SEED_TRANSACTIONS.filter(
  (t) => t.persona === "demo" && t.categorySource === "auto",
).length;
const GROCERIES_ID = SEED_CATEGORIES.find(
  (c) => c.persona === "demo" && c.parentId !== null && c.name === "Groceries",
)!.id;

async function reseed(): Promise<void> {
  await seedLedgerFixture({ demo: await userIdOf("a"), neighbor: await userIdOf("b") });
}

test.describe("auto categorization", () => {
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
    await reseed();
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

  test("seeded auto picks disclose provenance; manual and legacy rows stay unmarked", async ({
    page,
  }) => {
    await page.goto("/transactions");

    const streamflix = rows(page).filter({ hasText: "Streamflix" }).getByTestId("auto-category");
    await expect(streamflix).toHaveText("Auto · low — check");
    await expect(streamflix).toHaveAttribute("title", "Could be video or music streaming");

    const coffee = rows(page).filter({ hasText: "Bean Barrel" }).getByTestId("auto-category");
    await expect(coffee).toHaveText("Auto · high");

    await expect(
      rows(page).filter({ hasText: "Maple Market" }).getByTestId("auto-category"),
    ).toHaveCount(0);
    await expect(
      rows(page).filter({ hasText: "BAHN TICKET" }).getByTestId("auto-category"),
    ).toHaveCount(0);
  });

  test("a transactions-page visit silently categorizes the whole backlog", async ({ page }) => {
    const probe = await page.request.post("/api/transactions/categorize");
    // Only a locally reused server (predating ANTHROPIC_BASE_URL) may answer 503;
    // CI always builds fresh, so there it must fail rather than skip.
    test.skip(
      !process.env.CI && probe.status() === 503,
      "the reused local server has no LLM configured — restart it",
    );
    expect(probe.status()).toBe(200);
    await reseed();
    // Pair the seeded transfers first: on a live page the match and categorize
    // triggers race, and this test pins the queue the categorizer must see.
    const match = await page.request.post("/api/transfers/match");
    expect(match.status()).toBe(200);
    expect(await match.json()).toEqual({ paired: 2, dissolved: 0 });

    await page.goto("/transactions");

    await expect(markers(page)).toHaveCount(EXPECTED.demo.transfers.autoQueue + SEEDED_AUTO, {
      timeout: 45_000,
    });
    await expect
      .poll(
        () =>
          rows(page)
            .locator("select")
            .evaluateAll(
              (selects) => selects.filter((el) => (el as HTMLSelectElement).value === "").length,
            ),
        { timeout: 45_000 },
      )
      .toBe(EXPECTED.demo.transfers.pairedRows);

    const maple = rows(page).filter({ hasText: "Maple Market" });
    await expect(maple.locator("select")).toHaveValue(GROCERIES_ID);
    await expect(maple.getByTestId("auto-category")).toHaveCount(0);
  });
});
