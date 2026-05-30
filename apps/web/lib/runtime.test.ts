import { afterEach, describe, expect, it, vi } from "vitest";

const ORIGINAL_ENV = { ...process.env };

async function loadRuntime() {
  vi.resetModules();
  return import("./runtime");
}

afterEach(() => {
  for (const key of Object.keys(process.env)) {
    if (!(key in ORIGINAL_ENV)) {
      delete process.env[key];
    }
  }

  Object.assign(process.env, ORIGINAL_ENV);
});

describe("runtime config", () => {
  it("defaults to demo mode when Clerk keys are missing", async () => {
    delete process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
    delete process.env.CLERK_SECRET_KEY;
    delete process.env.ENABLE_CLERK;
    process.env.NEXT_PUBLIC_API_BASE_URL = "https://api.example.com";

    const runtime = await loadRuntime();

    expect(runtime.API_BASE_URL).toBe("https://api.example.com");
    expect(runtime.clerkEnabled).toBe(false);
  });

  it("honors an explicit disable flag even when Clerk keys exist", async () => {
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY = "pk_test_123";
    process.env.CLERK_SECRET_KEY = "sk_test_123";
    process.env.ENABLE_CLERK = "false";

    const runtime = await loadRuntime();

    expect(runtime.clerkEnabled).toBe(false);
  });

  it("enables Clerk automatically when keys exist and no override is provided", async () => {
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY = "pk_test_123";
    process.env.CLERK_SECRET_KEY = "sk_test_123";
    delete process.env.ENABLE_CLERK;

    const runtime = await loadRuntime();

    expect(runtime.clerkEnabled).toBe(true);
  });
});
