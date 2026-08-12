import { createClerkClient } from "@clerk/backend";
import { clerk, clerkSetup } from "@clerk/testing/playwright";
import { expect, test as setup } from "@playwright/test";

import { E2E_USER_EMAIL, STORAGE_STATE } from "../playwright.config";

setup("sign in against the Clerk dev instance and save session state", async ({
  page,
}) => {
  await clerkSetup();

  // Google-only instance, so the e2e user has no password: clerk.signIn
  // signs in with a single-use Backend-API sign-in ticket.
  const clerkClient = createClerkClient({
    secretKey: process.env.CLERK_SECRET_KEY!,
  });
  const existing = await clerkClient.users.getUserList({
    emailAddress: [E2E_USER_EMAIL],
  });
  if (existing.totalCount === 0) {
    await clerkClient.users.createUser({ emailAddress: [E2E_USER_EMAIL] });
  }

  await page.goto("/sign-in");
  await clerk.loaded({ page });
  await clerk.signIn({ page, emailAddress: E2E_USER_EMAIL });

  await page.goto("/");
  await expect(page.getByTestId("signed-in-email")).toHaveText(E2E_USER_EMAIL);

  await page.context().storageState({ path: STORAGE_STATE });
});
