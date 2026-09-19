import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { expect, test, vi } from "vitest";

import { POST as editRoute } from "@/app/api/obligations/[obligationId]/route";
import { POST as endRoute } from "@/app/api/obligations/[obligationId]/end/route";
import { POST as createRoute } from "@/app/api/obligations/route";
import {
  activeObligationsFor,
  createObligation,
  editObligation,
  endObligation,
} from "@/lib/data/obligations";
import { withRequestScope } from "@/lib/db/client";
import { accounts, scheduledObligations } from "@/lib/db/schema";
import { withAuth } from "../harness/clerk";
import { adminDb, urlForDb, withClient, workerDb } from "../harness/db";
import { anchoredAccount, provisionedUser } from "./offline-helpers";

const pgError = (code: string) => ({ cause: expect.objectContaining({ code }) });

type RawObligation = {
  userId: string;
  accountId: string;
  name?: string;
  amountMinor?: string;
  currency?: string;
  cadence?: string;
  startsOn?: string;
  endsOn?: string | null;
};

const insertRaw = ({
  userId,
  accountId,
  name = "Rent",
  amountMinor = "180000",
  currency = "USD",
  cadence = "monthly",
  startsOn = "2026-04-05",
  endsOn = null,
}: RawObligation) =>
  adminDb().execute(sql`
    insert into scheduled_obligations
      (user_id, account_id, name, amount_minor, currency, cadence, starts_on, ends_on)
    values
      (${userId}::uuid, ${accountId}::uuid, ${name}, ${amountMinor}::bigint,
       ${currency}, ${cadence}::scheduled_obligation_cadence,
       ${startsOn}::date, ${endsOn}::date)
    returning
      account_id::text as "accountId",
      name,
      amount_minor::text as "amountMinor",
      currency,
      cadence::text,
      starts_on::text as "startsOn",
      ends_on::text as "endsOn",
      ended_at as "endedAt"
  `);

test("scheduled obligation storage preserves the declaration and database defaults", async () => {
  const owner = await provisionedUser();
  const accountId = await anchoredAccount({
    userId: owner.id,
    name: "Checking",
    type: "depository",
    currentMinor: 0,
  });

  const result = await insertRaw({ userId: owner.id, accountId });

  expect(result.rows).toEqual([
    {
      accountId,
      name: "Rent",
      amountMinor: "180000",
      currency: "USD",
      cadence: "monthly",
      startsOn: "2026-04-05",
      endsOn: null,
      endedAt: null,
    },
  ]);
});

test("scheduled obligation constraints reject invalid financial declarations", async () => {
  const owner = await provisionedUser();
  const accountId = await anchoredAccount({
    userId: owner.id,
    name: "Checking",
    type: "depository",
    currentMinor: 0,
  });

  for (const invalid of [
    { amountMinor: "0" },
    { amountMinor: "9007199254740992" },
    { currency: "usd" },
    { name: " Rent " },
    { name: "x".repeat(201) },
    { startsOn: "2026-04-05", endsOn: "2026-04-04" },
    { cadence: "once", endsOn: "2026-04-05" },
  ]) {
    await expect(
      insertRaw({ userId: owner.id, accountId, ...invalid }),
    ).rejects.toMatchObject(pgError("23514"));
  }
});

test("the account composite foreign key rejects cross-user obligation binding", async () => {
  const owner = await provisionedUser();
  const neighbor = await provisionedUser();
  const neighborAccountId = await anchoredAccount({
    userId: neighbor.id,
    name: "Neighbor checking",
    type: "depository",
    currentMinor: 0,
  });

  await expect(
    insertRaw({ userId: owner.id, accountId: neighborAccountId }),
  ).rejects.toMatchObject(pgError("23503"));
});

const insertAs = async (
  clerkUserId: string,
  userId: string,
  accountId: string,
  name = "Rent",
) => {
  const result = await withRequestScope(clerkUserId, (tx) =>
    tx.execute(sql`
      insert into scheduled_obligations
        (user_id, account_id, name, amount_minor, currency, cadence, starts_on, ends_on)
      values
        (${userId}::uuid, ${accountId}::uuid, ${name}, 180000, 'USD', 'monthly',
         '2026-04-05', null)
      returning id::text
    `),
  );
  return result.rows as { id: string }[];
};

const obligationBody = (accountId: string) => ({
  accountId,
  name: "Rent",
  amount: "1800.00",
  currency: "USD",
  cadence: "monthly",
  startsOn: "2026-04-05",
  endsOn: null,
});

const routeRequest = (
  url: string,
  body: string,
  headers: Record<string, string> = {},
) =>
  new Request(url, {
    method: "POST",
    headers: { host: "localhost", "content-type": "application/json", ...headers },
    body,
  });

const jsonRequest = (
  url: string,
  body: unknown,
  headers: Record<string, string> = {},
) => routeRequest(url, JSON.stringify(body), headers);

const postCreate = (body: unknown, headers: Record<string, string> = {}) =>
  createRoute(jsonRequest("http://localhost/api/obligations", body, headers));

