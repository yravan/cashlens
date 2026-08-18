import "server-only";
import { attachDatabasePool } from "@vercel/functions";
import { sql } from "drizzle-orm";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as schema from "./schema";

type Db = NodePgDatabase<typeof schema>;
export type ScopedTx = Parameters<Parameters<Db["transaction"]>[0]>[0];

// Lazy: `next build` and previews must succeed without DATABASE_URL. Global: one pool across dev reloads.
const globalForDb = globalThis as unknown as { cashlensDb?: Db };

function getDb(): Db {
  if (!globalForDb.cashlensDb) {
    if (!process.env.DATABASE_URL) {
      throw new Error(
        "DATABASE_URL is not set — copy .env.example to .env.local first",
      );
    }
    const pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 5,
      connectionTimeoutMillis: 5_000,
      query_timeout: 20_000,
      idleTimeoutMillis: 10_000,
      keepAlive: true,
    });
    // Without a listener, an idle connection dropped by the server crashes the process.
    pool.on("error", (error) => {
      console.error("idle database connection error:", error.message);
    });
    attachDatabasePool(pool);
    globalForDb.cashlensDb = drizzle({ client: pool, schema });
  }
  return globalForDb.cashlensDb;
}

export async function pingDb(): Promise<void> {
  await getDb().execute(sql`select 1`);
}

export async function withRequestScope<T>(
  clerkUserId: string,
  fn: (tx: ScopedTx) => Promise<T>,
): Promise<T> {
  return getDb().transaction(async (tx) => {
    await tx.execute(
      sql`select set_config('app.clerk_user_id', ${clerkUserId}, true)`,
    );
    return fn(tx);
  });
}
