import path from "node:path";
import { loadEnvConfig } from "@next/env";
import { drizzle } from "drizzle-orm/node-postgres";
import { Client, Pool } from "pg";

import * as schema from "@/lib/db/schema";

export const TEMPLATE_DB = "cashlens_test_template";
export const APP_DIR = path.join(import.meta.dirname, "..", "..");

export function loadDbEnv(): void {
  // @next/env skips .env.local under NODE_ENV=test, and that is where this repo keeps the database URLs.
  const env = process.env as Record<string, string | undefined>;
  const nodeEnv = env.NODE_ENV;
  env.NODE_ENV = "development";
  try {
    loadEnvConfig(APP_DIR, true, { info: () => {}, error: console.error });
  } finally {
    env.NODE_ENV = nodeEnv;
  }
}

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set — the api suite needs the local database (see CLAUDE.md)`);
  }
  return value;
}

export function urlForDb(envName: string, db: string): string {
  const url = new URL(requireEnv(envName));
  url.pathname = `/${db}`;
  return url.href;
}

export function workerDb(): string {
  const id = process.env.VITEST_POOL_ID;
  if (!id || !/^\d+$/.test(id)) {
    throw new Error("VITEST_POOL_ID missing — api tests only run under vitest");
  }
  return `cashlens_test_${id}`;
}

export async function withClient<T>(
  connectionString: string,
  fn: (client: Client) => Promise<T>,
): Promise<T> {
  const client = new Client({ connectionString });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

let pool: Pool | undefined;

const adminPool = () =>
  (pool ??= new Pool({ connectionString: urlForDb("DATABASE_URL_SUPERUSER", workerDb()), max: 2 }));

export const adminDb = () => drizzle({ client: adminPool(), schema });

export async function truncateAll(): Promise<void> {
  const { rows } = await adminPool().query<{ tables: string | null }>(
    "select string_agg(format('%I.%I', schemaname, tablename), ', ') as tables from pg_tables where schemaname = 'public'",
  );
  const { tables } = rows[0];
  if (tables) await adminPool().query(`truncate table ${tables} restart identity cascade`);
}

export async function closeAdmin(): Promise<void> {
  await pool?.end();
  pool = undefined;
}