const postEdit = (
  obligationId: string,
  body: unknown,
  headers: Record<string, string> = {},
) =>
  editRoute(
    jsonRequest(`http://localhost/api/obligations/${obligationId}`, body, headers),
    { params: Promise.resolve({ obligationId }) },
  );

const postEnd = (
  obligationId: string,
  body: unknown,
  headers: Record<string, string> = {},
) =>
  endRoute(
    jsonRequest(`http://localhost/api/obligations/${obligationId}/end`, body, headers),
    { params: Promise.resolve({ obligationId }) },
  );

const responseBytes = async (response: Response) => ({
  status: response.status,
  body: await response.text(),
});

const WRITE_PAUSE_LOCK = 35_501_001;

async function withPausedObligationWrite<T>(
  start: () => Promise<T>,
  whilePaused: () => Promise<void>,
): Promise<T> {
  const databaseUrl = urlForDb("DATABASE_URL_SUPERUSER", workerDb());
  await withClient(databaseUrl, async (client) => {
    await client.query(`
      create function test_pause_obligation_write() returns trigger
      language plpgsql as $$
      begin
        if current_user = 'cashlens_app' then
          perform pg_advisory_xact_lock(${WRITE_PAUSE_LOCK});
        end if;
        return null;
      end
      $$
    `);
    await client.query(`
      create trigger test_pause_obligation_write
      before insert or update on scheduled_obligations
      for each statement execute function test_pause_obligation_write()
    `);
  });

  try {
    return await withClient(databaseUrl, async (blocker) => {
      await blocker.query("select pg_advisory_lock($1)", [WRITE_PAUSE_LOCK]);
      const outcome = start().then(
        (value) => ({ ok: true as const, value }),
        (error: unknown) => ({ ok: false as const, error }),
      );
      try {
        let waiting = false;
        for (let attempt = 0; attempt < 1_000 && !waiting; attempt += 1) {
          const result = await blocker.query<{ waiting: boolean }>(
            `select exists (
               select 1 from pg_locks
               where locktype = 'advisory'
                 and classid = 0
                 and objid = $1
                 and not granted
             ) as waiting`,
            [WRITE_PAUSE_LOCK],
          );
          waiting = result.rows[0].waiting;
        }
        expect(waiting).toBe(true);
        await whilePaused();
      } finally {
        await blocker.query("select pg_advisory_unlock($1)", [WRITE_PAUSE_LOCK]);
      }

      const settled = await outcome;
      if (!settled.ok) throw settled.error;
      return settled.value;
    });
  } finally {
    await withClient(databaseUrl, async (client) => {
      await client.query(
        "drop trigger if exists test_pause_obligation_write on scheduled_obligations",
      );
      await client.query("drop function if exists test_pause_obligation_write()");
    });
  }
}

test("scheduled obligations force RLS and raw app-role reads stay own-row", async () => {
  const catalog = await adminDb().execute(sql`
    select relrowsecurity as "rlsEnabled", relforcerowsecurity as "rlsForced"
    from pg_class
    where oid = 'scheduled_obligations'::regclass
  `);
  expect(catalog.rows).toEqual([{ rlsEnabled: true, rlsForced: true }]);

  const owner = await provisionedUser();
  const neighbor = await provisionedUser();
  const ownerAccountId = await anchoredAccount({
    userId: owner.id,
    name: "Owner checking",
    type: "depository",
    currentMinor: 0,
  });
  const neighborAccountId = await anchoredAccount({
    userId: neighbor.id,
    name: "Neighbor checking",
    type: "depository",
    currentMinor: 0,
  });
  await insertAs(owner.clerkUserId, owner.id, ownerAccountId, "Owner rent");
  await insertAs(neighbor.clerkUserId, neighbor.id, neighborAccountId, "Neighbor rent");

  const visible = await withRequestScope(owner.clerkUserId, (tx) =>
    tx.execute(sql`
      select user_id::text as "userId", name
      from scheduled_obligations
      order by name
    `),
  );
  expect(visible.rows).toEqual([{ userId: owner.id, name: "Owner rent" }]);
});

test("raw app-role updates affect only the request-scoped user's obligations", async () => {
  const owner = await provisionedUser();
  const neighbor = await provisionedUser();
  const ownerAccountId = await anchoredAccount({
    userId: owner.id,
    name: "Owner checking",
    type: "depository",
    currentMinor: 0,
  });
  const neighborAccountId = await anchoredAccount({
    userId: neighbor.id,
    name: "Neighbor checking",
    type: "depository",
    currentMinor: 0,
  });
  await insertAs(owner.clerkUserId, owner.id, ownerAccountId, "Owner rent");
  await insertAs(neighbor.clerkUserId, neighbor.id, neighborAccountId, "Neighbor rent");

  const updated = await withRequestScope(owner.clerkUserId, (tx) =>
    tx.execute(sql`
      update scheduled_obligations
      set name = 'Scoped update', updated_at = now()
    `),
  );
  expect(updated.rowCount).toBe(1);

  const visible = await withRequestScope(owner.clerkUserId, (tx) =>
    tx.execute(sql`
      select user_id::text as "userId", name
      from scheduled_obligations
    `),
  );
  expect(visible.rows).toEqual([{ userId: owner.id, name: "Scoped update" }]);

  const stored = await adminDb().execute(sql`
    select user_id::text as "userId", name
    from scheduled_obligations
    order by name
  `);
  expect(stored.rows).toEqual([
    { userId: neighbor.id, name: "Neighbor rent" },
    { userId: owner.id, name: "Scoped update" },
  ]);
});

