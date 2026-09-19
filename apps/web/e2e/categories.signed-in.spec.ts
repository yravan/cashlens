import fs from "node:fs";
import { expect, test, type Locator, type Page } from "@playwright/test";

import { EXPECTED, SEED_CATEGORIES, SEED_CLERK_IDS, SEED_TRANSACTIONS } from "../db/seed/dataset";
import { DEFAULT_CATEGORIES } from "../lib/ledger/default-categories";
import { formatMinorUnits } from "../lib/ledger/minor-units";
import { E2E_USERS_FILE } from "../playwright.config";
import { adminQuery, seedLedgerFixture } from "./db";
import { signedInContext, signedInState } from "./session";

const clerkIdOf = (key: "a" | "b"): string =>
  JSON.parse(fs.readFileSync(E2E_USERS_FILE, "utf8"))[key].clerkUserId;

async function userIdOf(key: "a" | "b"): Promise<string> {
  const result = await adminQuery("select id from users where clerk_user_id = $1", [clerkIdOf(key)]);
  return result.rows[0].id;
}

const row = (page: Page, description: string) =>
  page.getByTestId("transaction-row").filter({ hasText: description });

test.afterAll(async () => {
  await adminQuery(
    `delete from accounts where user_id in (select id from users where clerk_user_id in ($1, $2))`,
    [clerkIdOf("a"), clerkIdOf("b")],
  );
  await adminQuery(
    `delete from categories where user_id in (select id from users where clerk_user_id in ($1, $2))`,
    [clerkIdOf("a"), clerkIdOf("b")],
  );
  await adminQuery("delete from users where clerk_user_id = any($1)", [SEED_CLERK_IDS]);
});

test.describe("category assignment", () => {
  test("assigning a category from the transactions page persists, scoped to the signed-in user", async ({
    page,
    request,
    playwright,
    browser,
    baseURL,
  }) => {
    // Provision both users before seeding onto them. Storage-state contexts can go
    // stale mid-suite (see plaid.signed-in.spec.ts), and an unasserted 307 here only
    // resurfaces as a missing row further down.
    expect((await request.get("/api/me")).status()).toBe(200);
    const requestB = await playwright.request.newContext({ baseURL, storageState: await signedInState(browser, "b") });
    expect((await requestB.get("/api/me")).status()).toBe(200);
    await requestB.dispose();

    const userA = await userIdOf("a");
    const userB = await userIdOf("b");
    await adminQuery("delete from accounts where user_id in ($1, $2)", [userA, userB]);
    await adminQuery("delete from categories where user_id in ($1, $2)", [userA, userB]);
    await seedLedgerFixture({ demo: userA, neighbor: userB });

    await page.goto("/transactions");
    await expect(page.getByTestId("transactions-count")).toHaveText(
      `${SEED_TRANSACTIONS.filter((t) => t.persona === "demo").length} transactions in the ledger`,
    );

    const streamflix = row(page, "STREAMFLIX")
      .filter({ hasText: "2026-03-29" })
      .getByRole("combobox");
    await expect(streamflix).toHaveCount(1);
    await expect(streamflix.locator("option:checked")).toHaveText("Streaming & Music");

    // The page's machine triggers (transfer match refresh + llm-stub categorize)
    // may repaint this row auto-categorized at any moment; the manual pick below
    // must win either order, so no precondition on the starting value.
    const farmers = row(page, "FARMERS MARKET CASH").getByRole("combobox");
    await expect(farmers).toHaveCount(1);
    const saved = page.waitForResponse(
      (response) =>
        response.url().includes("/api/transactions/") &&
        response.url().endsWith("/category") &&
        response.status() === 200,
    );
    await farmers.selectOption({ label: "Groceries" });
    await saved;

    await page.reload();
    await expect(
      row(page, "FARMERS MARKET CASH").getByRole("combobox").locator("option:checked"),
    ).toHaveText("Groceries");

    const groceriesValueA = await row(page, "FARMERS MARKET CASH")
      .getByRole("combobox")
      .locator("option", { hasText: "Groceries" })
      .getAttribute("value");

    const contextB = await signedInContext(browser, "b", baseURL);
    try {
      const pageB = await contextB.newPage();
      await pageB.goto("/transactions");
      await expect(pageB.getByTestId("transactions-count")).toHaveText(
        "2 transactions in the ledger",
      );
      await expect(pageB.getByText("STREAMFLIX")).toHaveCount(0);
      await expect(
        row(pageB, "ELECTRONICS EMPORIUM").getByRole("combobox").locator("option:checked"),
      ).toHaveText("Electronics");

      const groceriesValueB = await row(pageB, "ELECTRONICS EMPORIUM")
        .getByRole("combobox")
        .locator("option", { hasText: "Groceries" })
        .getAttribute("value");
      expect(groceriesValueB).not.toBe(groceriesValueA);
    } finally {
      await contextB.close();
    }
  });

  test("a leaf promoted to a group keeps showing on the rows assigned to it", async ({ page }) => {
    await page.goto("/transactions");
    await expect(page.getByTestId("signed-in-email")).toBeVisible();
    const userA = await userIdOf("a");
    const userB = await userIdOf("b");
    await adminQuery("delete from accounts where user_id in ($1, $2)", [userA, userB]);
    await adminQuery("delete from categories where user_id in ($1, $2)", [userA, userB]);
    await seedLedgerFixture({ demo: userA, neighbor: userB });
    const groceries: string = (
      await adminQuery("select id from categories where user_id = $1 and name = 'Groceries'", [userA])
    ).rows[0].id;

    const promoted = await page.request.post(`/api/categories/${groceries}`, {
      data: { name: "Groceries", parentId: null, retired: false },
    });
    expect(promoted.status()).toBe(200);

    await page.goto("/transactions");
    const maple = row(page, "Maple Market").getByRole("combobox");
    await expect(maple).toHaveCount(1);
    await expect(maple.locator("option:checked")).toHaveText("Groceries");
    await expect(maple).toHaveValue(groceries);
    await expect(maple.locator("optgroup option", { hasText: "Groceries" })).toHaveCount(0);
  });
});

