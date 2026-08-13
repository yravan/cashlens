import { expect, test } from "@playwright/test";

import { E2E_USER_A_EMAIL } from "../playwright.config";

// Fresh browser context carrying only the cookies saved by global.setup.ts —
// the equivalent of closing the browser and coming back.
test("a signed-in session persists across visits", async ({
  page,
  baseURL,
}) => {
  await page.goto("/");

  await expect(page).toHaveURL(`${baseURL}/`);
  await expect(page.getByTestId("signed-in-email")).toHaveText(E2E_USER_A_EMAIL);
});