test("the app role has only the declared scheduled-obligation write surface", async () => {
  const owner = await provisionedUser();
  const firstAccountId = await anchoredAccount({
    userId: owner.id,
    name: "Checking",
    type: "depository",
    currentMinor: 0,
  });
  const secondAccountId = await anchoredAccount({
    userId: owner.id,
    name: "Savings",
    type: "depository",
    currentMinor: 0,
  });
  const [{ id }] = await insertAs(owner.clerkUserId, owner.id, firstAccountId);

  const updated = await withRequestScope(owner.clerkUserId, (tx) =>
    tx
      .update(scheduledObligations)
      .set({
        accountId: secondAccountId,
        name: "Insurance",
        amountMinor: 240000,
        currency: "EUR",
        cadence: "annual",
        startsOn: "2026-06-30",
        endsOn: "2028-06-30",
        endedAt: new Date("2026-09-15T00:00:00Z"),
        updatedAt: sql`now()`,
      })
      .where(eq(scheduledObligations.id, id))
      .returning({ name: scheduledObligations.name }),
  );
  expect(updated).toEqual([{ name: "Insurance" }]);

  for (const set of [
    { id: randomUUID() },
    { userId: owner.id },
    { createdAt: new Date() },
  ]) {
    await expect(
      withRequestScope(owner.clerkUserId, (tx) =>
        tx.update(scheduledObligations).set(set).where(eq(scheduledObligations.id, id)),
      ),
    ).rejects.toMatchObject(pgError("42501"));
  }

  await expect(
    withRequestScope(owner.clerkUserId, (tx) =>
      tx.insert(scheduledObligations).values({
        id: randomUUID(),
        userId: owner.id,
        accountId: firstAccountId,
        name: "Tuition",
        amountMinor: 500000,
        currency: "USD",
        cadence: "once",
        startsOn: "2027-01-15",
        endsOn: null,
      }),
    ),
  ).rejects.toMatchObject(pgError("42501"));

  await expect(
    withRequestScope(owner.clerkUserId, (tx) =>
      tx.delete(scheduledObligations).where(eq(scheduledObligations.id, id)),
    ),
  ).rejects.toMatchObject(pgError("42501"));
});

test("create stores an active obligation for the signed-in owner's account", async () => {
  const owner = await provisionedUser();
  const accountId = await anchoredAccount({
    userId: owner.id,
    name: "Checking",
    type: "depository",
    currentMinor: 0,
  });

  const result = await withAuth(owner.clerkUserId, () =>
    createObligation({
      accountId,
      name: "Rent",
      amountMinor: 180000,
      currency: "USD",
      cadence: "monthly",
      startsOn: "2026-04-05",
      endsOn: null,
    }),
  );
  expect(result).toEqual({ obligationId: expect.any(String) });

  const [stored] = await adminDb()
    .select()
    .from(scheduledObligations)
    .where(eq(scheduledObligations.id, (result as { obligationId: string }).obligationId));
  expect(stored).toMatchObject({
    userId: owner.id,
    accountId,
    name: "Rent",
    amountMinor: 180000,
    currency: "USD",
    cadence: "monthly",
    startsOn: "2026-04-05",
    endsOn: null,
    endedAt: null,
  });
});

test("create makes malformed, unknown, and cross-user account ids indistinguishable", async () => {
  const owner = await provisionedUser();
  const neighbor = await provisionedUser();
  const neighborAccountId = await anchoredAccount({
    userId: neighbor.id,
    name: "Neighbor checking",
    type: "depository",
    currentMinor: 0,
  });
  const createFor = async (accountId: string) => {
    try {
      return await withAuth(owner.clerkUserId, () =>
        createObligation({
          accountId,
          name: "Rent",
          amountMinor: 180000,
          currency: "USD",
          cadence: "monthly",
          startsOn: "2026-04-05",
          endsOn: null,
        }),
      );
    } catch {
      return "threw";
    }
  };

  expect(
    await Promise.all([createFor("not-a-uuid"), createFor(randomUUID()), createFor(neighborAccountId)]),
  ).toEqual([
    { error: "account_not_found" },
    { error: "account_not_found" },
    { error: "account_not_found" },
  ]);
});

test("create sanitizes an account purge between ownership resolution and insert", async () => {
  const owner = await provisionedUser();
  const accountId = await anchoredAccount({
    userId: owner.id,
    name: "Checking",
    type: "depository",
    currentMinor: 0,
  });

  const result = await withPausedObligationWrite(
    () =>
      withAuth(owner.clerkUserId, () =>
        createObligation({
          accountId,
          name: "Rent",
          amountMinor: 180000,
          currency: "USD",
          cadence: "monthly",
          startsOn: "2026-04-05",
          endsOn: null,
        }),
      ),
    async () => {
      const deleted = await adminDb()
        .delete(accounts)
        .where(eq(accounts.id, accountId))
        .returning({ id: accounts.id });
      expect(deleted).toEqual([{ id: accountId }]);
    },
  );

  expect(result).toEqual({ error: "account_not_found" });
});

