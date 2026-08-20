import path from "node:path";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";

import { TEMPLATE_DB, loadDbEnv, requireEnv, urlForDb } from "./db";

const APP_DIR = path.join(import.meta.dirname, "..", "..");

async function run(
  connectionString: string,
  fn: (client: pg.Client) => Promise<void>,
): Promise<void> {
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    await fn(client);
  } finally {
    await client.end();
  }
}

export default async function globalSetup(): Promise<void> {
  loadDbEnv(APP_DIR);

  const owner = decodeURIComponent(new URL(requireEnv("DATABASE_URL_OWNER")).username);
  const app = decodeURIComponent(new URL(requireEnv("DATABASE_URL")).username);
  const ownerId = pg.escapeIdentifier(owner);
  const appId = pg.escapeIdentifier(app);

  await run(requireEnv("DATABASE_URL_SUPERUSER"), async (client) => {
    const roles = await client.query(
      "select 1 from pg_roles where rolname in ($1, $2)",
      [owner, app],
    );
    if (roles.rowCount !== 2) {
      throw new Error("database roles missing — run `pnpm db:setup` first");
    }
    await client.query(`drop database if exists ${TEMPLATE_DB} with (force)`);
    await client.query(`create database ${TEMPLATE_DB} owner ${ownerId}`);
    await client.query(`grant create on database ${TEMPLATE_DB} to ${ownerId}`);
  });

  await run(urlForDb("DATABASE_URL_SUPERUSER", TEMPLATE_DB), async (client) => {
    await client.query("revoke all on schema public from public");
    await client.query(`grant usage, create on schema public to ${ownerId}`);
    await client.query(`grant usage on schema public to ${appId}`);
  });

  const migrator = new pg.Client({
    connectionString: urlForDb("DATABASE_URL_OWNER", TEMPLATE_DB),
  });
  await migrator.connect();
  try {
    await migrate(drizzle({ client: migrator }), {
      migrationsFolder: path.join(APP_DIR, "db", "migrations"),
    });
  } finally {
    await migrator.end();
  }
}
