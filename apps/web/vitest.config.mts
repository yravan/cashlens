import path from "node:path";
import { defineConfig } from "vitest/config";

// The api suite runs route handlers and DAL functions in-process against
// per-worker clones of a migrated template database. File isolation (fresh
// process per test file) is load-bearing: tests override DATABASE_URL before
// the app's lazy pool first reads it.
export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    globalSetup: ["./tests/harness/global-setup.ts"],
    setupFiles: ["./tests/harness/setup.ts"],
  },
  resolve: {
    alias: [
      // Clerk is a true external: substituted behind the exact interface
      // production imports. Everything repo-owned runs unmocked.
      {
        find: /^@clerk\/nextjs\/server$/,
        replacement: path.join(import.meta.dirname, "tests/harness/clerk.ts"),
      },
      {
        find: /^server-only$/,
        replacement: path.join(import.meta.dirname, "tests/harness/server-only.ts"),
      },
      { find: /^@\//, replacement: `${import.meta.dirname}/` },
    ],
  },
});