test("edit replaces every schedule field while the obligation is active", async () => {
  const owner = await provisionedUser();
  const originalAccountId = await anchoredAccount({
    userId: owner.id,
    name: "Checking",
    type: "depository",
    currentMinor: 0,
  });
  const targetAccountId = await anchoredAccount({
    userId: owner.id,
    name: "Savings",
    type: "depository",
    currentMinor: 0,
  });
  const created = await withAuth(owner.clerkUserId, () =>
    createObligation({
      accountId: originalAccountId,
      name: "Rent",
      amountMinor: 180000,
      currency: "USD",
      cadence: "monthly",
      startsOn: "2026-04-05",
      endsOn: null,
    }),
  );
  const obligationId = (created as { obligationId: string }).obligationId;

  const result = await withAuth(owner.clerkUserId, () =>
    editObligation(obligationId, {
      accountId: targetAccountId,
      name: "Insurance",
      amountMinor: 240000,
      currency: "EUR",
      cadence: "annual",
      startsOn: "2026-06-30",
      endsOn: "2028-06-30",
    }),
  );
  expect(result).toEqual({});

  const [stored] = await adminDb()
    .select()
    .from(scheduledObligations)
    .where(eq(scheduledObligations.id, obligationId));
  expect(stored).toMatchObject({
    userId: owner.id,
    accountId: targetAccountId,
    name: "Insurance",
    amountMinor: 240000,
    currency: "EUR",
    cadence: "annual",
    startsOn: "2026-06-30",
    endsOn: "2028-06-30",
    endedAt: null,
  });
});

test("edit makes malformed, unknown, ended, and cross-user obligations unavailable", async () => {
  const owner = await provisionedUser();
  const neighbor = await provisionedUser();
  const ownerAccountId = await anchoredAccount({
    userId: owner.id,
    name: "Owner checking",
    type: "depository",
    currentMinor: 0,
  });
  const neighborAccountId = await anchoredAccount({
    userId: neighbor.id,
    name: "Neighbor checking",
    type: "depository",
    currentMinor: 0,
  });
  const [{ id: endedId }] = await insertAs(
    owner.clerkUserId,
    owner.id,
    ownerAccountId,
  );
  const [{ id: neighborId }] = await insertAs(
    neighbor.clerkUserId,
    neighbor.id,
    neighborAccountId,
  );
  const endedAt = new Date("2026-09-15T01:00:00Z");
  await adminDb()
    .update(scheduledObligations)
    .set({ endedAt })
    .where(eq(scheduledObligations.id, endedId));
  const input: Parameters<typeof editObligation>[1] = {
    accountId: ownerAccountId,
    name: "Changed",
    amountMinor: 200000,
    currency: "USD",
    cadence: "monthly",
    startsOn: "2026-05-05",
    endsOn: null,
  };
  const editFor = async (obligationId: string) => {
    try {
      return await withAuth(owner.clerkUserId, () => editObligation(obligationId, input));
    } catch {
      return "threw";
    }
  };

  expect(
    await Promise.all([
      editFor("not-a-uuid"),
      editFor(randomUUID()),
      editFor(endedId),
      editFor(neighborId),
    ]),
  ).toEqual([
    { error: "obligation_not_found" },
    { error: "obligation_not_found" },
    { error: "obligation_not_found" },
    { error: "obligation_not_found" },
  ]);

  const [ended] = await adminDb()
    .select({ name: scheduledObligations.name, endedAt: scheduledObligations.endedAt })
    .from(scheduledObligations)
    .where(eq(scheduledObligations.id, endedId));
  expect(ended).toEqual({ name: "Rent", endedAt });
});

test("edit resolves obligation identity before indistinguishable target account identity", async () => {
  const owner = await provisionedUser();
  const neighbor = await provisionedUser();
  const ownerAccountId = await anchoredAccount({
    userId: owner.id,
    name: "Owner checking",
    type: "depository",
    currentMinor: 0,
  });
  const neighborAccountId = await anchoredAccount({
    userId: neighbor.id,
    name: "Neighbor checking",
    type: "depository",
    currentMinor: 0,
  });
  const [{ id: activeId }] = await insertAs(
    owner.clerkUserId,
    owner.id,
    ownerAccountId,
  );
  const [{ id: endedId }] = await insertAs(
    owner.clerkUserId,
    owner.id,
    ownerAccountId,
    "Ended rent",
  );
  await adminDb()
    .update(scheduledObligations)
    .set({ endedAt: new Date("2026-09-15T01:00:00Z") })
    .where(eq(scheduledObligations.id, endedId));
  const editFor = async (obligationId: string, accountId: string) => {
    try {
      return await withAuth(owner.clerkUserId, () =>
        editObligation(obligationId, {
          accountId,
          name: "Insurance",
          amountMinor: 240000,
          currency: "USD",
          cadence: "annual",
          startsOn: "2026-06-30",
          endsOn: null,
        }),
      );
    } catch {
      return "threw";
    }
  };

  expect(
    await Promise.all([
      editFor(activeId, "not-a-uuid"),
      editFor(activeId, randomUUID()),
      editFor(activeId, neighborAccountId),
    ]),
  ).toEqual([
    { error: "account_not_found" },
    { error: "account_not_found" },
    { error: "account_not_found" },
  ]);
  expect(await editFor(randomUUID(), "not-a-uuid")).toEqual({
    error: "obligation_not_found",
  });
  expect(await editFor(endedId, "not-a-uuid")).toEqual({
    error: "obligation_not_found",
  });
});

