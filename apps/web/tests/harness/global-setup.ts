import path from "node:path";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { escapeIdentifier } from "pg";

import { APP_DIR, TEMPLATE_DB, loadDbEnv, requireEnv, urlForDb, withClient } from "./db";

export default async function globalSetup(): Promise<void> {
  loadDbEnv();

  const owner = decodeURIComponent(new URL(requireEnv("DATABASE_URL_OWNER")).username);
  const app = decodeURIComponent(new URL(requireEnv("DATABASE_URL")).username);
  const ownerId = escapeIdentifier(owner);
  const appId = escapeIdentifier(app);

  await withClient(requireEnv("DATABASE_URL_SUPERUSER"), async (client) => {
    const roles = await client.query("select 1 from pg_roles where rolname in ($1, $2)", [owner, app]);
    if (roles.rowCount !== 2) throw new Error("database roles missing — run `pnpm db:setup` first");
    await client.query(`drop database if exists ${TEMPLATE_DB} with (force)`);
    await client.query(`create database ${TEMPLATE_DB} owner ${ownerId}`);
  });

  await withClient(urlForDb("DATABASE_URL_SUPERUSER", TEMPLATE_DB), async (client) => {
    await client.query("revoke all on schema public from public");
    await client.query(`grant usage, create on schema public to ${ownerId}`);
    await client.query(`grant usage on schema public to ${appId}`);
  });

  await withClient(urlForDb("DATABASE_URL_OWNER", TEMPLATE_DB), (client) =>
    migrate(drizzle({ client }), {
      migrationsFolder: path.join(APP_DIR, "db", "migrations"),
    }),
  );
}
