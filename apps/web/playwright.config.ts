import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  reporter: [["list"], ["html", { open: "never" }]],
  retries: process.env.CI ? 1 : 0,
  use: {
    baseURL: "http://127.0.0.1:3100",
    trace: "on-first-retry",
  },
  webServer: [
    {
      command: ".venv/bin/python -m uvicorn cash_lens_api.main:app --host 127.0.0.1 --port 8100",
      cwd: "../api",
      url: "http://127.0.0.1:8100/health",
      timeout: 120_000,
      reuseExistingServer: !process.env.CI,
      env: {
        APP_BASE_URL: "http://127.0.0.1:3100",
        ALLOWED_ORIGINS: "http://127.0.0.1:3100",
        APP_ENCRYPTION_KEY: "cash-lens-e2e-encryption-key",
        DATABASE_URL: "sqlite:////private/tmp/cashlens-e2e.db",
        DEMO_MODE: "true",
        PLAID_CLIENT_ID: "",
        PLAID_SECRET: "",
        SEED_DEMO_DATA: "true",
        VERIFY_PLAID_WEBHOOKS: "false",
      },
    },
    {
      command: "pnpm build && pnpm exec next start --hostname 127.0.0.1 --port 3100",
      cwd: ".",
      url: "http://127.0.0.1:3100/dashboard",
      timeout: 120_000,
      reuseExistingServer: !process.env.CI,
      env: {
        API_BASE_URL: "http://127.0.0.1:8100",
        ENABLE_CLERK: "false",
      },
    },
  ],
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
