import { clerk, clerkSetup } from "@clerk/testing/playwright";
import { expect, test, type Page } from "@playwright/test";

import { E2E_USER_A_EMAIL } from "../playwright.config";

const SECTIONS = [
  { label: "Transactions", path: "/transactions" },
  { label: "Accounts", path: "/accounts" },
  { label: "Dashboard", path: "/" },
] as const;

async function walkSections(page: Page, baseURL: string) {
  for (const { label, path } of SECTIONS) {
    await page.getByRole("link", { name: label }).click();

    await expect(page).toHaveURL(`${baseURL}${path === "/" ? "/" : path}`);
    await expect(
      page.getByRole("heading", { level: 1, name: label }),
    ).toBeVisible();

    const current = page
      .locator("a[aria-current='page']")
      .filter({ visible: true });
    await expect(current).toHaveCount(1);
    await expect(current).toHaveText(label);
  }
}

test("the nav walks a signed-in user through every section", async ({
  page,
  baseURL,
}) => {
  await page.goto("/");
  await walkSections(page, baseURL!);
});

test.describe("phone viewport", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  test("the tab bar walks through every section on a phone", async ({
    page,
    baseURL,
  }) => {
    await page.goto("/");
    await walkSections(page, baseURL!);
  });
});

test.describe("sign-out", () => {
  // Fresh sign-in so signing out revokes only this test's session, never the
  // storage state shared by the rest of the signed-in project.
  test.use({ storageState: { cookies: [], origins: [] } });

  test("signing out from the shell ends the session for real", async ({
    page,
    baseURL,
  }) => {
    await clerkSetup();
    await page.goto("/sign-in");
    await clerk.loaded({ page });
    await clerk.signIn({ page, emailAddress: E2E_USER_A_EMAIL });

    await page.goto("/");
    await expect(page).toHaveURL(`${baseURL}/`);

    await page.locator(".cl-userButtonTrigger").click();
    // Clerk's popover buttons expose no accessible name; the documented
    // cl-* customization classes are the stable hook.
    await page.locator(".cl-userButtonPopoverActionButton__signOut").click();

    await expect(page).toHaveURL(/\/sign-in/);

    await page.goto("/");
    await expect(page).toHaveURL(/\/sign-in/);
    await expect(
      page.getByRole("button", { name: /continue with google/i }),
    ).toBeVisible();
  });
});
