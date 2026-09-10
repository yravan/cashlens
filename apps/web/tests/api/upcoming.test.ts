import { expect, test } from "vitest";

import { EXPECTED, SEED_PERSONAS, SEED_UPCOMING_REFERENCE, SEED_USERS } from "@/db/seed/dataset";
import { seedDataset } from "@/db/seed/seed";
import { setRecurringStatus, upcomingOverview } from "@/lib/data/recurring";
import { matchTransfers } from "@/lib/data/transfers";
import { withAuth } from "../harness/clerk";
import { adminDb } from "../harness/db";

const overviewAs = (persona: (typeof SEED_PERSONAS)[number], reference: string) =>
  withAuth(SEED_USERS[persona].clerkUserId, () => upcomingOverview(reference));

const demoStream = (normalizedName: string) => {
  const stream = EXPECTED.demo.recurring.find((s) => s.normalizedName === normalizedName)!;
  const { accountId, currency, direction } = stream;
  return { accountId, currency, direction, normalizedName };
};

test("the seeded ledgers project exactly the hand-verified upcoming month per persona", async () => {
  await seedDataset(adminDb());
  await withAuth(SEED_USERS.demo.clerkUserId, () => matchTransfers());

  for (const persona of SEED_PERSONAS) {
    expect(await overviewAs(persona, SEED_UPCOMING_REFERENCE)).toEqual({
      reference: SEED_UPCOMING_REFERENCE,
      trackedCount: EXPECTED[persona].recurring.length,
      ...EXPECTED[persona].upcoming,
    });
  }
});

test("dismissing a stream removes its projection and total; re-confirming restores them", async () => {
  await seedDataset(adminDb());
  const clerkUserId = SEED_USERS.demo.clerkUserId;
  const streamflix = demoStream("STREAMFLIX");

  await withAuth(clerkUserId, () => setRecurringStatus(streamflix, "dismissed"));
  const dismissed = await overviewAs("demo", SEED_UPCOMING_REFERENCE);
  expect(dismissed.trackedCount).toBe(1);
  expect(dismissed.currencies).toEqual([
    { ...EXPECTED.demo.upcoming.currencies[0], toLeaveMinor: 0, charges: [] },
  ]);
  expect(dismissed.stale).toEqual([]);

  await withAuth(clerkUserId, () => setRecurringStatus(streamflix, "confirmed"));
  expect(await overviewAs("demo", SEED_UPCOMING_REFERENCE)).toEqual({
    reference: SEED_UPCOMING_REFERENCE,
    trackedCount: 2,
    ...EXPECTED.demo.upcoming,
  });
});

test("a reference after an expected date marks it overdue and still counts it", async () => {
  await seedDataset(adminDb());

  const overview = await overviewAs("demo", "2026-04-28");
  const [usd] = overview.currencies;
  expect(usd.toLeaveMinor).toBe(-2300);
  expect(usd.toArriveMinor).toBe(250000);
  expect(usd.charges.map((c) => [c.name, c.date, c.overdue])).toEqual([
    ["Streamflix", "2026-04-29", false],
  ]);
  expect(usd.deposits.map((d) => [d.name, d.date, d.overdue])).toEqual([
    ["Acme Corp", "2026-04-27", true],
  ]);
});

test("a reference far past the data goes honestly stale: no phantom months of charges", async () => {
  await seedDataset(adminDb());

  const overview = await overviewAs("demo", "2026-09-01");
  expect(overview.currencies).toEqual([]);
  expect(overview.stale.map((s) => [s.name, s.lastDate])).toEqual([
    ["Streamflix", "2026-03-29"],
    ["Acme Corp", "2026-03-27"],
  ]);
});

test("cross-user isolation: the neighbor's projection knows nothing of demo streams", async () => {
  await seedDataset(adminDb());

  const theirs = await overviewAs("neighbor", "2026-04-28");
  expect(theirs.currencies).toEqual([]);
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
