import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    ignores: ["lib/db/**", "lib/data/**", "lib/crypto/**", "db/seed/**", "e2e/**", "scripts/**", "tests/**"],
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
            {
              group: ["@/lib/crypto/*", "**/lib/crypto/*"],
              message: "Credential crypto is confined to the DAL (lib/data).",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["lib/db/**", "db/seed/**", "e2e/**", "scripts/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/lib/crypto/*", "**/lib/crypto/*"],
              message: "Credential crypto is confined to the DAL (lib/data).",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["e2e/**"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "CallExpression[callee.property.name='toBeOK']",
          message:
            "A failing toBeOK() prints every request header (Cookie included) into logs and reports; assert on status()/body instead.",
        },
      ],
    },
  },
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts"]),
]);
