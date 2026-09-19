import { eq, sql } from "drizzle-orm";
import { expect, test } from "vitest";

import { EXPECTED, SEED_PERSONAS, SEED_UPCOMING_REFERENCE, SEED_USERS } from "@/db/seed/dataset";
import { seedDataset } from "@/db/seed/seed";
import { createObligation, endObligation } from "@/lib/data/obligations";
import { setRecurringStatus, upcomingOverview } from "@/lib/data/recurring";
import { matchTransfers } from "@/lib/data/transfers";
import { accounts } from "@/lib/db/schema";
import { withAuth } from "../harness/clerk";
import { adminDb } from "../harness/db";
import { anchoredAccount, provisionedUser } from "./offline-helpers";

const overviewAs = (persona: (typeof SEED_PERSONAS)[number], reference: string) =>
  withAuth(SEED_USERS[persona].clerkUserId, () => upcomingOverview(reference));

const projectionOf = (overview: Awaited<ReturnType<typeof upcomingOverview>>) => ({
  reference: overview.reference,
  trackedCount: overview.trackedCount,
  monthEnd: overview.monthEnd,
  currencies: overview.currencies,
  stale: overview.stale,
});

const demoStream = (normalizedName: string) => {
  const stream = EXPECTED.demo.recurring.find((s) => s.normalizedName === normalizedName)!;
  const { accountId, currency, direction } = stream;
  return { accountId, currency, direction, normalizedName };
};

const accountFor = (userId: string, name: string) =>
  anchoredAccount({ userId, name, type: "depository", currentMinor: 0 });

const addObligation = async (
  clerkUserId: string,
  accountId: string,
  overrides: Partial<Omit<Parameters<typeof createObligation>[0], "accountId">> = {},
) => {
  const result = await withAuth(clerkUserId, () =>
    createObligation({
      accountId,
      name: "Rent",
      amountMinor: 180000,
      currency: "USD",
      cadence: "once",
      startsOn: "2026-04-15",
      endsOn: null,
      ...overrides,
    }),
  );
  expect(result).toEqual({ obligationId: expect.any(String) });
  return (result as { obligationId: string }).obligationId;
};

test("the seeded ledgers project exactly the hand-verified upcoming month per persona", async () => {
  await seedDataset(adminDb());
  await withAuth(SEED_USERS.demo.clerkUserId, () => matchTransfers());

  for (const persona of SEED_PERSONAS) {
    expect(projectionOf(await overviewAs(persona, SEED_UPCOMING_REFERENCE))).toEqual({
      reference: SEED_UPCOMING_REFERENCE,
      trackedCount: EXPECTED[persona].recurring.length,
      ...EXPECTED[persona].upcoming,
    });
  }
});

test("a stored positive obligation projects exactly once as a negative outflow", async () => {
  const owner = await provisionedUser();
  const accountId = await accountFor(owner.id, "Checking");
  const obligationId = await addObligation(owner.clerkUserId, accountId);

  expect(
    projectionOf(await withAuth(owner.clerkUserId, () => upcomingOverview("2026-04-01"))),
  ).toEqual({
    reference: "2026-04-01",
    trackedCount: 0,
    monthEnd: "2026-04-30",
    currencies: [
      {
        currency: "USD",
        toLeaveMinor: -180000,
        toArriveMinor: 0,
        charges: [
          {
            source: "obligation",
            obligationId,
            accountId,
            currency: "USD",
            direction: "outflow",
            name: "Rent",
            cadence: "once",
            amountMinor: -180000,
            date: "2026-04-15",
            overdue: false,
            possibleOverlap: false,
          },
        ],
        deposits: [],
      },
    ],
    stale: [],
  });
});