test("edit sanitizes a target account purge between ownership resolution and update", async () => {
  const owner = await provisionedUser();
  const originalAccountId = await anchoredAccount({
    userId: owner.id,
    name: "Checking",
    type: "depository",
    currentMinor: 0,
  });
  const targetAccountId = await anchoredAccount({
    userId: owner.id,
    name: "Savings",
    type: "depository",
    currentMinor: 0,
  });
  const [{ id: obligationId }] = await insertAs(
    owner.clerkUserId,
    owner.id,
    originalAccountId,
  );

  const result = await withPausedObligationWrite(
    () =>
      withAuth(owner.clerkUserId, () =>
        editObligation(obligationId, {
          accountId: targetAccountId,
          name: "Insurance",
          amountMinor: 240000,
          currency: "USD",
          cadence: "annual",
          startsOn: "2026-06-30",
          endsOn: null,
        }),
      ).catch(() => "threw" as const),
    async () => {
      const deleted = await adminDb()
        .delete(accounts)
        .where(eq(accounts.id, targetAccountId))
        .returning({ id: accounts.id });
      expect(deleted).toEqual([{ id: targetAccountId }]);
    },
  );

  expect(result).toEqual({ error: "account_not_found" });
});

test("edit cannot revive an obligation ended after validation", async () => {
  const owner = await provisionedUser();
  const accountId = await anchoredAccount({
    userId: owner.id,
    name: "Checking",
    type: "depository",
    currentMinor: 0,
  });
  const [{ id: obligationId }] = await insertAs(
    owner.clerkUserId,
    owner.id,
    accountId,
  );
  const endedAt = new Date("2026-09-15T02:00:00Z");

  const result = await withPausedObligationWrite(
    () =>
      withAuth(owner.clerkUserId, () =>
        editObligation(obligationId, {
          accountId,
          name: "Changed rent",
          amountMinor: 200000,
          currency: "USD",
          cadence: "monthly",
          startsOn: "2026-05-05",
          endsOn: null,
        }),
      ).catch(() => "threw" as const),
    async () => {
      const ended = await adminDb()
        .update(scheduledObligations)
        .set({ endedAt })
        .where(eq(scheduledObligations.id, obligationId))
        .returning({ id: scheduledObligations.id });
      expect(ended).toEqual([{ id: obligationId }]);
    },
  );

  expect(result).toEqual({ error: "obligation_not_found" });
  const [stored] = await adminDb()
    .select({
      name: scheduledObligations.name,
      amountMinor: scheduledObligations.amountMinor,
      startsOn: scheduledObligations.startsOn,
      endedAt: scheduledObligations.endedAt,
    })
    .from(scheduledObligations)
    .where(eq(scheduledObligations.id, obligationId));
  expect(stored).toEqual({
    name: "Rent",
    amountMinor: 180000,
    startsOn: "2026-04-05",
    endedAt,
  });
});

test("end stamps an active obligation once and preserves the first end on retry", async () => {
  const owner = await provisionedUser();
  const accountId = await anchoredAccount({
    userId: owner.id,
    name: "Checking",
    type: "depository",
    currentMinor: 0,
  });
  const [{ id: obligationId }] = await insertAs(
    owner.clerkUserId,
    owner.id,
    accountId,
  );
  const first = await withAuth(owner.clerkUserId, () => endObligation(obligationId));
  expect(first).toEqual({});

  const [firstStored] = await adminDb()
    .select({
      endedAt: scheduledObligations.endedAt,
      updatedAt: scheduledObligations.updatedAt,
    })
    .from(scheduledObligations)
    .where(eq(scheduledObligations.id, obligationId));
  expect(firstStored.endedAt).toBeInstanceOf(Date);

  expect(await withAuth(owner.clerkUserId, () => endObligation(obligationId))).toEqual({});
  const [retried] = await adminDb()
    .select({
      endedAt: scheduledObligations.endedAt,
      updatedAt: scheduledObligations.updatedAt,
    })
    .from(scheduledObligations)
    .where(eq(scheduledObligations.id, obligationId));
  expect(retried).toEqual(firstStored);
});

