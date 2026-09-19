import { expect, test } from "vitest";

import {
  detectRecurringStreams,
  withinBand,
  type RecurringRow,
} from "@/lib/ledger/recurring-detection";
import { annualAmountMinor } from "@/lib/ledger/subscriptions";
import {
  projectUpcoming,
  type UpcomingInput,
  type UpcomingObligationInput,
} from "@/lib/ledger/upcoming";

const MAX_SAFE = Number.MAX_SAFE_INTEGER;
let sequence = 0;

const row = (date: string, amountMinor: number): RecurringRow => ({
  id: `exact-${(sequence += 1)}`,
  accountId: "acct-exact",
  amountMinor,
  currency: "USD",
  date,
  description: "EXACT STREAM",
  merchant: null,
  status: "posted",
});

const recurring = (typicalAmountMinor: bigint): UpcomingInput => ({
  accountId: "acct-exact",
  currency: "USD",
  direction: "outflow",
  normalizedName: "EXACT STREAM",
  name: "Exact stream",
  cadence: "monthly",
  typicalAmountMinor,
  lastAmountMinor: typicalAmountMinor,
  firstDate: "2026-01-31",
  lastDate: "2026-01-31",
  occurrences: 3,
  confidence: "high",
  status: "proposed",
});

const obligation = (amountMinor: number): UpcomingObligationInput => ({
  obligationId: "obligation-exact",
  accountId: "acct-exact",
  currency: "USD",
  name: "Exact obligation",
  amountMinor,
  cadence: "monthly",
  startsOn: "2026-02-28",
  endsOn: null,
  endedAt: null,
});

test("same-day recurring sums retain MAX_SAFE + 2", () => {
  const dates = ["2026-01-05", "2026-02-05", "2026-03-05"];
  const streams = detectRecurringStreams(
    dates.flatMap((date) => [row(date, MAX_SAFE), row(date, 2)]),
  );
  expect(BigInt(streams[0].typicalAmountMinor)).toBe(BigInt(MAX_SAFE) + BigInt(2));
});

test.each([
  [1, BigInt(MAX_SAFE) - BigInt(2)],
  [-1, -BigInt(MAX_SAFE) + BigInt(2)],
] as const)("recurring even median preserves truncation (%s)", (sign, expected) => {
  const streams = detectRecurringStreams([
    row("2026-01-05", sign * MAX_SAFE),
    row("2026-02-05", sign * (MAX_SAFE - 3)),
    row("2026-03-05", sign * MAX_SAFE),
    row("2026-04-05", sign * (MAX_SAFE - 3)),
  ]);
  expect(BigInt(streams[0].typicalAmountMinor)).toBe(expected);
});

test("recurring rational band keeps the exact boundary decision", () => {
  expect(withinBand(BigInt(8331659310634512), BigInt(9007199254740013), { num: 3, den: 40 })).toBe(false);
});

test("annual multiplication retains every digit beyond Number range", () => {
  const actual = annualAmountMinor({ cadence: "weekly", typicalAmountMinor: BigInt(MAX_SAFE) });
  expect(actual).toBe(BigInt("468374361246531532"));
});

test("upcoming mixed charge and obligation totals retain every digit", () => {
  const actual = projectUpcoming(
    [recurring(-BigInt(MAX_SAFE))],
    "2026-02-01",
    [obligation(2)],
  ).currencies[0].toLeaveMinor;
  expect(actual).toBe(-(BigInt(MAX_SAFE) + BigInt(2)));
});
