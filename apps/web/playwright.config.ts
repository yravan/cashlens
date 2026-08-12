import path from "node:path";
import { defineConfig, devices } from "@playwright/test";

const PORT = 3100;
const BASE_URL = `http://localhost:${PORT}`;

export const STORAGE_STATE = path.join(
  __dirname,
  "playwright/.clerk/user.json",
);

export default defineConfig({
  testDir: "./e2e",
  // One worker: concurrent clerk.signIn calls are flaky
  // (clerk/javascript#7891) and the suite is small.
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  reporter: [["list"]],
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
  },
  projects: [
    {
      // Signs a real user in against the Clerk development instance and
      // saves the resulting browser state for the signed-in project.
      name: "setup",
      testMatch: /global\.setup\.ts/,
    },
    {
      name: "signed-out",
      testMatch: /\.signed-out\.spec\.ts/,
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "signed-in",
      testMatch: /\.signed-in\.spec\.ts/,
      dependencies: ["setup"],
      use: { ...devices["Desktop Chrome"], storageState: STORAGE_STATE },
    },
  ],
  webServer: {
    // Production build for determinism (dev-mode lazy compilation causes
    // first-hit timeouts). NEXT_PUBLIC_* vars are read from .env.local at
    // build time.
    command: `pnpm build && pnpm start --port ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
