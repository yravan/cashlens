import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";

import { EXPECTED, SEED_USERS } from "../db/seed/dataset.ts";
import { assertLocalDatabaseUrl } from "../db/seed/local-only.ts";
import { seedDataset } from "../db/seed/seed.ts";

const superuser = assertLocalDatabaseUrl("DATABASE_URL_SUPERUSER", process.env.DATABASE_URL_SUPERUSER);
const app = assertLocalDatabaseUrl("DATABASE_URL", process.env.DATABASE_URL);

const url = new URL(superuser);
url.pathname = new URL(app).pathname;

const clerkUserId = process.argv[2];

const client = new pg.Client({ connectionString: url.href });
await client.connect();
try {
  let demo = SEED_USERS.demo.clerkUserId;
  let overrides: { demo: string } | undefined;
  if (clerkUserId) {
    const { rows } = await client.query<{ id: string }>(
      "select id from users where clerk_user_id = $1",
      [clerkUserId],
    );
    if (!rows[0]) throw new Error(`no user with clerk id ${clerkUserId} — sign in once, then re-run`);
    overrides = { demo: rows[0].id };
    demo = clerkUserId;
  }

  await seedDataset(drizzle({ client }), overrides);
  console.log(
    `seeded the canonical dataset into ${url.pathname.slice(1)} — the demo ledger (${EXPECTED.demo.accounts} accounts, ${EXPECTED.demo.transactions} transactions) belongs to ${demo}`,
  );

  if (!clerkUserId) {
    const { rows } = await client.query<{ clerk_user_id: string }>(
      "select clerk_user_id from users where clerk_user_id not like 'user_Seed%' order by created_at desc",
    );
    if (rows.length) {
      console.log(
        `to browse it in the app, attach it to a sign-in you can use: pnpm db:seed <clerk_user_id>`,
        `\nusers in this database: ${rows.map((row) => row.clerk_user_id).join(", ")}`,
      );
    }
  }
} finally {
  await client.end();
}
