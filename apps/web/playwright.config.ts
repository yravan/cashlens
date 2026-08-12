import path from "node:path";
import { defineConfig, devices } from "@playwright/test";

const PORT = 3100;
const BASE_URL = `http://localhost:${PORT}`;

export const STORAGE_STATE = path.join(
  __dirname,
  "playwright/.clerk/user.json",
);
export const E2E_USER_EMAIL = "cashlens-e2e@example.com";

export default defineConfig({
  testDir: "./e2e",
  workers: 1, // parallel clerk.signIn is flaky (clerk/javascript#7891)
  forbidOnly: !!process.env.CI,
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
  },
  projects: [
    { name: "setup", testMatch: /global\.setup\.ts/ },
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
    // Production build: dev-mode lazy compilation makes first hits time out.
    command: `pnpm build && pnpm start --port ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
