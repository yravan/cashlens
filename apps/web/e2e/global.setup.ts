import fs from "node:fs";
import path from "node:path";
import { createClerkClient } from "@clerk/backend";
import { clerk, clerkSetup } from "@clerk/testing/playwright";
import { expect, test as setup } from "@playwright/test";

import {
  E2E_USER_A_EMAIL,
  E2E_USER_B_EMAIL,
  E2E_USERS_FILE,
  STORAGE_STATE_A,
  STORAGE_STATE_B,
} from "../playwright.config";

const USERS = [
  { key: "a", email: E2E_USER_A_EMAIL, storageState: STORAGE_STATE_A },
  { key: "b", email: E2E_USER_B_EMAIL, storageState: STORAGE_STATE_B },
] as const;

for (const { key, email, storageState } of USERS) {
  setup(`sign in ${email} against the Clerk dev instance and save session state`, async ({
    page,
  }) => {
    await clerkSetup();

    // Google-only instance, so e2e users have no password: clerk.signIn
    // signs in with a single-use Backend-API sign-in ticket.
    const clerkClient = createClerkClient({
      secretKey: process.env.CLERK_SECRET_KEY!,
    });
    const existing = await clerkClient.users.getUserList({
      emailAddress: [email],
    });
    const user =
      existing.data[0] ??
      (await clerkClient.users.createUser({ emailAddress: [email] }));

    await page.goto("/sign-in");
    await clerk.loaded({ page });
    await clerk.signIn({ page, emailAddress: email });

    await page.goto("/");
    await expect(page.getByTestId("signed-in-email")).toHaveText(email);

    await page.context().storageState({ path: storageState });

    fs.mkdirSync(path.dirname(E2E_USERS_FILE), { recursive: true });
    const ids = fs.existsSync(E2E_USERS_FILE)
      ? JSON.parse(fs.readFileSync(E2E_USERS_FILE, "utf8"))
      : {};
    ids[key] = { email, clerkUserId: user.id };
    fs.writeFileSync(E2E_USERS_FILE, JSON.stringify(ids, null, 2));
  });
}
