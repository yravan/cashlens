import path from "node:path";
import pg from "pg";
import { afterAll, beforeEach } from "vitest";

import { TEMPLATE_DB, closeAdmin, loadDbEnv, requireEnv, truncateAll, urlForDb, workerDb } from "./db";

loadDbEnv(path.join(import.meta.dirname, "..", ".."));

const db = workerDb();
const admin = new pg.Client({ connectionString: requireEnv("DATABASE_URL_SUPERUSER") });
await admin.connect();
try {
  await admin.query(`drop database if exists ${db} with (force)`);
  await admin.query(`create database ${db} template ${TEMPLATE_DB}`);
} finally {
  await admin.end();
}

process.env.DATABASE_URL = urlForDb("DATABASE_URL", db);

beforeEach(async () => {
  await truncateAll();
});

afterAll(async () => {
  await closeAdmin();
});
