import path from "node:path";
import { loadEnvConfig } from "@next/env";
import { defineConfig, devices } from "@playwright/test";

// dev=true: without it, an unset NODE_ENV loads .env.production.local first,
// silently pointing the whole e2e stack — db helpers, seeding, and the app
// under test — at production (same footgun as drizzle.config.ts).
loadEnvConfig(__dirname, true);

const PORT = 3100;
export const BASE_URL = `http://localhost:${PORT}`;

export const STORAGE_STATE_A = path.join(
  __dirname,
  "playwright/.clerk/user-a.json",
);
export const STORAGE_STATE_B = path.join(
  __dirname,
  "playwright/.clerk/user-b.json",
);
export const E2E_USERS_FILE = path.join(
  __dirname,
  "playwright/.clerk/users.json",
);
export const E2E_USER_A_EMAIL = "cashlens-e2e@example.com";
export const E2E_USER_B_EMAIL = "cashlens-e2e-b@example.com";

// No real Anthropic key -> the app under test talks to the local stub
// (e2e/llm-stub.setup.ts starts it); a real key in .env.local makes the
// categorize spec a live-provider smoke instead.
export const LLM_STUB_PORT = 3199;
const llmEnv: { [key: string]: string } = process.env.ANTHROPIC_API_KEY
  ? {}
  : {
      ANTHROPIC_API_KEY: "sk-ant-e2e-stub",
      ANTHROPIC_BASE_URL: `http://127.0.0.1:${LLM_STUB_PORT}`,
    };

export default defineConfig({
  testDir: "./e2e",
  workers: 1, // parallel clerk.signIn is flaky (clerk/javascript#7891)
  forbidOnly: !!process.env.CI,
  globalSetup: "./e2e/llm-stub.setup.ts",
  globalTeardown: "./e2e/scrub-secrets.ts",
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
  },
  projects: [
    { name: "unit", testMatch: /\.unit\.spec\.ts/ },
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
      use: { ...devices["Desktop Chrome"], storageState: STORAGE_STATE_A },
    },
  ],
  webServer: {
    // Dev-mode lazy compilation makes first hits time out; CI builds in its own step.
    command: process.env.CI
      ? `pnpm start --port ${PORT}`
      : `pnpm build && pnpm start --port ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: llmEnv,
  },
});
