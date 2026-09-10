import { randomUUID } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { migrate } from "drizzle-orm/node-postgres/migrator";
import { drizzle } from "drizzle-orm/node-postgres";
import { escapeIdentifier } from "pg";
import { expect, test } from "vitest";

import { assertLocalDatabaseUrl } from "@/db/seed/local-only";
import {
  APP_DIR,
  requireEnv,
  urlForDb,
  withClient,
} from "../harness/db";

type JournalEntry = {
  idx: number;
  version: string;
  when: number;
  tag: string;
  breakpoints: boolean;
};

type MigrationJournal = {
  version: string;
  dialect: string;
  entries: JournalEntry[];
};

const MIGRATIONS = path.join(APP_DIR, "db", "migrations");
const DATABASE_NAME = /^cashlens_upgrade_[a-f0-9]{16}$/;

async function stageBaseline(destination: string): Promise<void> {
  const journal = JSON.parse(
    await readFile(path.join(MIGRATIONS, "meta", "_journal.json"), "utf8"),
  ) as MigrationJournal;
  const cutoff = journal.entries.findIndex((entry) =>
    entry.tag.endsWith("_classification_journal"),
  );
  if (cutoff < 0) throw new Error("classification journal migration is missing from the journal");

  const entries = journal.entries.slice(0, cutoff);
  const meta = path.join(destination, "meta");
  await mkdir(meta, { recursive: true });
  for (const entry of entries) {
    await copyFile(path.join(MIGRATIONS, `${entry.tag}.sql`), path.join(destination, `${entry.tag}.sql`));
  }
  await writeFile(
    path.join(meta, "_journal.json"),
    JSON.stringify({ ...journal, entries }, null, 2),
  );
}

function localUrl(name: string): string {
  return assertLocalDatabaseUrl(name, requireEnv(name));
}

test("the journal upgrade preserves legacy category provenance and defaults", async () => {
  const superuserUrl = localUrl("DATABASE_URL_SUPERUSER");
  const ownerUrl = localUrl("DATABASE_URL_OWNER");
  localUrl("DATABASE_URL");
  const ownerRole = decodeURIComponent(new URL(ownerUrl).username);
  if (!/^[a-z_][a-z0-9_]*$/.test(ownerRole)) {
    throw new Error("DATABASE_URL_OWNER has an unsupported role name");
  }

  const databaseName = `cashlens_upgrade_${randomUUID().replaceAll("-", "").slice(0, 16)}`;
  if (!DATABASE_NAME.test(databaseName)) throw new Error("generated upgrade database name is invalid");
  const staging = await mkdtemp(path.join(os.tmpdir(), "cashlens-migrations-"));
  let created = false;
  let beforeUpgrade: { description: string; snapshot: Record<string, unknown> }[] = [];

  try {
    await stageBaseline(staging);
    await withClient(superuserUrl, async (client) => {
      await client.query(
        `create database ${escapeIdentifier(databaseName)} owner ${escapeIdentifier(ownerRole)}`,
      );
    });
    created = true;

    const baselineUrl = urlForDb("DATABASE_URL_OWNER", databaseName);
    await withClient(baselineUrl, (client) =>
      migrate(drizzle({ client }), { migrationsFolder: staging }),
    );

    const userClerkId = `upgrade_${databaseName}`;
    await withClient(urlForDb("DATABASE_URL_SUPERUSER", databaseName), async (client) => {
      const { rows: users } = await client.query<{ id: string }>(
        `insert into users (clerk_user_id) values ($1) returning id`,
        [userClerkId],
      );
      const userId = users[0].id;
      const { rows: accounts } = await client.query<{ id: string }>(
        `insert into accounts (user_id, name, type, currency, source)
         values ($1, 'Upgrade Checking', 'depository', 'USD', 'manual') returning id`,
        [userId],
      );
      const { rows: groups } = await client.query<{ id: string }>(
        `insert into categories (user_id, name, sort_order)
         values ($1, 'Upgrade Group', 0) returning id`,
        [userId],
      );
      const { rows: leaves } = await client.query<{ id: string }>(
        `insert into categories (user_id, parent_id, name, sort_order)
         values ($1, $2, 'Upgrade Leaf', 0) returning id`,
        [userId, groups[0].id],
      );
      await client.query(
        `insert into transactions
           (user_id, account_id, category_id, category_source, category_confidence,
            category_reason, amount_minor, currency, date, description, status, source)
         values
           ($1, $2, $3, 'auto', 'low', 'legacy automatic', -100, 'USD', '2026-09-10', 'LEGACY AUTO', 'posted', 'manual'),
           ($1, $2, $3, 'user', null, null, -200, 'USD', '2026-09-10', 'LEGACY MANUAL', 'posted', 'manual'),
           ($1, $2, $3, null, null, null, -300, 'USD', '2026-09-10', 'LEGACY UNKNOWN', 'posted', 'manual')`,
        [userId, accounts[0].id, leaves[0].id],
      );
      const { rows } = await client.query<{ description: string; snapshot: Record<string, unknown> }>(
        `select description, to_jsonb(t) as snapshot
           from transactions t
          where user_id = $1
          order by description`,
        [userId],
      );
      beforeUpgrade = rows;
    });

    await withClient(baselineUrl, (client) =>
      migrate(drizzle({ client }), { migrationsFolder: MIGRATIONS }),
    );

    await withClient(urlForDb("DATABASE_URL_SUPERUSER", databaseName), async (client) => {
      const { rows } = await client.query<{
        description: string;
        snapshot: Record<string, unknown>;
        categoryRunId: string | null;
        categoryRevision: string;
      }>(
        `select description,
                to_jsonb(t) - 'category_run_id' - 'category_revision' as snapshot,
                category_run_id as "categoryRunId",
                category_revision as "categoryRevision"
           from transactions t
          where user_id = (select id from users where clerk_user_id = $1)
          order by description`,
        [userClerkId],
      );
      expect(rows).toHaveLength(3);
      expect(rows.map(({ description, snapshot }) => ({ description, snapshot }))).toEqual(beforeUpgrade);
      expect(rows.map(({ categoryRunId, categoryRevision }) => ({ categoryRunId, categoryRevision }))).toEqual(
        rows.map(() => ({ categoryRunId: null, categoryRevision: "0" })),
      );

      const { rows: tables } = await client.query<{ relname: string; relforcerowsecurity: boolean }>(
        `select c.relname, c.relforcerowsecurity
           from pg_class c join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'public' and c.relname in ('classification_runs', 'classification_proposals')
          order by c.relname`,
      );
      expect(tables).toEqual([
        { relname: "classification_proposals", relforcerowsecurity: true },
        { relname: "classification_runs", relforcerowsecurity: true },
      ]);
    });
  } finally {
    try {
      if (created) {
        await withClient(superuserUrl, (client) =>
          client.query(`drop database if exists ${escapeIdentifier(databaseName)} with (force)`),
        );
      }
    } finally {
      await rm(staging, { recursive: true, force: true });
    }
  }
});