test("end makes malformed, unknown, and cross-user obligations unavailable", async () => {
  const owner = await provisionedUser();
  const neighbor = await provisionedUser();
  const neighborAccountId = await anchoredAccount({
    userId: neighbor.id,
    name: "Neighbor checking",
    type: "depository",
    currentMinor: 0,
  });
  const [{ id: neighborObligationId }] = await insertAs(
    neighbor.clerkUserId,
    neighbor.id,
    neighborAccountId,
  );
  const endFor = async (obligationId: string) => {
    try {
      return await withAuth(owner.clerkUserId, () => endObligation(obligationId));
    } catch {
      return "threw";
    }
  };

  expect(
    await Promise.all([
      endFor("not-a-uuid"),
      endFor(randomUUID()),
      endFor(neighborObligationId),
    ]),
  ).toEqual([
    { error: "obligation_not_found" },
    { error: "obligation_not_found" },
    { error: "obligation_not_found" },
  ]);

  const [neighborStored] = await adminDb()
    .select({ endedAt: scheduledObligations.endedAt })
    .from(scheduledObligations)
    .where(eq(scheduledObligations.id, neighborObligationId));
  expect(neighborStored).toEqual({ endedAt: null });
});

test("active obligation reads return only the owner's non-ended declarations", async () => {
  const owner = await provisionedUser();
  const neighbor = await provisionedUser();
  const ownerAccountId = await anchoredAccount({
    userId: owner.id,
    name: "Owner checking",
    type: "depository",
    currentMinor: 0,
  });
  const neighborAccountId = await anchoredAccount({
    userId: neighbor.id,
    name: "Neighbor checking",
    type: "depository",
    currentMinor: 0,
  });
  const [{ id: activeId }] = await insertAs(
    owner.clerkUserId,
    owner.id,
    ownerAccountId,
  );
  const [{ id: endedId }] = await insertAs(
    owner.clerkUserId,
    owner.id,
    ownerAccountId,
    "Ended rent",
  );
  await withAuth(owner.clerkUserId, () => endObligation(endedId));
  await insertAs(neighbor.clerkUserId, neighbor.id, neighborAccountId, "Neighbor rent");

  const result = await withRequestScope(owner.clerkUserId, (tx) =>
    activeObligationsFor(tx, owner.id),
  );
  expect(result).toEqual([
    {
      obligationId: activeId,
      accountId: ownerAccountId,
      name: "Rent",
      amountMinor: 180000,
      currency: "USD",
      cadence: "monthly",
      startsOn: "2026-04-05",
      endsOn: null,
      endedAt: null,
    },
  ]);
});

test("purging an account cascades its scheduled obligations", async () => {
  const owner = await provisionedUser();
  const accountId = await anchoredAccount({
    userId: owner.id,
    name: "Checking",
    type: "depository",
    currentMinor: 0,
  });
  const [{ id: obligationId }] = await insertAs(
    owner.clerkUserId,
    owner.id,
    accountId,
  );

  let deletion: { id: string }[] | "blocked";
  try {
    deletion = await adminDb()
      .delete(accounts)
      .where(eq(accounts.id, accountId))
      .returning({ id: accounts.id });
  } catch {
    deletion = "blocked";
  }
  expect(deletion).toEqual([{ id: accountId }]);
  expect(
    await adminDb()
      .select({ id: scheduledObligations.id })
      .from(scheduledObligations)
      .where(eq(scheduledObligations.id, obligationId)),
  ).toEqual([]);
  expect(
    await withRequestScope(owner.clerkUserId, (tx) => activeObligationsFor(tx, owner.id)),
  ).toEqual([]);
});

test("the obligation routes create, fully replace, and end a declaration", async () => {
  const owner = await provisionedUser();
  const checkingId = await anchoredAccount({
    userId: owner.id,
    name: "Checking",
    type: "depository",
    currentMinor: 0,
  });
  const savingsId = await anchoredAccount({
    userId: owner.id,
    name: "Savings",
    type: "depository",
    currentMinor: 0,
  });

  const created = await withAuth(owner.clerkUserId, () =>
    postCreate({ ...obligationBody(checkingId), name: "  Rent  " }),
  );
  expect(created.status).toBe(201);
  const { obligationId } = (await created.json()) as { obligationId: string };
  expect(obligationId).toEqual(expect.any(String));

  expect(
    await responseBytes(
      await withAuth(owner.clerkUserId, () =>
        postEdit(obligationId, {
          accountId: savingsId,
          name: "Insurance",
          amount: "2400.00",
          currency: "EUR",
          cadence: "annual",
          startsOn: "2026-06-30",
          endsOn: "2028-06-30",
        }),
      ),
    ),
  ).toEqual({ status: 200, body: "{}" });

  const [edited] = await adminDb()
    .select()
    .from(scheduledObligations)
    .where(eq(scheduledObligations.id, obligationId));
  expect(edited).toMatchObject({
    userId: owner.id,
    accountId: savingsId,
    name: "Insurance",
    amountMinor: 240000,
    currency: "EUR",
    cadence: "annual",
    startsOn: "2026-06-30",
    endsOn: "2028-06-30",
    endedAt: null,
  });

  expect(
    await responseBytes(await withAuth(owner.clerkUserId, () => postEnd(obligationId, {}))),
  ).toEqual({ status: 200, body: "{}" });
  const [firstEnd] = await adminDb()
    .select({
      endedAt: scheduledObligations.endedAt,
      updatedAt: scheduledObligations.updatedAt,
    })
    .from(scheduledObligations)
    .where(eq(scheduledObligations.id, obligationId));
  expect(firstEnd.endedAt).toBeInstanceOf(Date);

  expect(
    await responseBytes(await withAuth(owner.clerkUserId, () => postEnd(obligationId, {}))),
  ).toEqual({ status: 200, body: "{}" });
  const [retried] = await adminDb()
    .select({
      endedAt: scheduledObligations.endedAt,
      updatedAt: scheduledObligations.updatedAt,
    })
    .from(scheduledObligations)
    .where(eq(scheduledObligations.id, obligationId));
  expect(retried).toEqual(firstEnd);
});

