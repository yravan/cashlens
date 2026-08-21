import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";

import { EXPECTED, SEED_USERS } from "../db/seed/dataset.ts";
import { assertLocalDatabaseUrl } from "../db/seed/local-only.ts";
import { seedDataset } from "../db/seed/seed.ts";

const url = new URL(
  assertLocalDatabaseUrl("DATABASE_URL_SUPERUSER", process.env.DATABASE_URL_SUPERUSER),
);
url.pathname = new URL(assertLocalDatabaseUrl("DATABASE_URL", process.env.DATABASE_URL)).pathname;

const clerkUserId = process.argv[2];

const client = new pg.Client({ connectionString: url.href });

async function userIdFor(id: string): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    "select id from users where clerk_user_id = $1",
    [id],
  );
  if (!rows[0]) throw new Error(`no user with clerk id ${id} — sign in once, then re-run`);
  return rows[0].id;
}

await client.connect();
try {
  const overrides = clerkUserId ? { demo: await userIdFor(clerkUserId) } : undefined;
  await seedDataset(drizzle({ client }), overrides);
  console.log(
    `seeded the canonical dataset into ${url.pathname.slice(1)} — the demo ledger (${EXPECTED.demo.accounts} accounts, ${EXPECTED.demo.transactions} transactions) belongs to ${clerkUserId ?? SEED_USERS.demo.clerkUserId}`,
  );

  if (!clerkUserId) {
    const { rows } = await client.query<{ clerk_user_id: string }>(
      "select clerk_user_id from users where clerk_user_id not like 'user_Seed%' order by created_at desc",
    );
    if (rows.length) {
      console.log(
        `to browse it signed in, re-run as pnpm db:seed <clerk_user_id> — this database has ${rows.map((row) => row.clerk_user_id).join(", ")}`,
      );
    }
  }
} finally {
  await client.end();
}