test("the canonical exact overlap keeps, counts, and marks both sources", async () => {
  await seedDataset(adminDb());
  const streamflix = demoStream("STREAMFLIX");

  const overview = await overviewAs("demo", SEED_UPCOMING_REFERENCE);
  const [usd] = overview.currencies;
  expect(usd.toLeaveMinor).toBe(-249600);
  expect(
    usd.charges
      .filter(
        (charge) =>
          charge.accountId === streamflix.accountId &&
          charge.date === "2026-04-29" &&
          Math.abs(charge.amountMinor) === 2300,
      )
      .map((charge) => [charge.source, charge.amountMinor, charge.possibleOverlap]),
  ).toEqual([
    ["detected", -2300, true],
    ["obligation", -2300, true],
  ]);
});

test("a deposit and an obligation of equal magnitude on one account and day never overlap", async () => {
  await seedDataset(adminDb());
  const acme = demoStream("ACME CORP");
  await addObligation(SEED_USERS.demo.clerkUserId, acme.accountId, {
    name: "Payroll mirror",
    amountMinor: 250000,
    startsOn: "2026-04-27",
  });

  const overview = await overviewAs("demo", SEED_UPCOMING_REFERENCE);
  const [usd] = overview.currencies;
  expect(usd.toLeaveMinor).toBe(-499600);
  expect(usd.toArriveMinor).toBe(250000);
  expect(
    [...usd.charges, ...usd.deposits]
      .filter(
        (occurrence) =>
          occurrence.accountId === acme.accountId &&
          occurrence.date === "2026-04-27" &&
          Math.abs(occurrence.amountMinor) === 250000,
      )
      .map((occurrence) => [occurrence.source, occurrence.amountMinor, occurrence.possibleOverlap]),
  ).toEqual([
    ["obligation", -250000, false],
    ["detected", 250000, false],
  ]);
});

test("projection eligibility is scoped to retained active declarations", async () => {
  const owner = await provisionedUser();
  const neighbor = await provisionedUser();
  const activeAccountId = await accountFor(owner.id, "Active checking");
  const endedAccountId = await accountFor(owner.id, "Ended checking");
  const purgedAccountId = await accountFor(owner.id, "Purged checking");
  const neighborAccountId = await accountFor(neighbor.id, "Neighbor checking");

  await addObligation(owner.clerkUserId, activeAccountId, { name: "Owner active" });
  const endedId = await addObligation(owner.clerkUserId, endedAccountId, {
    name: "Owner ended",
  });
  await addObligation(owner.clerkUserId, purgedAccountId, { name: "Owner purged" });
  await addObligation(neighbor.clerkUserId, neighborAccountId, { name: "Neighbor active" });
  expect(await withAuth(owner.clerkUserId, () => endObligation(endedId))).toEqual({});
  expect(
    await adminDb()
      .delete(accounts)
      .where(eq(accounts.id, purgedAccountId))
      .returning({ id: accounts.id }),
  ).toEqual([{ id: purgedAccountId }]);

  const mine = await withAuth(owner.clerkUserId, () => upcomingOverview("2026-04-01"));
  const theirs = await withAuth(neighbor.clerkUserId, () => upcomingOverview("2026-04-01"));
  expect(mine.currencies.flatMap(({ charges }) => charges.map(({ name }) => name))).toEqual([
    "Owner active",
  ]);
  expect(mine.currencies[0]?.toLeaveMinor).toBe(-180000);
  expect(theirs.currencies.flatMap(({ charges }) => charges.map(({ name }) => name))).toEqual([
    "Neighbor active",
  ]);
  expect(theirs.currencies[0]?.toLeaveMinor).toBe(-180000);
});

