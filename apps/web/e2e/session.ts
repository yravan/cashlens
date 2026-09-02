import fs from "node:fs";
import { clerk } from "@clerk/testing/playwright";
import { devices, expect, type Browser } from "@playwright/test";

import { BASE_URL, STORAGE_STATE_A, STORAGE_STATE_B } from "../playwright.config";

const STATE_FILE = { a: STORAGE_STATE_A, b: STORAGE_STATE_B } as const;

// Clerk mints __session as a 60-second JWT while Playwright saves the cookie
// carrying it for a year, so a storage-state file is a credential that dies
// mid-suite while still looking present. A page context hides that — Clerk's
// handshake re-mints on navigation — but an APIRequestContext cannot
// handshake and answers 200 with the sign-in page instead. The margin covers
// a consumer up to its first page load; clerk-js keeps it alive after that.
const MIN_REMAINING_MS = 20_000;

function remainingMs(cookies: { name: string; value: string }[]): number {
  const lifetimes = cookies
    .filter((cookie) => cookie.name.startsWith("__session"))
    .map((cookie) => {
      try {
        const { exp } = JSON.parse(
          Buffer.from(cookie.value.split(".")[1], "base64url").toString(),
        );
        return exp * 1000 - Date.now();
      } catch {
        return 0;
      }
    });
  return lifetimes.length === 0 ? 0 : Math.min(...lifetimes);
}

export function savedRemainingMs(user: "a" | "b" = "a"): number {
  return remainingMs(JSON.parse(fs.readFileSync(STATE_FILE[user], "utf8")).cookies);
}

export async function signedInState(
  browser: Browser,
  user: "a" | "b" = "a",
): Promise<string> {
  const file = STATE_FILE[user];
  if (savedRemainingMs(user) > MIN_REMAINING_MS) return file;

  const context = await browser.newContext({
    ...devices["Desktop Chrome"],
    storageState: file,
  });
  try {
    const page = await context.newPage();
    // Public route on purpose: proxy.ts redirects a protected one before the
    // app document loads, so clerk-js — the only thing that re-mints a
    // session token — never boots there.
    await page.goto(`${BASE_URL}/sign-in`, { waitUntil: "domcontentloaded" });
    await clerk.loaded({ page });
    await expect
      .poll(async () => remainingMs(await context.cookies()), {
        timeout: 15_000,
        message: "clerk-js did not re-mint __session on the public sign-in page",
      })
      .toBeGreaterThan(MIN_REMAINING_MS);
    await context.storageState({ path: file });
  } finally {
    await context.close();
  }
  return file;
}