test("create route enforces 401 then 403 then 400 before account identity", async () => {
  const owner = await provisionedUser();
  const neighbor = await provisionedUser();
  const neighborAccountId = await anchoredAccount({
    userId: neighbor.id,
    name: "Neighbor checking",
    type: "depository",
    currentMinor: 0,
  });
  const malformed = routeRequest(
    "http://localhost/api/obligations",
    "{",
    { origin: "https://evil.example" },
  );

  expect(await responseBytes(await createRoute(malformed.clone()))).toEqual({
    status: 401,
    body: '{"error":"unauthorized"}',
  });
  expect(
    await responseBytes(
      await withAuth(owner.clerkUserId, () => createRoute(malformed.clone())),
    ),
  ).toEqual({ status: 403, body: '{"error":"cross_origin"}' });
  expect(
    await responseBytes(
      await withAuth(owner.clerkUserId, () =>
        createRoute(routeRequest("http://localhost/api/obligations", "{")),
      ),
    ),
  ).toEqual({ status: 400, body: '{"error":"invalid_request"}' });
  expect(
    await responseBytes(
      await withAuth(owner.clerkUserId, () =>
        postCreate({ ...obligationBody(neighborAccountId), extra: true }),
      ),
    ),
  ).toEqual({ status: 400, body: '{"error":"invalid_request"}' });
  expect(
    await responseBytes(
      await withAuth(owner.clerkUserId, () => postCreate(obligationBody(neighborAccountId))),
    ),
  ).toEqual({ status: 404, body: '{"error":"account_not_found"}' });
  expect(await adminDb().$count(scheduledObligations, eq(scheduledObligations.userId, owner.id))).toBe(0);
});

test("edit route resolves request and obligation identity before account identity", async () => {
  const owner = await provisionedUser();
  const neighbor = await provisionedUser();
  const ownerAccountId = await anchoredAccount({
    userId: owner.id,
    name: "Owner checking",
    type: "depository",
    currentMinor: 0,
  });
  const neighborAccountId = await anchoredAccount({
    userId: neighbor.id,
    name: "Neighbor checking",
    type: "depository",
    currentMinor: 0,
  });
  const [{ id: activeId }] = await insertAs(owner.clerkUserId, owner.id, ownerAccountId);
  const [{ id: endedId }] = await insertAs(owner.clerkUserId, owner.id, ownerAccountId, "Ended rent");
  const [{ id: neighborId }] = await insertAs(
    neighbor.clerkUserId,
    neighbor.id,
    neighborAccountId,
  );
  await withAuth(owner.clerkUserId, () => endObligation(endedId));
  const valid = obligationBody("not-a-uuid");
  const badCallerRequest = jsonRequest(
    `http://localhost/api/obligations/${activeId}`,
    { extra: true },
    { origin: "https://evil.example" },
  );

  expect(
    await responseBytes(
      await editRoute(badCallerRequest.clone(), {
        params: Promise.resolve({ obligationId: activeId }),
      }),
    ),
  ).toEqual({ status: 401, body: '{"error":"unauthorized"}' });
  expect(
    await responseBytes(
      await withAuth(owner.clerkUserId, () =>
        editRoute(badCallerRequest.clone(), {
          params: Promise.resolve({ obligationId: activeId }),
        }),
      ),
    ),
  ).toEqual({ status: 403, body: '{"error":"cross_origin"}' });
  expect(
    await responseBytes(
      await withAuth(owner.clerkUserId, () => postEdit("not-a-uuid", { extra: true })),
    ),
  ).toEqual({ status: 400, body: '{"error":"invalid_request"}' });

  const obligationMissing = { status: 404, body: '{"error":"obligation_not_found"}' };
  for (const obligationId of ["not-a-uuid", randomUUID(), endedId, neighborId]) {
    expect(
      await responseBytes(
        await withAuth(owner.clerkUserId, () => postEdit(obligationId, valid)),
      ),
    ).toEqual(obligationMissing);
  }

  const accountMissing = { status: 404, body: '{"error":"account_not_found"}' };
  for (const accountId of ["not-a-uuid", randomUUID(), neighborAccountId]) {
    expect(
      await responseBytes(
        await withAuth(owner.clerkUserId, () =>
          postEdit(activeId, obligationBody(accountId)),
        ),
      ),
    ).toEqual(accountMissing);
  }
  const [active] = await adminDb()
    .select({ name: scheduledObligations.name, accountId: scheduledObligations.accountId })
    .from(scheduledObligations)
    .where(eq(scheduledObligations.id, activeId));
  expect(active).toEqual({ name: "Rent", accountId: ownerAccountId });
});

