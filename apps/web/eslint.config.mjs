import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    ignores: ["lib/db/**", "lib/data/**", "e2e/**", "scripts/**"],
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
  },
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts"]),
]);
