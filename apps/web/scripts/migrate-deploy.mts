import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";

if (process.env.VERCEL_ENV !== "production") {
  console.log("not a production deploy — skipping migrations");
  process.exit(0);
}

const url = process.env.DATABASE_URL_OWNER;
if (!url) throw new Error("DATABASE_URL_OWNER is not set");

const client = new pg.Client({
  connectionString: url,
  connectionTimeoutMillis: 10_000,
});
await client.connect();
try {
  await migrate(drizzle(client), { migrationsFolder: "db/migrations" });
  console.log("migrations applied");
} finally {
  await client.end();
}
