import { expect, test } from "@playwright/test";

test("demo workspace loads and can add a demo institution from settings", async ({ page }) => {
  await page.goto("/dashboard");

  await expect(page.getByRole("heading", { name: "Cash Lens MVP" })).toBeVisible();
  await expect(page.getByText("Total cash")).toBeVisible();

  await page.getByRole("link", { name: /settings/i }).click();
  await expect(page.getByRole("heading", { name: "Workspace settings" })).toBeVisible();

  await page.getByTestId("plaid-connect-button").click();
  await expect(page.getByText("Demo Sandbox Bank", { exact: true })).toBeVisible();
});

test("transaction review saves using labels instead of brittle selectors", async ({ page }) => {
  const category = `test-category-${Date.now()}`;
  const categoryField = page.getByRole("textbox", { name: "Category", exact: true });

  await page.goto("/transactions");
  await expect(page.getByRole("heading", { name: "Review transaction" })).toBeVisible();

  await categoryField.fill(category);
  await page.getByRole("button", { name: /save review changes/i }).click();
  await expect(categoryField).toHaveValue(category);
});