test("management returns owned account options and only active declarations with their next dates", async () => {
  const owner = await provisionedUser();
  const neighbor = await provisionedUser();
  const checkingId = await accountFor(owner.id, "Everyday Checking");
  const savingsId = await accountFor(owner.id, "Tuition Savings");
  const neighborId = await accountFor(neighbor.id, "Neighbor Checking");

  const rentId = await addObligation(owner.clerkUserId, checkingId, {
    name: "Month-end rent",
    cadence: "monthly",
    startsOn: "2026-01-31",
    endsOn: "2026-04-30",
  });
  const tuitionId = await addObligation(owner.clerkUserId, savingsId, {
    name: "Past tuition",
    startsOn: "2026-02-01",
  });
  const endedId = await addObligation(owner.clerkUserId, checkingId, {
    name: "Ended insurance",
    startsOn: "2026-03-10",
  });
  await addObligation(neighbor.clerkUserId, neighborId, { name: "Neighbor insurance" });
  expect(await withAuth(owner.clerkUserId, () => endObligation(endedId))).toEqual({});

  const overview = await withAuth(owner.clerkUserId, () => upcomingOverview("2026-02-15"));
  expect(overview.accounts).toEqual([
    { id: checkingId, name: "Everyday Checking", currency: "USD" },
    { id: savingsId, name: "Tuition Savings", currency: "USD" },
  ]);
  expect(overview.obligations).toEqual([
    {
      id: rentId,
      accountId: checkingId,
      accountName: "Everyday Checking",
      name: "Month-end rent",
      amountMinor: 180000,
      currency: "USD",
      cadence: "monthly",
      startsOn: "2026-01-31",
      endsOn: "2026-04-30",
      nextOn: "2026-02-28",
    },
    {
      id: tuitionId,
      accountId: savingsId,
      accountName: "Tuition Savings",
      name: "Past tuition",
      amountMinor: 180000,
      currency: "USD",
      cadence: "once",
      startsOn: "2026-02-01",
      endsOn: null,
      nextOn: null,
    },
  ]);
});

test("dismissing a stream removes its projection and total; re-confirming restores them", async () => {
  await seedDataset(adminDb());
  const clerkUserId = SEED_USERS.demo.clerkUserId;
  const streamflix = demoStream("STREAMFLIX");

  await withAuth(clerkUserId, () => setRecurringStatus(streamflix, "dismissed"));
  const dismissed = await overviewAs("demo", SEED_UPCOMING_REFERENCE);
  expect(dismissed.trackedCount).toBe(1);
  expect(dismissed.currencies[0]?.toLeaveMinor).toBe(-247300);
  expect(
    dismissed.currencies[0]?.charges.map(({ source, name, possibleOverlap }) => [
      source,
      name,
      possibleOverlap,
    ]),
  ).toEqual([
    ["obligation", "Rent", false],
    ["obligation", "Tuition", false],
    ["obligation", "Streamflix", false],
  ]);
  expect(dismissed.currencies[0]?.deposits).toEqual(
    EXPECTED.demo.upcoming.currencies[0].deposits,
  );
  expect(dismissed.stale).toEqual([]);

  await withAuth(clerkUserId, () => setRecurringStatus(streamflix, "confirmed"));
  expect(projectionOf(await overviewAs("demo", SEED_UPCOMING_REFERENCE))).toEqual({
    reference: SEED_UPCOMING_REFERENCE,
    trackedCount: 2,
    ...EXPECTED.demo.upcoming,
  });
});

test("canceling a stream removes its projection and total exactly like dismissing it", async () => {
  await seedDataset(adminDb());
  const clerkUserId = SEED_USERS.demo.clerkUserId;
  const streamflix = demoStream("STREAMFLIX");

  await withAuth(clerkUserId, () => setRecurringStatus(streamflix, "canceled"));
  const canceled = await overviewAs("demo", SEED_UPCOMING_REFERENCE);
  expect(canceled.trackedCount).toBe(1);
  expect(canceled.currencies[0]?.toLeaveMinor).toBe(-247300);
  expect(canceled.currencies[0]?.charges.map(({ source, name }) => [source, name])).toEqual([
    ["obligation", "Rent"],
    ["obligation", "Tuition"],
    ["obligation", "Streamflix"],
  ]);
  expect(canceled.stale).toEqual([]);
  expect((await overviewAs("demo", "2026-09-01")).stale.map((s) => s.name)).toEqual(["Acme Corp"]);

  await withAuth(clerkUserId, () => setRecurringStatus(streamflix, "confirmed"));
  expect(projectionOf(await overviewAs("demo", SEED_UPCOMING_REFERENCE))).toEqual({
    reference: SEED_UPCOMING_REFERENCE,
    trackedCount: 2,
    ...EXPECTED.demo.upcoming,
  });
});

