import "server-only";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as schema from "./schema";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set — copy .env.example to .env.local first");
}

// Reuse the pool across dev-server hot reloads (one pool per process).
const globalForDb = globalThis as unknown as { cashlensPool?: Pool };
const pool =
  globalForDb.cashlensPool ??
  new Pool({ connectionString: process.env.DATABASE_URL, max: 5 });
if (process.env.NODE_ENV !== "production") globalForDb.cashlensPool = pool;

export const db = drizzle({ client: pool, schema });
