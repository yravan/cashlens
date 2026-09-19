import "server-only";
import { attachDatabasePool } from "@vercel/functions";
import { sql } from "drizzle-orm";
import { DrizzleQueryError } from "drizzle-orm/errors";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { DatabaseError, Pool } from "pg";

import * as schema from "./schema";

type Db = NodePgDatabase<typeof schema>;
export type ScopedTx = Parameters<Parameters<Db["transaction"]>[0]>[0];

const MAPPED_CONSTRAINTS = new Set([
  "connections_user_provider_item_key",
  "scheduled_obligations_account_user_fk",
]);

export class DatabaseQueryError extends Error {
  readonly cause: { code?: string; constraint?: string };

  constructor(code?: string, constraint?: string) {
    super("Database query failed");
    this.name = "DatabaseQueryError";
    this.cause = {
      code: /^[0-9A-Z]{5}$/.test(code ?? "") ? code : undefined,
      constraint: MAPPED_CONSTRAINTS.has(constraint ?? "") ? constraint : undefined,
    };
  }
}

function sanitizeDatabaseError(error: unknown): never {
  if (error instanceof DrizzleQueryError) {
    const cause = error.cause;
    throw cause instanceof DatabaseError
      ? new DatabaseQueryError(cause.code, cause.constraint)
      : new DatabaseQueryError();
  }
  if (error instanceof DatabaseError) {
    throw new DatabaseQueryError(error.code, error.constraint);
  }
  throw error;
}

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
      keepAlive: true,
    });
    // Unhandled, a server-dropped idle connection crashes the process.
    pool.on("error", (error) =>
      console.error("idle database connection error:", error.message),
    );
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
  try {
    return await getDb().transaction(async (tx) => {
      await tx.execute(
        sql`select set_config('app.clerk_user_id', ${clerkUserId}, true)`,
      );
      return fn(tx);
    });
  } catch (error) {
    sanitizeDatabaseError(error);
  }
}

// Webhook scope: no session exists, so visibility is keyed on the verified
// provider item id instead of a user (policies *_webhook_* in the schema).
export async function withPlaidItemScope<T>(
  itemId: string,
  fn: (tx: ScopedTx) => Promise<T>,
): Promise<T> {
  try {
    return await getDb().transaction(async (tx) => {
      await tx.execute(
        sql`select set_config('app.plaid_item_id', ${itemId}, true)`,
      );
      return fn(tx);
    });
  } catch (error) {
    sanitizeDatabaseError(error);
  }
}
