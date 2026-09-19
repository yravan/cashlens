import { randomUUID } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { escapeIdentifier } from "pg";
import { expect, onTestFinished, test } from "vitest";

import { assertLocalDatabaseUrl } from "@/db/seed/local-only";
import { APP_DIR, requireEnv, urlForDb, withClient } from "../harness/db";

const migrations = path.join(APP_DIR, "db/migrations");

const policiesQuery = `select tablename, policyname, roles::text[] as roles, cmd, qual, with_check
  from pg_policies where schemaname = 'public' order by tablename, policyname`;
const privilegesQuery = `select table_name, column_name, privilege_type, is_grantable
  from information_schema.column_privileges
  where grantee = 'cashlens_app' and table_schema = 'public'
  order by table_name, column_name, privilege_type`;
const snapshotsQuery = `select account_id, user_id, snapshot_day::text, current_minor::int,
  currency, source, capture_reason, observed_at, provider_as_of, created_at, updated_at
  from public.account_balance_snapshots order by account_id`;
const forceQuery = `select relname, relrowsecurity, relforcerowsecurity from pg_class
  where oid in ('public.accounts'::regclass, 'public.account_balances'::regclass,
    'public.account_balance_snapshots'::regclass) order by relname`;

test("the real owner upgrade bootstraps only usable original balances without lasting access changes", async () => {
  for (const name of ["DATABASE_URL_SUPERUSER", "DATABASE_URL_OWNER", "DATABASE_URL"]) {
    assertLocalDatabaseUrl(name, requireEnv(name));
  }
  const ownerRole = decodeURIComponent(new URL(requireEnv("DATABASE_URL_OWNER")).username);
  expect(ownerRole).toBe("cashlens_owner");
  const databaseName = `cashlens_upgrade_${randomUUID().replaceAll("-", "").slice(0, 16)}`;
  const staging = await mkdtemp(path.join(os.tmpdir(), "cashlens-balance-upgrade-"));
  try {
    const journal = JSON.parse(await readFile(path.join(migrations, "meta/_journal.json"), "utf8")) as {
      entries: { tag: string }[];
    };
    const cutoff = journal.entries.findIndex(({ tag }) => tag === "0041_certain_lyja");
    expect(cutoff).toBeGreaterThan(0);
    const entries = journal.entries.slice(0, cutoff);
    await mkdir(path.join(staging, "meta"));
    for (const { tag } of entries) {
      await copyFile(path.join(migrations, `${tag}.sql`), path.join(staging, `${tag}.sql`));
    }
    await writeFile(path.join(staging, "meta/_journal.json"), JSON.stringify({ ...journal, entries }));
    await withClient(requireEnv("DATABASE_URL_SUPERUSER"), (client) => client.query(
      `create database ${escapeIdentifier(databaseName)} owner ${escapeIdentifier(ownerRole)}`,
    ));
    onTestFinished(
      async () => {
        await withClient(requireEnv("DATABASE_URL_SUPERUSER"), (client) => client.query(
          `drop database if exists ${escapeIdentifier(databaseName)} with (force)`,
        ));
      },
      30_000,
    );
    const ownerUrl = urlForDb("DATABASE_URL_OWNER", databaseName);
    const adminUrl = urlForDb("DATABASE_URL_SUPERUSER", databaseName);
    const appUrl = urlForDb("DATABASE_URL", databaseName);
    await withClient(ownerUrl, async (client) => {
      expect((await client.query(`select current_user, rolsuper, rolbypassrls
        from pg_roles where rolname = current_user`)).rows).toEqual([
        { current_user: "cashlens_owner", rolsuper: false, rolbypassrls: false },
      ]);
      await migrate(drizzle({ client }), { migrationsFolder: staging });
    });

    await withClient(adminUrl, async (admin) => {
      const users = (await admin.query<{ id: string; clerk_user_id: string }>(
        "insert into public.users (clerk_user_id) values ($1), ($2) returning id, clerk_user_id",
        [`bootstrap_owner_${databaseName}`, `bootstrap_neighbor_${databaseName}`],
      )).rows;
      const fixtures = [
        { userId: users[0].id, source: "plaid", currency: "EUR", current: 12345, day: null },
        { userId: users[1].id, source: "manual", currency: "USD", current: 7000, day: "2026-03-30" },
        { userId: users[0].id, source: "plaid", currency: "USD", current: 0, day: null },
        { userId: users[0].id, source: "plaid", currency: "USD", current: null, day: null },
        { userId: users[0].id, source: "manual", currency: "USD", current: 5000, day: null },
        { userId: users[0].id, source: "manual", currency: "USD", current: null, day: "2026-03-30" },
        { userId: users[0].id, source: "import", currency: "USD", current: 9000, day: "2026-03-30" },
      ];
      const observedAt = new Date("2026-04-02T00:30:00Z");
      const accountIds: string[] = [];
      for (const fixture of fixtures) {
        const { rows } = await admin.query<{ id: string }>(
          `insert into public.accounts (user_id, name, type, currency, source)
           values ($1, 'Bootstrap account', 'depository', $2, $3) returning id`,
          [fixture.userId, fixture.currency, fixture.source],
        );
        accountIds.push(rows[0].id);
        await admin.query(`insert into public.account_balances
          (account_id, user_id, current_minor, available_minor, as_of, reported_on)
          values ($1, $2, $3, 99999, $4, $5)`,
        [rows[0].id, fixture.userId, fixture.current, observedAt, fixture.day]);
      }
      const projectionsBefore = (await admin.query("select * from public.account_balances order by account_id")).rows;
      const policiesBefore = (await admin.query(policiesQuery)).rows;
      const privilegesBefore = (await admin.query(privilegesQuery)).rows;
      await withClient(ownerUrl, async (client) => {
        expect((await client.query("select account_id from public.account_balances")).rows).toEqual([]);
        await client.query("set time zone 'Pacific/Honolulu'");
        await migrate(drizzle({ client }), { migrationsFolder: migrations });
      });

      const snapshots = (await admin.query(snapshotsQuery)).rows;
      expect(snapshots).toHaveLength(3);
      expect(snapshots).toEqual(expect.arrayContaining(fixtures.slice(0, 3).map((fixture, index) =>
        expect.objectContaining({
          account_id: accountIds[index], user_id: fixture.userId,
          snapshot_day: fixture.day ?? "2026-04-02", current_minor: fixture.current,
          currency: fixture.currency, source: fixture.source === "manual" ? "manual_anchor" : "provider",
          capture_reason: "bootstrap", observed_at: observedAt, provider_as_of: null,
        }),
      )));
      expect((await admin.query("select * from public.account_balances order by account_id")).rows).toEqual(projectionsBefore);
      const policiesAfter = (await admin.query(policiesQuery)).rows;
      const privilegesAfter = (await admin.query(privilegesQuery)).rows;
      expect(policiesAfter.filter(({ tablename }) => tablename !== "account_balance_snapshots")).toEqual(policiesBefore);
      expect(policiesAfter.filter(({ tablename }) => tablename === "account_balance_snapshots").map(({ roles, cmd }) => ({ roles, cmd })))
        .toEqual([{ roles: ["cashlens_app"], cmd: "INSERT" }, { roles: ["cashlens_app"], cmd: "SELECT" }, { roles: ["cashlens_app"], cmd: "UPDATE" }]);
      expect(privilegesAfter.filter(({ table_name }) => table_name !== "account_balance_snapshots")).toEqual(privilegesBefore);
      const forceAfter = (await admin.query(forceQuery)).rows;
      expect(forceAfter).toEqual([
        { relname: "account_balance_snapshots", relrowsecurity: true, relforcerowsecurity: true },
        { relname: "account_balances", relrowsecurity: true, relforcerowsecurity: true },
        { relname: "accounts", relrowsecurity: true, relforcerowsecurity: true },
      ]);
      const bootstrap = await readFile(path.join(migrations, "0042_balance_snapshot_grants.sql"), "utf8");
      await admin.query("update public.account_balances set current_minor = 54321 where account_id = $1", [accountIds[0]]);
      await withClient(ownerUrl, async (client) => {
        await migrate(drizzle({ client }), { migrationsFolder: migrations });
        await client.query(bootstrap);
        expect((await client.query("select account_id from public.account_balance_snapshots")).rows).toEqual([]);
      });
      expect((await admin.query(snapshotsQuery)).rows).toEqual(snapshots);
      expect((await admin.query(policiesQuery)).rows).toEqual(policiesAfter);
      expect((await admin.query(privilegesQuery)).rows).toEqual(privilegesAfter);
      expect((await admin.query(forceQuery)).rows).toEqual(forceAfter);

      await admin.query("update public.account_balances set current_minor = 8888 where account_id = $1", [accountIds[3]]);
      await admin.query(`create function public.test_bootstrap_failure() returns trigger language plpgsql as $$
        begin
          if (select count(*) from bootstrap_inserted) <> 1 then
            raise exception 'failure probe did not follow a real inserted observation';
          end if;
          if current_user <> 'cashlens_owner' or (
            select count(*) <> 4 or not bool_and(roles = array['cashlens_owner']::name[])
            from pg_policies where schemaname = 'public' and policyname in (
              'balance_snapshot_bootstrap_accounts', 'balance_snapshot_bootstrap_balances',
              'balance_snapshot_bootstrap_select', 'balance_snapshot_bootstrap_insert'
            )
          ) then raise exception 'bootstrap policies are not restricted to the migration owner'; end if;
          if exists (select 1 from pg_class where oid in (
            'public.accounts'::regclass, 'public.account_balances'::regclass,
            'public.account_balance_snapshots'::regclass
          ) and (not relrowsecurity or not relforcerowsecurity)) then
            raise exception 'forced isolation changed during bootstrap';
          end if;
          raise exception 'injected bootstrap failure after insert' using errcode = '23514';
        end $$;
        create trigger test_bootstrap_failure after insert on public.account_balance_snapshots
          referencing new table as bootstrap_inserted for each statement
          execute function public.test_bootstrap_failure()`);
      try {
        await withClient(ownerUrl, async (client) => {
          await expect(client.query(bootstrap)).rejects.toMatchObject({
            code: "23514", message: "injected bootstrap failure after insert",
          });
        });
        expect((await admin.query(snapshotsQuery)).rows).toEqual(snapshots);
        expect((await admin.query(policiesQuery)).rows).toEqual(policiesAfter);
        expect((await admin.query(privilegesQuery)).rows).toEqual(privilegesAfter);
        expect((await admin.query(forceQuery)).rows).toEqual(forceAfter);
      } finally {
        await admin.query(`drop trigger test_bootstrap_failure on public.account_balance_snapshots;
          drop function public.test_bootstrap_failure()`);
      }

      await withClient(appUrl, async (client) => {
        expect((await client.query(`select pg_has_role(current_user, 'cashlens_owner', 'MEMBER') as member,
          pg_has_role(current_user, 'cashlens_owner', 'USAGE') as inherits`)).rows).toEqual([{ member: false, inherits: false }]);
        await expect(client.query("set role cashlens_owner")).rejects.toMatchObject({ code: "42501" });
        expect((await client.query("select account_id from public.account_balance_snapshots")).rows).toEqual([]);
        for (const user of users) {
          await client.query("begin");
          try {
            await client.query("select set_config('app.clerk_user_id', $1, true)", [user.clerk_user_id]);
            expect((await client.query(snapshotsQuery)).rows).toEqual(snapshots.filter(({ user_id }) => user_id === user.id));
          } finally {
            await client.query("rollback");
          }
        }
      });
    });
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
});
