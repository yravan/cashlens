import "server-only";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as schema from "./schema";

export type Db = NodePgDatabase<typeof schema>;

// Created on first use, not at import: `next build` (and deploy previews,
// until leaf 1.3 wires a hosted database) must succeed without DATABASE_URL.
// One instance per process, surviving dev-server hot reloads.
const globalForDb = globalThis as unknown as { cashlensDb?: Db };

export function getDb(): Db {
  if (!globalForDb.cashlensDb) {
    if (!process.env.DATABASE_URL) {
      throw new Error(
        "DATABASE_URL is not set — copy .env.example to .env.local first",
      );
    }
    globalForDb.cashlensDb = drizzle({
      client: new Pool({ connectionString: process.env.DATABASE_URL, max: 5 }),
      schema,
    });
  }
  return globalForDb.cashlensDb;
}
