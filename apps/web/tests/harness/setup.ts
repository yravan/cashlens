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

beforeEach(truncateAll);
afterAll(closeAdmin);