test("end route enforces request validation before isolated obligation identity", async () => {
  const owner = await provisionedUser();
  const neighbor = await provisionedUser();
  const ownerAccountId = await anchoredAccount({
    userId: owner.id,
    name: "Owner checking",
    type: "depository",
    currentMinor: 0,
  });
  const neighborAccountId = await anchoredAccount({
    userId: neighbor.id,
    name: "Neighbor checking",
    type: "depository",
    currentMinor: 0,
  });
  const [{ id: ownerId }] = await insertAs(owner.clerkUserId, owner.id, ownerAccountId);
  const [{ id: neighborId }] = await insertAs(
    neighbor.clerkUserId,
    neighbor.id,
    neighborAccountId,
  );
  const badCallerRequest = jsonRequest(
    `http://localhost/api/obligations/${ownerId}/end`,
    { extra: true },
    { origin: "https://evil.example" },
  );

  expect(
    await responseBytes(
      await endRoute(badCallerRequest.clone(), {
        params: Promise.resolve({ obligationId: ownerId }),
      }),
    ),
  ).toEqual({ status: 401, body: '{"error":"unauthorized"}' });
  expect(
    await responseBytes(
      await withAuth(owner.clerkUserId, () =>
        endRoute(badCallerRequest.clone(), {
          params: Promise.resolve({ obligationId: ownerId }),
        }),
      ),
    ),
  ).toEqual({ status: 403, body: '{"error":"cross_origin"}' });
  expect(
    await responseBytes(
      await withAuth(owner.clerkUserId, () => postEnd("not-a-uuid", { extra: true })),
    ),
  ).toEqual({ status: 400, body: '{"error":"invalid_request"}' });

  const notFound = { status: 404, body: '{"error":"obligation_not_found"}' };
  for (const obligationId of ["not-a-uuid", randomUUID(), neighborId]) {
    expect(
      await responseBytes(
        await withAuth(owner.clerkUserId, () => postEnd(obligationId, {})),
      ),
    ).toEqual(notFound);
  }
  const [neighborStored] = await adminDb()
    .select({ endedAt: scheduledObligations.endedAt })
    .from(scheduledObligations)
    .where(eq(scheduledObligations.id, neighborId));
  expect(neighborStored).toEqual({ endedAt: null });
});

test("all obligation routes sanitize unexpected database failures", async () => {
  const owner = await provisionedUser();
  const accountId = await anchoredAccount({
    userId: owner.id,
    name: "Checking",
    type: "depository",
    currentMinor: 0,
  });
  const [{ id: obligationId }] = await insertAs(owner.clerkUserId, owner.id, accountId);
  await adminDb().execute(sql`
    create function test_reject_obligation_write() returns trigger
    language plpgsql as $$
    begin
      raise exception 'PRIVATE Rent 1800.00';
    end
    $$
  `);
  await adminDb().execute(sql`
    create trigger test_reject_obligation_write
    before insert or update on scheduled_obligations
    for each statement execute function test_reject_obligation_write()
  `);

  const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
  try {
    const serverError = { status: 500, body: '{"error":"server_error"}' };
    expect(
      await responseBytes(
        await withAuth(owner.clerkUserId, () => postCreate(obligationBody(accountId))),
      ),
    ).toEqual(serverError);
    expect(
      await responseBytes(
        await withAuth(owner.clerkUserId, () =>
          postEdit(obligationId, obligationBody(accountId)),
        ),
      ),
    ).toEqual(serverError);
    expect(
      await responseBytes(
        await withAuth(owner.clerkUserId, () => postEnd(obligationId, {})),
      ),
    ).toEqual(serverError);

    const logs = info.mock.calls.map(([line]) => line);
    expect(logs).toEqual([
      JSON.stringify({
        event: "obligation_mutation.run_failed",
        errorClass: "DatabaseQueryError",
      }),
      JSON.stringify({
        event: "obligation_mutation.run_failed",
        errorClass: "DatabaseQueryError",
      }),
      JSON.stringify({
        event: "obligation_mutation.run_failed",
        errorClass: "DatabaseQueryError",
      }),
    ]);
    expect(logs.join("\n")).not.toMatch(/PRIVATE|Rent|1800\.00/);
  } finally {
    info.mockRestore();
    await adminDb().execute(sql`
      drop trigger if exists test_reject_obligation_write on scheduled_obligations
    `);
    await adminDb().execute(sql`drop function if exists test_reject_obligation_write()`);
  }

  const stored = await adminDb()
    .select({ id: scheduledObligations.id, name: scheduledObligations.name })
    .from(scheduledObligations)
    .where(eq(scheduledObligations.id, obligationId));
  expect(stored).toEqual([{ id: obligationId, name: "Rent" }]);
});
