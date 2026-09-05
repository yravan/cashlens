import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const pgPackage = { name: "pg", message: "Database access lives in lib/data (the DAL)." };
const plaidPackage = {
  name: "plaid",
  message: "The Plaid SDK is confined to lib/plaid (secret-bearing errors).",
};
const anthropicPackage = {
  name: "@anthropic-ai/sdk",
  message: "The Anthropic SDK is confined to lib/llm (sanitized errors, least data).",
};

const dbFence = {
  group: ["@/lib/db/*", "**/lib/db/*"],
  message: "Import DAL functions from lib/data instead of the db client.",
};
const cryptoFence = {
  group: ["@/lib/crypto/*", "**/lib/crypto/*"],
  message: "Credential crypto is confined to the DAL (lib/data).",
};
const plaidFence = {
  group: ["@/lib/plaid/*", "**/lib/plaid/*"],
  message: "Plaid access is confined to the DAL (lib/data).",
};
const llmFence = {
  group: ["@/lib/llm/*", "**/lib/llm/*"],
  message: "LLM access is confined to the DAL (lib/data).",
};

const restrict = (paths, patterns) => ({
  "no-restricted-imports": ["error", { paths, patterns }],
});

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    ignores: ["lib/db/**", "lib/data/**", "lib/crypto/**", "lib/plaid/**", "lib/llm/**", "db/seed/**", "e2e/**", "scripts/**", "tests/**"],
    rules: restrict([pgPackage, plaidPackage, anthropicPackage], [dbFence, cryptoFence, plaidFence, llmFence]),
  },
  {
    files: ["lib/db/**", "db/seed/**", "e2e/**", "scripts/**"],
    rules: restrict([plaidPackage, anthropicPackage], [cryptoFence, plaidFence, llmFence]),
  },
  {
    files: ["lib/data/**", "lib/crypto/**"],
    rules: restrict([plaidPackage, anthropicPackage], []),
  },
  {
    files: ["lib/plaid/**"],
    rules: restrict(
      [anthropicPackage],
      [
        cryptoFence,
        llmFence,
        { ...dbFence, message: "The Plaid client stays stateless; persistence lives in lib/data." },
      ],
    ),
  },
  {
    files: ["lib/llm/**"],
    rules: restrict(
      [pgPackage, plaidPackage],
      [
        cryptoFence,
        plaidFence,
        { ...dbFence, message: "The LLM client stays stateless; persistence lives in lib/data." },
      ],
    ),
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
