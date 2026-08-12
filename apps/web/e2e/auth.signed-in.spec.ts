import { expect, test } from "@playwright/test";

import { E2E_USER_EMAIL } from "./constants";

// Leaf 1.1.1 promise: sessions persist across visits.
// This project starts each test in a FRESH browser context seeded only with
// the cookie state saved by global.setup.ts — the equivalent of closing the
// browser and coming back. No live sign-in happens here.

test("a signed-in session persists across visits", async ({
  page,
  baseURL,
}) => {
  await page.goto("/");

  // Not bounced to the login page…
  await expect(page).toHaveURL(`${baseURL}/`);
  // …and recognized as the same user, purely from persisted cookies.
  await expect(page.getByTestId("signed-in-email")).toHaveText(E2E_USER_EMAIL);
});
