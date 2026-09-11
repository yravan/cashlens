import path from "node:path";
import { defineConfig } from "vitest/config";

const web = import.meta.dirname;

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    globalSetup: ["./tests/harness/global-setup.ts"],
    setupFiles: ["./tests/harness/setup.ts"],
  },
  resolve: {
    alias: {
      "@clerk/nextjs/server": path.join(web, "tests/harness/clerk.ts"),
      plaid: path.join(web, "tests/harness/plaid.ts"),
      "server-only": path.join(web, "tests/harness/server-only.ts"),
      "@": web,
    },
  },
});
