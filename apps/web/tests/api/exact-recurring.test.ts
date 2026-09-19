import { expect, test } from "vitest";

import { POST } from "@/app/api/recurring/streams/route";
import { createObligation } from "@/lib/data/obligations";
import { recurringOverview, upcomingOverview } from "@/lib/data/recurring";
import { transactions } from "@/lib/db/schema";
import { withAuth } from "../harness/clerk";
import { adminDb } from "../harness/db";
import { anchoredAccount, provisionedUser, request } from "./offline-helpers";

test("persisted recurring sums stay exact through decisions, obligations, and user isolation", async () => {
  const owner = await provisionedUser();
  const neighbor = await provisionedUser();
  const accountId = await anchoredAccount({
    userId: owner.id, name: "Exact recurring", type: "depository", currentMinor: 0,
  });
  await adminDb().insert(transactions).values(
    ["2026-01-05", "2026-02-05", "2026-03-05"].flatMap((date) =>
      [-Number.MAX_SAFE_INTEGER, -2].map((amountMinor) => ({
        userId: owner.id, accountId, amountMinor, currency: "USD", date,
        description: "Exact recurring", source: "manual" as const, status: "posted" as const,
      })),
    ),
  );
  const read = () => withAuth(owner.clerkUserId, recurringOverview);
  const initial = await read();
  expect(initial.streams).toHaveLength(1);
  expect(initial.streams[0]).toMatchObject({
    typicalAmountMinor: -BigInt("9007199254740993"),
    lastAmountMinor: -BigInt("9007199254740993"),
    occurrences: 3, cadence: "monthly", confidence: "high", status: "proposed",
  });
  expect(initial.annual).toEqual([{ currency: "USD", outMinor: -BigInt("108086391056891916"), inMinor: BigInt(0) }]);

  expect(await withAuth(owner.clerkUserId, () => createObligation({
    accountId, name: "Separate fee", amountMinor: 2, currency: "USD",
    cadence: "once", startsOn: "2026-04-05", endsOn: null,
  }))).toEqual({ obligationId: expect.any(String) });
  const upcoming = await withAuth(owner.clerkUserId, () => upcomingOverview("2026-04-01"));
  expect(upcoming.currencies[0]).toMatchObject({
    currency: "USD", toLeaveMinor: -BigInt("9007199254740995"), toArriveMinor: BigInt(0),
  });
  expect(upcoming.currencies[0].charges.map(({ amountMinor, possibleOverlap }) => ({ amountMinor, possibleOverlap })))
    .toEqual([
      { amountMinor: -BigInt("9007199254740993"), possibleOverlap: false },
      { amountMinor: -BigInt(2), possibleOverlap: false },
    ]);
  const identity = { accountId, currency: "USD", direction: "outflow", normalizedName: "EXACT RECURRING" };
  const cancel = () => POST(request("http://localhost/api/recurring/streams", JSON.stringify({ ...identity, status: "canceled" })));
  expect((await withAuth(neighbor.clerkUserId, cancel)).status).toBe(404);
  expect(await withAuth(neighbor.clerkUserId, recurringOverview)).toEqual({ streams: [], annual: [] });
  expect((await withAuth(neighbor.clerkUserId, () => upcomingOverview("2026-04-01"))).currencies).toEqual([]);
  expect((await read()).streams[0].status).toBe("proposed");
  expect((await withAuth(owner.clerkUserId, cancel)).status).toBe(200);
  expect((await read()).annual).toEqual([]);
  expect((await withAuth(owner.clerkUserId, () => upcomingOverview("2026-04-01"))).currencies[0].toLeaveMinor)
    .toBe(-BigInt(2));
});
