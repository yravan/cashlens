import { randomBytes } from "node:crypto";
import { afterAll, beforeEach } from "vitest";

import { TEMPLATE_DB, closeAdmin, loadDbEnv, requireEnv, truncateAll, urlForDb, withClient, workerDb } from "./db";

loadDbEnv();

const db = workerDb();
await withClient(requireEnv("DATABASE_URL_SUPERUSER"), async (client) => {
  // `with (force)`: vitest hands a pool id to the next file before the previous one's connections close.
  await client.query(`drop database if exists ${db} with (force)`);
  await client.query(`create database ${db} template ${TEMPLATE_DB}`);
});

process.env.DATABASE_URL = urlForDb("DATABASE_URL", db);
process.env.CREDENTIAL_ENCRYPTION_KEYS ??= `test:${randomBytes(32).toString("hex")}`;
// The Plaid substitute (harness/plaid.ts) never sends these anywhere.
process.env.PLAID_ENV ??= "sandbox";
process.env.PLAID_CLIENT_ID ??= "api-suite-client-id";
process.env.PLAID_SECRET ??= "api-suite-secret";
// The OpenRouter substitute (harness/openrouter.ts) repoints the base URL at
// its loopback server; this default fails closed so an unsubstituted call can
// never leave the machine. Both are assigned, not defaulted: the suite reaches
// no real provider, so a real key from .env.local must never become a Bearer
// header the substitute records and assertions print.
process.env.OPENROUTER_API_KEY = "api-suite-openrouter-key";
process.env.OPENROUTER_BASE_URL = "http://127.0.0.1:9/api/v1";

beforeEach(truncateAll);
afterAll(closeAdmin);