test("a reference after an expected date marks it overdue and still counts it", async () => {
  await seedDataset(adminDb());

  const overview = await overviewAs("demo", "2026-04-28");
  const [usd] = overview.currencies;
  expect(usd.toLeaveMinor).toBe(-249600);
  expect(usd.toArriveMinor).toBe(250000);
  expect(usd.charges.map((c) => [c.source, c.name, c.date, c.overdue])).toEqual([
    ["obligation", "Rent", "2026-04-05", true],
    ["obligation", "Tuition", "2026-04-18", true],
    ["detected", "Streamflix", "2026-04-29", false],
    ["obligation", "Streamflix", "2026-04-29", false],
  ]);
  expect(usd.deposits.map((d) => [d.name, d.date, d.overdue])).toEqual([
    ["Acme Corp", "2026-04-27", true],
  ]);
});

test("a reference far past the data goes honestly stale: no phantom months of charges", async () => {
  await seedDataset(adminDb());

  const overview = await overviewAs("demo", "2026-09-01");
  expect(overview.currencies[0]?.toLeaveMinor).toBe(-429600);
  expect(
    overview.currencies[0]?.charges.map(({ source, name, date, overdue }) => [
      source,
      name,
      date,
      overdue,
    ]),
  ).toEqual([
    ["obligation", "Tuition", "2026-04-18", true],
    ["obligation", "Rent", "2026-08-05", true],
    ["obligation", "Streamflix", "2026-08-29", true],
    ["obligation", "Rent", "2026-09-05", false],
    ["obligation", "Streamflix", "2026-09-29", false],
  ]);
  expect(overview.stale.map((s) => [s.name, s.lastDate])).toEqual([
    ["Streamflix", "2026-03-29"],
    ["Acme Corp", "2026-03-27"],
  ]);
});

test("a detected January month-end stream keeps March's anchor and both charges", async () => {
  await seedDataset(adminDb());
  await adminDb().execute(sql`
    update transactions set date = case date
      when '2026-01-29' then '2025-11-30'::date
      when '2026-02-28' then '2025-12-31'::date
      when '2026-03-29' then '2026-01-31'::date end
    where user_id = ${SEED_USERS.demo.id} and merchant = 'Streamflix'
  `);
  const overview = await overviewAs("demo", "2026-03-29");
  const [usd] = overview.currencies;
  expect(usd?.toLeaveMinor).toBe(-4600);
  expect(usd.charges.map(({ name, date, overdue }) => [name, date, overdue])).toEqual([
    ["Streamflix", "2026-02-28", true],
    ["Streamflix", "2026-03-31", false],
  ]);
  expect(overview.stale).toEqual([]);
});

test("cross-user isolation: the neighbor sees only their known insurance declaration", async () => {
  await seedDataset(adminDb());

  const theirs = await overviewAs("neighbor", "2026-04-28");
  expect(theirs.currencies).toEqual([
    {
      currency: "USD",
      toLeaveMinor: -120000,
      toArriveMinor: 0,
      charges: [
        {
          ...EXPECTED.neighbor.upcoming.currencies[0].charges[0],
          overdue: true,
        },
      ],
      deposits: [],
    },
  ]);
  expect(theirs.stale).toEqual([]);
});

test("signed-out callers are redirected before any projection work", async () => {
  await seedDataset(adminDb());
  await expect(upcomingOverview(SEED_UPCOMING_REFERENCE)).rejects.toMatchObject({
    digest: expect.stringContaining("/sign-in"),
  });
});

test("the DAL refuses a non-date reference outright", async () => {
  for (const bad of ["2026-02-30", "2026-4-1", "not-a-date", "2026-04-01T00:00:00Z", ""]) {
    await expect(
      withAuth(SEED_USERS.demo.clerkUserId, () => upcomingOverview(bad)),
    ).rejects.toThrow("real ISO date");
  }
});
