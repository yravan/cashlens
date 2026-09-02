import { loadEnvConfig } from "@next/env";
import { defineConfig } from "drizzle-kit";

// dev=true: without it, an unset NODE_ENV loads .env.production.local first,
// silently pointing local drizzle-kit runs at the production database.
// Production migrations go through scripts/migrate-deploy.mts, never this config.
loadEnvConfig(process.cwd(), true);

if (!process.env.DATABASE_URL_OWNER) {
  throw new Error("DATABASE_URL_OWNER is not set — copy .env.example to .env.local first");
}

export default defineConfig({
  dialect: "postgresql",
  schema: "./lib/db/schema.ts",
  out: "./db/migrations",
  dbCredentials: { url: process.env.DATABASE_URL_OWNER },
});
