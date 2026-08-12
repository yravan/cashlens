import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const dbConfinedToDataLayer = {
  rules: {
    "no-restricted-imports": [
      "error",
      {
        paths: [
          { name: "pg", message: "Database access lives in lib/data (the DAL)." },
        ],
        patterns: [
          {
            group: ["@/lib/db/*", "**/lib/db/*"],
            message: "Import DAL functions from lib/data instead of the db client.",
          },
        ],
      },
    ],
  },
};

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  { files: ["app/**/*.{ts,tsx}", "proxy.ts"], ...dbConfinedToDataLayer },
  {
    files: ["lib/**/*.ts"],
    ignores: ["lib/db/**", "lib/data/**"],
    ...dbConfinedToDataLayer,
  },
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts"]),
]);