const groupSection = (page: Page, name: string) =>
  page
    .getByTestId("category-group")
    .filter({ has: page.getByRole("heading", { level: 2, name, exact: true }) });

const leafRow = (group: Locator, name: string) =>
  group.getByTestId("category-row").filter({ has: group.page().getByText(name, { exact: true }) });

const demoLeafId = (name: string) =>
  SEED_CATEGORIES.find((c) => c.persona === "demo" && c.name === name && c.parentId !== null)!.id;

const signed = (minor: number, currency: string) =>
  `${minor > 0 ? "+" : ""}${formatMinorUnits(minor, currency)}`;

async function categoryOf(userId: string, name: string) {
  const result = await adminQuery(
    "select id, parent_id, sort_order from categories where user_id = $1 and name = $2",
    [userId, name],
  );
  return result.rows as { id: string; parent_id: string | null; sort_order: number }[];
}

async function waitForMutation(
  page: Page,
  pathname: string,
  status: number,
  action: () => Promise<void>,
) {
  const response = page.waitForResponse(
    (candidate) =>
      new URL(candidate.url()).pathname === pathname && candidate.request().method() === "POST",
  );
  await action();
  expect((await response).status()).toBe(status);
}

test.describe("taxonomy editing", () => {
  let userA: string;
  let userB: string;

  test.beforeEach(async ({ page, playwright, browser, baseURL }) => {
    await page.goto("/transactions");
    await expect(page.getByTestId("signed-in-email")).toBeVisible();
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

  test("names each category action for the row or group it changes", async ({ page }) => {
    await page.goto("/categories");

    await expect(
      page.getByRole("button", { name: "Rename Food & Drink", exact: true }),
    ).toHaveText("Rename");
    await expect(
      page.getByRole("button", { name: "Rename Groceries", exact: true }),
    ).toHaveText("Rename");
    await expect(
      page.getByRole("button", { name: "Move Groceries", exact: true }),
    ).toHaveText("Move");
    await expect(
      page.getByRole("button", { name: "Add category to Food & Drink", exact: true }),
    ).toHaveText("Add category");
  });

  test("drops a move form parent when another move makes that group invalid", async ({ page }) => {
    await page.goto("/categories");
    await page.getByRole("button", { name: "Add group", exact: true }).click();
    const addGroup = page.getByRole("form", { name: "Add group" });
    await addGroup.getByLabel("Name").fill("Temporary");
    await waitForMutation(page, "/api/categories", 201, () =>
      addGroup.getByRole("button", { name: "Add group" }).click(),
    );

    const food = groupSection(page, "Food & Drink");
    const groceries = leafRow(food, "Groceries");
    await groceries.getByRole("button", { name: "Move Groceries", exact: true }).click();
    const groceriesMove = groceries.getByRole("form", { name: "Move category" });
    await groceriesMove.getByLabel("Group").selectOption({ label: "Temporary" });

    const temporary = groupSection(page, "Temporary");
    const temporaryId = (await categoryOf(userA, "Temporary"))[0].id;
    await temporary.getByRole("button", { name: "Move Temporary", exact: true }).click();
    const temporaryMove = temporary.getByRole("form", { name: "Move category" });
    await temporaryMove.getByLabel("Group").selectOption({ label: "Food & Drink" });
    await waitForMutation(page, `/api/categories/${temporaryId}`, 200, () =>
      temporaryMove.getByRole("button", { name: "Move category" }).click(),
    );

    await expect(groceriesMove.getByLabel("Group")).toHaveValue("");
    const groceriesId = demoLeafId("Groceries");
    await waitForMutation(page, `/api/categories/${groceriesId}`, 200, () =>
      groceriesMove.getByRole("button", { name: "Move category" }).click(),
    );
    expect((await categoryOf(userA, "Groceries"))[0].parent_id).toBeNull();
  });

  test("discards an abandoned add-category draft when reopened", async ({ page }) => {
    await page.goto("/categories");
    const food = groupSection(page, "Food & Drink");
    const open = food.getByRole("button", {
      name: "Add category to Food & Drink",
      exact: true,
    });

    await open.click();
    const addCategory = food.getByRole("form", { name: "Add category" });
    await addCategory.getByLabel("Name").fill("Abandoned draft");
    await addCategory.getByRole("button", { name: "Cancel" }).click();
    await open.click();

    await expect(addCategory.getByLabel("Name")).toHaveValue("");
  });

  test("adds, renames, and moves categories on /categories, reflected in Spending and the filter, scoped to the signed-in user", async ({
    page,
    browser,
    baseURL,
  }) => {
    await page.goto("/categories");
    await expect(page.getByTestId("category-group")).toHaveCount(DEFAULT_CATEGORIES.length);
    const food = groupSection(page, "Food & Drink");
    await expect(food.getByTestId("category-row")).toHaveCount(
      DEFAULT_CATEGORIES.find((entry) => entry.group === "Food & Drink")!.categories.length,
    );

    await page.getByRole("button", { name: "Add group" }).click();
    const addGroup = page.getByRole("form", { name: "Add group" });
    await addGroup.getByLabel("Name").fill("   ");
    await waitForMutation(page, "/api/categories", 400, () =>
      addGroup.getByRole("button", { name: "Add group" }).click(),
    );
    await expect(addGroup.getByRole("alert")).toHaveText("Enter a name of 1 to 60 characters.");

    await addGroup.getByLabel("Name").fill("  Pets  ");
    await waitForMutation(page, "/api/categories", 201, () =>
      addGroup.getByRole("button", { name: "Add group" }).click(),
    );
    const pets = groupSection(page, "Pets");
    await expect(pets.getByTestId("category-row")).toHaveCount(0);
    expect(await categoryOf(userA, "Pets")).toEqual([
      { id: expect.any(String), parent_id: null, sort_order: DEFAULT_CATEGORIES.length },
    ]);
    const petsId = (await categoryOf(userA, "Pets"))[0].id;

    await pets.getByRole("button", { name: "Add category" }).click();
    const addLeaf = pets.getByRole("form", { name: "Add category" });
    await addLeaf.getByLabel("Name").fill("Vet");
    await waitForMutation(page, "/api/categories", 201, () =>
      addLeaf.getByRole("button", { name: "Add category" }).click(),
    );
    await expect(leafRow(pets, "Vet")).toHaveCount(1);
    expect(await categoryOf(userA, "Vet")).toEqual([
      { id: expect.any(String), parent_id: petsId, sort_order: 0 },
    ]);
    const vetId = (await categoryOf(userA, "Vet"))[0].id;

    await pets.getByRole("button", { name: "Add category" }).click();
    const duplicate = pets.getByRole("form", { name: "Add category" });
    await duplicate.getByLabel("Name").fill("Vet");
    await waitForMutation(page, "/api/categories", 409, () =>
      duplicate.getByRole("button", { name: "Add category" }).click(),
    );
    await expect(duplicate.getByRole("alert")).toHaveText(
      "That name is already used here — it may belong to a retired category.",
    );
    await duplicate.getByRole("button", { name: "Cancel" }).click();
    await expect(pets.getByRole("form", { name: "Add category" })).toHaveCount(0);
    await expect(leafRow(pets, "Vet")).toHaveCount(1);

    const groceriesId = demoLeafId("Groceries");
    await leafRow(food, "Groceries").getByRole("button", { name: "Rename" }).click();
    await expect(food.getByRole("form", { name: "Rename category" }).getByLabel("Name")).toHaveValue(
      "Groceries",
    );
    await food.getByRole("form", { name: "Rename category" }).getByRole("button", { name: "Cancel" }).click();
    await expect(food.getByRole("form", { name: "Rename category" })).toHaveCount(0);
    await expect(leafRow(food, "Groceries").getByRole("button", { name: "Rename" })).toBeFocused();

    await leafRow(food, "Groceries").getByRole("button", { name: "Rename" }).click();
    const rename = food.getByRole("form", { name: "Rename category" });
    await rename.getByLabel("Name").fill("Food shopping");
    await waitForMutation(page, `/api/categories/${groceriesId}`, 200, () =>
      rename.getByRole("button", { name: "Save name" }).click(),
    );
    await expect(leafRow(food, "Food shopping")).toHaveCount(1);
    await expect(leafRow(food, "Groceries")).toHaveCount(0);
    await expect(leafRow(food, "Food shopping").getByRole("button", { name: "Rename" })).toBeFocused();

    await leafRow(food, "Food shopping").getByRole("button", { name: "Move" }).click();
    const move = food.getByRole("form", { name: "Move category" });
    await expect(move.getByLabel("Group").locator("option:checked")).toHaveText("Food & Drink");
    await move.getByLabel("Group").selectOption({ label: "Pets" });
    await waitForMutation(page, `/api/categories/${groceriesId}`, 200, () =>
      move.getByRole("button", { name: "Move category" }).click(),
    );
    await expect(leafRow(pets, "Food shopping")).toHaveCount(1);
    await expect(leafRow(food, "Food shopping")).toHaveCount(0);
    expect((await categoryOf(userA, "Food shopping"))[0].parent_id).toBe(petsId);

    await expect(pets.getByTestId("group-row").getByRole("button", { name: "Move" })).toHaveCount(0);
    await leafRow(pets, "Vet").getByRole("button", { name: "Move" }).click();
    const promote = pets.getByRole("form", { name: "Move category" });
    await promote.getByLabel("Group").selectOption({ label: "Top level" });
    await waitForMutation(page, `/api/categories/${vetId}`, 200, () =>
      promote.getByRole("button", { name: "Move category" }).click(),
    );
    const vet = groupSection(page, "Vet");
    await expect(vet.getByTestId("category-row")).toHaveCount(0);
    await expect(leafRow(pets, "Vet")).toHaveCount(0);
    expect((await categoryOf(userA, "Vet"))[0].parent_id).toBeNull();

    await vet.getByTestId("group-row").getByRole("button", { name: "Move" }).click();
    const nest = vet.getByRole("form", { name: "Move category" });
    await expect(nest.getByLabel("Group").locator("option:checked")).toHaveText("Top level");
    await expect(nest.getByLabel("Group").locator("option", { hasText: "Vet" })).toHaveCount(0);
    await nest.getByLabel("Group").selectOption({ label: "Pets" });
    await waitForMutation(page, `/api/categories/${vetId}`, 200, () =>
      nest.getByRole("button", { name: "Move category" }).click(),
    );
    await expect(leafRow(pets, "Vet")).toHaveCount(1);
    await expect(groupSection(page, "Vet")).toHaveCount(0);
    await expect(page.getByTestId("category-group")).toHaveCount(DEFAULT_CATEGORIES.length + 1);
    expect((await categoryOf(userA, "Vet"))[0].parent_id).toBe(petsId);

    const groceriesNet = EXPECTED.demo.spending
      .find((section) => section.currency === "USD")!
      .groups.flatMap((group) => group.categories)
      .find((category) => category.name === "Groceries")!.netMinor;
    await page.goto("/spending");
    await expect(
      page.getByTestId("spend-category").filter({ hasText: "Food shopping" }).getByTestId("category-net"),
    ).toHaveText(signed(groceriesNet, "USD"));
    await expect(page.getByTestId("spend-category").filter({ hasText: "Groceries" })).toHaveCount(0);
    await expect(
      page
        .getByTestId("spend-group")
        .filter({ has: page.getByText("Pets", { exact: true }) })
        .getByTestId("group-net"),
    ).toHaveText(signed(groceriesNet, "USD"));
    await page.getByRole("link", { name: "Manage categories" }).click();
    await expect(page).toHaveURL("/categories");
    await expect(leafRow(groupSection(page, "Pets"), "Food shopping")).toHaveCount(1);

    await page.goto("/transactions");
    const filters = page.getByTestId("history-filters");
    await expect(filters.getByLabel("Category").locator("optgroup[label='Pets'] option")).toHaveText([
      "Food shopping",
      "Vet",
    ]);
    await expect(filters.getByLabel("Category").locator("option", { hasText: "Groceries" })).toHaveCount(
      0,
    );
    await expect(filters.getByRole("link", { name: "Edit categories" })).toHaveAttribute(
      "href",
      "/categories",
    );
    await expect(row(page, "Maple Market").getByRole("combobox").locator("option:checked")).toHaveText(
      "Food shopping",
    );

    const contextB = await signedInContext(browser, "b", baseURL);
    try {
      const pageB = await contextB.newPage();
      await pageB.goto("/categories");
      await expect(pageB.getByTestId("category-group")).toHaveCount(DEFAULT_CATEGORIES.length);
      await expect(pageB.getByText("Pets", { exact: true })).toHaveCount(0);
      await expect(pageB.getByText("Food shopping", { exact: true })).toHaveCount(0);
      await expect(leafRow(groupSection(pageB, "Food & Drink"), "Groceries")).toHaveCount(1);
      const foreign = await pageB.request.post(`/api/categories/${groceriesId}`, {
        data: { name: "Hijacked", parentId: null, retired: false },
      });
      expect(foreign.status()).toBe(404);
    } finally {
      await contextB.close();
    }
    expect(await categoryOf(userA, "Hijacked")).toEqual([]);
    expect((await categoryOf(userA, "Food shopping"))[0].id).toBe(groceriesId);
  });

  test("adds and renames a group at 320px without horizontal overflow, and the tab bar stays six wide", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 800 });
    await page.goto("/categories");
    const overflow = () =>
      page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
    const tabs = page.getByRole("navigation", { name: "Primary" }).getByRole("link");
    await expect(tabs).toHaveCount(6);
    await expect(tabs.filter({ hasText: "Categories" })).toHaveCount(0);

    const longName = "Subscriptions And Memberships With A Very Long Name";
    await page.getByRole("button", { name: "Add group" }).click();
    const add = page.getByRole("form", { name: "Add group" });
    await add.getByLabel("Name").fill(longName);
    expect(await overflow()).toBeLessThanOrEqual(0);
    await waitForMutation(page, "/api/categories", 201, () =>
      add.getByRole("button", { name: "Add group" }).click(),
    );
    const group = groupSection(page, longName);
    await expect(group.getByTestId("category-row")).toHaveCount(0);
    expect(await overflow()).toBeLessThanOrEqual(0);
    const id = (await categoryOf(userA, longName))[0].id;

    await group.getByTestId("group-row").getByRole("button", { name: "Rename" }).click();
    const rename = group.getByRole("form", { name: "Rename category" });
    await expect(rename.getByLabel("Name")).toHaveValue(longName);
    await rename.getByLabel("Name").fill("Subscriptions");
    expect(await overflow()).toBeLessThanOrEqual(0);
    await waitForMutation(page, `/api/categories/${id}`, 200, () =>
      rename.getByRole("button", { name: "Save name" }).click(),
    );
    await expect(groupSection(page, "Subscriptions")).toHaveCount(1);
    await expect(groupSection(page, longName)).toHaveCount(0);
    expect((await categoryOf(userA, "Subscriptions"))[0].id).toBe(id);
    expect(await overflow()).toBeLessThanOrEqual(0);
  });
});
