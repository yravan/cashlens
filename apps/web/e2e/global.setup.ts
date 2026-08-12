import { createClerkClient } from "@clerk/backend";
import { clerk, clerkSetup } from "@clerk/testing/playwright";
import { expect, test as setup } from "@playwright/test";

import { STORAGE_STATE } from "../playwright.config";
import { E2E_USER_EMAIL } from "./constants";

setup("sign in against the Clerk dev instance and save session state", async ({
  page,
}) => {
  // Fetches a Testing Token (bypasses bot detection) and loads .env.local.
  // Refuses production secret keys by design.
  await clerkSetup();

  const secretKey = process.env.CLERK_SECRET_KEY;
  if (!secretKey) {
    throw new Error(
      "CLERK_SECRET_KEY is not set. Copy apps/web/.env.example to " +
        "apps/web/.env.local and fill in the Clerk development keys " +
        "(`npx clerk@latest env pull`).",
    );
  }

  // Ensure the e2e user exists (idempotent). Created via the Backend API
  // with no password: the instance is Google-only, so the only programmatic
  // sign-in path is a single-use sign-in ticket — which is exactly what
  // clerk.signIn({ emailAddress }) uses under the hood.
  const clerkClient = createClerkClient({ secretKey });
  const existing = await clerkClient.users.getUserList({
    emailAddress: [E2E_USER_EMAIL],
  });
  if (existing.totalCount === 0) {
    await clerkClient.users.createUser({ emailAddress: [E2E_USER_EMAIL] });
  }

  // clerk.signIn requires a public page that loads ClerkJS first.
  await page.goto("/sign-in");
  await clerk.loaded({ page });
  await clerk.signIn({ page, emailAddress: E2E_USER_EMAIL });

  // Prove the session is real before persisting it.
  await page.goto("/");
  await expect(page.getByTestId("signed-in-email")).toHaveText(E2E_USER_EMAIL);

  await page.context().storageState({ path: STORAGE_STATE });
});
