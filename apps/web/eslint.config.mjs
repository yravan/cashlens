import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const cryptoFence = {
  group: ["@/lib/crypto/*", "**/lib/crypto/*"],
  message: "Credential crypto is confined to the DAL (lib/data).",
};

const plaidFence = {
  group: ["@/lib/plaid/*", "**/lib/plaid/*"],
  message: "Plaid access is confined to the DAL (lib/data).",
};

const plaidPackage = {
  name: "plaid",
  message: "The Plaid SDK is confined to lib/plaid (secret-bearing errors).",
};

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    ignores: ["lib/db/**", "lib/data/**", "lib/crypto/**", "lib/plaid/**", "db/seed/**", "e2e/**", "scripts/**", "tests/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            { name: "pg", message: "Database access lives in lib/data (the DAL)." },
            plaidPackage,
          ],
          patterns: [
            {
              group: ["@/lib/db/*", "**/lib/db/*"],
              message: "Import DAL functions from lib/data instead of the db client.",
            },
            cryptoFence,
            plaidFence,
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
        { paths: [plaidPackage], patterns: [cryptoFence, plaidFence] },
      ],
    },
  },
  {
    files: ["lib/plaid/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            cryptoFence,
            {
              group: ["@/lib/db/*", "**/lib/db/*"],
              message: "The Plaid client stays stateless; persistence lives in lib/data.",
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
