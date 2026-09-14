import { eq } from "drizzle-orm";
import { expect, test } from "vitest";

import { POST as streamsRoute } from "@/app/api/recurring/streams/route";
import { EXPECTED, SEED_ACCOUNTS, SEED_USERS } from "@/db/seed/dataset";
import { seedDataset } from "@/db/seed/seed";
import { recurringOverview, setRecurringStatus, type StreamIdentity } from "@/lib/data/recurring";
import { matchTransfers } from "@/lib/data/transfers";
import { chargedAfterCancel, priceIncreased } from "@/lib/ledger/subscriptions";
import { requireUser } from "@/lib/data/users";
import { withRequestScope } from "@/lib/db/client";
import { accounts, recurringStreams, transactions } from "@/lib/db/schema";
import { fakeClerkUserId, withAuth } from "../harness/clerk";
import { adminDb } from "../harness/db";

type Row = {
  account: number;
  amountMinor: number;
  date: string;
  description: string;
  merchant?: string;
  status?: "pending" | "posted";
};

async function provision(clerkUserId: string, accountCount: number, rows: Row[]) {
  const user = await withAuth(clerkUserId, () => requireUser());
  const created = await adminDb()
    .insert(accounts)
    .values(
      Array.from({ length: accountCount }, (_, i) => ({
        userId: user.id,
        name: `Probe Account ${i}`,
        type: "depository" as const,
        currency: "USD",
        source: "manual" as const,
      })),
    )
    .returning({ id: accounts.id });
  const accountIds = created.map((row) => row.id);
  if (rows.length) {
    await adminDb()
      .insert(transactions)
      .values(
        rows.map((row) => ({
          userId: user.id,
          accountId: accountIds[row.account],
          amountMinor: row.amountMinor,
          currency: "USD",
          date: row.date,
          description: row.description,
          merchant: row.merchant ?? null,
          status: row.status ?? ("posted" as const),
          source: "manual" as const,
        })),
      );
  }
  return { user, accountIds };
}

const demoStream = (normalizedName: string): StreamIdentity => {
  const stream = EXPECTED.demo.recurring.find((s) => s.normalizedName === normalizedName)!;
  const { accountId, currency, direction } = stream;
  return { accountId, currency, direction, normalizedName };
};

const decisionRows = (userId: string) =>
  adminDb()
    .select({
      accountId: recurringStreams.accountId,
      normalizedName: recurringStreams.normalizedName,
      status: recurringStreams.status,
    })
    .from(recurringStreams)
    .where(eq(recurringStreams.userId, userId))
    .orderBy(recurringStreams.normalizedName);

