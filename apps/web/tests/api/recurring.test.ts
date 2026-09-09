import { eq } from "drizzle-orm";
import { expect, test } from "vitest";

import { POST as streamsRoute } from "@/app/api/recurring/streams/route";
import { EXPECTED, SEED_ACCOUNTS, SEED_USERS } from "@/db/seed/dataset";
import { seedDataset } from "@/db/seed/seed";
import { recurringOverview, setRecurringStatus, type StreamIdentity } from "@/lib/data/recurring";
import { matchTransfers } from "@/lib/data/transfers";
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
  expect(demo.streams).toEqual(
    EXPECTED.demo.recurring.map((stream) => ({ ...stream, status: "proposed" })),
  );

  for (const persona of ["neighbor", "empty"] as const) {
    const theirs = await withAuth(SEED_USERS[persona].clerkUserId, () => recurringOverview());
    expect(theirs.streams).toEqual([]);
  }
});

test("confirm and dismiss persist by stream identity, one row per stream, flippable", async () => {
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

  expect(await decisionRows(ids.demo)).toEqual([
    { accountId: streamflix.accountId, normalizedName: "STREAMFLIX", status: "dismissed" },
  ]);
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
  const foreign = await withAuth(clerkB, () => postStatus({ ...streamflix, status: "dismissed" }));
  expect(foreign.status).toBe(404);

  const theirs = await withAuth(clerkB, () => recurringOverview());
  expect(theirs.streams).toEqual([]);

  const visible = await withRequestScope(clerkB, (tx) =>
    tx.select({ id: recurringStreams.id }).from(recurringStreams),
  );
  expect(visible).toEqual([]);
  const forged = await withRequestScope(clerkB, (tx) =>
    tx
      .update(recurringStreams)
      .set({ status: "dismissed" })
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