const postStatus = (body: unknown, headers: Record<string, string> = {}) =>
  streamsRoute(
    new Request("http://localhost/api/recurring/streams", {
      method: "POST",
      headers: { host: "localhost", "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    }),
  );

test("the seeded ledgers detect exactly the hand-verified streams, all proposed", async () => {
  await seedDataset(adminDb());
  await withAuth(SEED_USERS.demo.clerkUserId, () => matchTransfers());

  const demo = await withAuth(SEED_USERS.demo.clerkUserId, () => recurringOverview());
  expect(demo).toEqual({
    streams: EXPECTED.demo.recurring.map((stream) => ({
      ...stream,
      status: "proposed",
      decidedOn: null,
    })),
    annual: EXPECTED.demo.annual,
  });

  for (const persona of ["neighbor", "empty"] as const) {
    const theirs = await withAuth(SEED_USERS[persona].clerkUserId, () => recurringOverview());
    expect(theirs).toEqual({ streams: [], annual: [] });
  }
});

test("confirm, dismiss, and cancel persist by stream identity, one row per stream, flippable", async () => {
  const ids = await seedDataset(adminDb());
  const clerkUserId = SEED_USERS.demo.clerkUserId;
  const streamflix = demoStream("STREAMFLIX");

  expect(await withAuth(clerkUserId, () => setRecurringStatus(streamflix, "confirmed"))).toBe(true);
  const confirmed = await withAuth(clerkUserId, () => recurringOverview());
  expect(confirmed.streams.map((s) => [s.normalizedName, s.status])).toEqual([
    ["STREAMFLIX", "confirmed"],
    ["ACME CORP", "proposed"],
  ]);

  expect(await withAuth(clerkUserId, () => setRecurringStatus(streamflix, "dismissed"))).toBe(true);
  const dismissed = await withAuth(clerkUserId, () => recurringOverview());
  expect(dismissed.streams.map((s) => [s.normalizedName, s.status])).toEqual([
    ["STREAMFLIX", "dismissed"],
    ["ACME CORP", "proposed"],
  ]);

  expect(await withAuth(clerkUserId, () => setRecurringStatus(streamflix, "canceled"))).toBe(true);
  const canceled = await withAuth(clerkUserId, () => recurringOverview());
  expect(canceled.streams.map((s) => [s.normalizedName, s.status, s.decidedOn === null])).toEqual([
    ["STREAMFLIX", "canceled", false],
    ["ACME CORP", "proposed", true],
  ]);

  expect(await decisionRows(ids.demo)).toEqual([
    { accountId: streamflix.accountId, normalizedName: "STREAMFLIX", status: "canceled" },
  ]);
});

test("canceling or dismissing a stream drops its yearly cost from the totals; it's back restores it", async () => {
  await seedDataset(adminDb());
  const clerkUserId = SEED_USERS.demo.clerkUserId;
  const annual = () => withAuth(clerkUserId, async () => (await recurringOverview()).annual);
  const [usd] = EXPECTED.demo.annual;

  await withAuth(clerkUserId, () => setRecurringStatus(demoStream("STREAMFLIX"), "canceled"));
  expect(await annual()).toEqual([{ ...usd, outMinor: 0 }]);

  await withAuth(clerkUserId, () => setRecurringStatus(demoStream("STREAMFLIX"), "confirmed"));
  expect(await annual()).toEqual(EXPECTED.demo.annual);

  await withAuth(clerkUserId, () => setRecurringStatus(demoStream("ACME CORP"), "dismissed"));
  expect(await annual()).toEqual([{ ...usd, inMinor: 0 }]);
});

test("a price increase reads the detector's last kept charge against the typical amount", async () => {
  const music = (amountMinor: number, date: string) => ({
    account: 0,
    amountMinor,
    date,
    description: "MUSIC PLUS",
  });
  const hiked = fakeClerkUserId();
  await provision(hiked, 1, [
    music(-1549, "2026-01-10"),
    music(-1549, "2026-02-10"),
    music(-1549, "2026-03-10"),
    music(-1799, "2026-04-10"),
  ]);
  const [stream] = (await withAuth(hiked, () => recurringOverview())).streams;
  expect(stream).toMatchObject({
    typicalAmountMinor: -1549,
    lastAmountMinor: -1799,
    confidence: "medium",
  });
  expect(priceIncreased(stream)).toBe(true);

  const settled = fakeClerkUserId();
  await provision(settled, 1, [
    music(-1549, "2026-01-10"),
    music(-1549, "2026-02-10"),
    music(-1549, "2026-03-10"),
    music(-1799, "2026-04-10"),
    music(-1799, "2026-05-10"),
    music(-1799, "2026-06-10"),
  ]);
  const [caughtUp] = (await withAuth(settled, () => recurringOverview())).streams;
  expect(caughtUp).toMatchObject({ typicalAmountMinor: -1674, lastAmountMinor: -1799 });
  expect(priceIncreased(caughtUp)).toBe(false);
});

test("charged after cancel: the decision day is the row's own updated_at, compared strictly by day", async () => {
  const ids = await seedDataset(adminDb());
  const clerkUserId = SEED_USERS.demo.clerkUserId;
  const streamflix = demoStream("STREAMFLIX");
  await withAuth(clerkUserId, () => setRecurringStatus(streamflix, "canceled"));
  const streamflixNow = async () =>
    (await withAuth(clerkUserId, () => recurringOverview())).streams.find(
      (s) => s.normalizedName === "STREAMFLIX",
    )!;

  for (const [stampedAt, decidedOn, flagged] of [
    ["2026-03-01T12:00:00Z", "2026-03-01", true],
    ["2026-03-28T23:59:59Z", "2026-03-28", true],
    ["2026-03-29T00:00:00Z", "2026-03-29", false],
    ["2026-03-30T00:00:00Z", "2026-03-30", false],
  ] as const) {
    await adminDb()
      .update(recurringStreams)
      .set({ updatedAt: new Date(stampedAt) })
      .where(eq(recurringStreams.userId, ids.demo));
    const stream = await streamflixNow();
    expect(stream).toMatchObject({ status: "canceled", lastDate: "2026-03-29", decidedOn });
    expect(chargedAfterCancel(stream)).toBe(flagged);
  }

  const restamped = await withAuth(clerkUserId, () =>
    postStatus({ ...streamflix, status: "canceled" }),
  );
  expect(restamped.status).toBe(200);
  const [row] = await adminDb()
    .select({ updatedAt: recurringStreams.updatedAt })
    .from(recurringStreams)
    .where(eq(recurringStreams.userId, ids.demo));
  expect(row.updatedAt.getTime()).not.toBe(Date.parse("2026-03-30T00:00:00Z"));
  expect((await streamflixNow()).status).toBe("canceled");
});

test("a decision reattaches when new occurrences extend the stream", async () => {
  const ids = await seedDataset(adminDb());
  const clerkUserId = SEED_USERS.demo.clerkUserId;
  await withAuth(clerkUserId, () => setRecurringStatus(demoStream("STREAMFLIX"), "confirmed"));

  const card = SEED_ACCOUNTS.find((a) => a.name === "Cash Rewards Card")!.id;
  await adminDb().insert(transactions).values({
    userId: ids.demo,
    accountId: card,
    amountMinor: -2300,
    currency: "USD",
    date: "2026-04-29",
    description: "STREAMFLIX",
    merchant: "Streamflix",
    status: "posted",
    source: "plaid",
    sourceId: "seed-txn-recurring-4",
  });

  const overview = await withAuth(clerkUserId, () => recurringOverview());
  const streamflix = overview.streams.find((s) => s.normalizedName === "STREAMFLIX")!;
  expect(streamflix).toMatchObject({
    status: "confirmed",
    occurrences: 4,
    lastDate: "2026-04-29",
    typicalAmountMinor: -2300,
  });
});

test("true-spend law: matched transfer legs stop counting as recurring evidence", async () => {
  const clerkUserId = fakeClerkUserId();
  const dates = ["2026-01-05", "2026-02-05", "2026-03-05"];
  await provision(clerkUserId, 2, [
    ...dates.map((date) => ({ account: 0, amountMinor: -50000, date, description: "MONTHLY TRANSFER TO SAVINGS" })),
    ...dates.map((date) => ({ account: 1, amountMinor: 50000, date, description: "MONTHLY TRANSFER FROM CHECKING" })),
  ]);

  const before = await withAuth(clerkUserId, () => recurringOverview());
  expect(before.streams.map((s) => [s.direction, s.cadence, s.typicalAmountMinor])).toEqual([
    ["inflow", "monthly", 50000],
    ["outflow", "monthly", -50000],
  ]);

  await withAuth(clerkUserId, () => matchTransfers());
  const after = await withAuth(clerkUserId, () => recurringOverview());
  expect(after.streams).toEqual([]);
});

test("the route stores a decision for the signed-in user and 404s unknown streams", async () => {
  const ids = await seedDataset(adminDb());
  const clerkUserId = SEED_USERS.demo.clerkUserId;
  const acme = demoStream("ACME CORP");

  const response = await withAuth(clerkUserId, () =>
    postStatus({ ...acme, status: "confirmed" }),
  );
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ ok: true });
  expect(await decisionRows(ids.demo)).toEqual([
    { accountId: acme.accountId, normalizedName: "ACME CORP", status: "confirmed" },
  ]);

  const canceled = await withAuth(clerkUserId, () => postStatus({ ...acme, status: "canceled" }));
  expect(canceled.status).toBe(200);
  expect(await decisionRows(ids.demo)).toEqual([
    { accountId: acme.accountId, normalizedName: "ACME CORP", status: "canceled" },
  ]);

  const unknown = await withAuth(clerkUserId, () =>
    postStatus({ ...acme, normalizedName: "NO SUCH STREAM", status: "confirmed" }),
  );
  expect(unknown.status).toBe(404);
});

test("the route rejects signed-out, cross-origin, and malformed callers before any work", async () => {
  await seedDataset(adminDb());
  const acme = { ...demoStream("ACME CORP"), status: "confirmed" };

  expect((await postStatus(acme)).status).toBe(401);
  const crossOrigin = await withAuth(SEED_USERS.demo.clerkUserId, () =>
    postStatus(acme, { origin: "https://evil.example" }),
  );
  expect(crossOrigin.status).toBe(403);

  for (const bad of [
    null,
    {},
    { ...acme, accountId: "not-a-uuid" },
    { ...acme, currency: "usd" },
    { ...acme, direction: "sideways" },
    { ...acme, normalizedName: "" },
    { ...acme, normalizedName: " PADDED " },
    { ...acme, normalizedName: "X".repeat(201) },
    { ...acme, status: "maybe" },
    { ...acme, status: "cancelled" },
  ]) {
    const response = await withAuth(SEED_USERS.demo.clerkUserId, () => postStatus(bad));
    expect(response.status).toBe(400);
  }
  expect(await adminDb().$count(recurringStreams)).toBe(0);
});

test("cross-user isolation: a neighbor can neither see nor decide the demo user's streams", async () => {
  const ids = await seedDataset(adminDb());
  const clerkA = SEED_USERS.demo.clerkUserId;
  const clerkB = SEED_USERS.neighbor.clerkUserId;
  const streamflix = demoStream("STREAMFLIX");
  await withAuth(clerkA, () => setRecurringStatus(streamflix, "confirmed"));

  expect(await withAuth(clerkB, () => setRecurringStatus(streamflix, "dismissed"))).toBe(false);
  expect(await withAuth(clerkB, () => setRecurringStatus(streamflix, "canceled"))).toBe(false);
  const foreign = await withAuth(clerkB, () => postStatus({ ...streamflix, status: "dismissed" }));
  expect(foreign.status).toBe(404);
  const foreignCancel = await withAuth(clerkB, () =>
    postStatus({ ...streamflix, status: "canceled" }),
  );
  const unknownCancel = await withAuth(clerkB, () =>
    postStatus({ ...streamflix, normalizedName: "NO SUCH STREAM", status: "canceled" }),
  );
  expect(foreignCancel.status).toBe(404);
  expect(await foreignCancel.text()).toBe(await unknownCancel.text());

  const theirs = await withAuth(clerkB, () => recurringOverview());
  expect(theirs).toEqual({ streams: [], annual: [] });

  const visible = await withRequestScope(clerkB, (tx) =>
    tx.select({ id: recurringStreams.id }).from(recurringStreams),
  );
  expect(visible).toEqual([]);
  const forged = await withRequestScope(clerkB, (tx) =>
    tx
      .update(recurringStreams)
      .set({ status: "canceled" })
      .where(eq(recurringStreams.userId, ids.demo)),
  );
  expect(forged.rowCount).toBe(0);
  expect(await decisionRows(ids.demo)).toEqual([
    { accountId: streamflix.accountId, normalizedName: "STREAMFLIX", status: "confirmed" },
  ]);
});

test("the app role can neither delete decisions nor rewrite identity columns", async () => {
  const ids = await seedDataset(adminDb());
  const clerkUserId = SEED_USERS.demo.clerkUserId;
  await withAuth(clerkUserId, () => setRecurringStatus(demoStream("STREAMFLIX"), "confirmed"));
  const [row] = await adminDb()
    .select({ id: recurringStreams.id })
    .from(recurringStreams)
    .where(eq(recurringStreams.userId, ids.demo));

  await expect(
    withRequestScope(clerkUserId, (tx) =>
      tx.delete(recurringStreams).where(eq(recurringStreams.id, row.id)),
    ),
  ).rejects.toMatchObject({ cause: expect.objectContaining({ code: "42501" }) });
  await expect(
    withRequestScope(clerkUserId, (tx) =>
      tx
        .update(recurringStreams)
        .set({ normalizedName: "HIJACKED" })
        .where(eq(recurringStreams.id, row.id)),
    ),
  ).rejects.toMatchObject({ cause: expect.objectContaining({ code: "42501" }) });
});

test("purging an account cascades its stream decisions away", async () => {
  const ids = await seedDataset(adminDb());
  const clerkUserId = SEED_USERS.demo.clerkUserId;
  const streamflix = demoStream("STREAMFLIX");
  await withAuth(clerkUserId, () => setRecurringStatus(streamflix, "confirmed"));

  await adminDb().delete(accounts).where(eq(accounts.id, streamflix.accountId));

  expect(await decisionRows(ids.demo)).toEqual([]);
  const overview = await withAuth(clerkUserId, () => recurringOverview());
  expect(overview.streams.map((s) => s.normalizedName)).toEqual(["ACME CORP"]);
});
