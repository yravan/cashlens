import { expect, test } from "vitest";

import type { RecurringCadence, RecurringDirection } from "@/lib/ledger/recurring-detection";
import {
  annualAmountMinor,
  annualTotals,
  chargedAfterCancel,
  CYCLES_PER_YEAR,
  priceIncreased,
  tracked,
  type StreamStatus,
} from "@/lib/ledger/subscriptions";

type Stream = {
  currency: string;
  direction: RecurringDirection;
  cadence: RecurringCadence;
  typicalAmountMinor: bigint;
  lastAmountMinor: bigint;
  status: StreamStatus;
};

const stream = (over: Partial<Stream> = {}): Stream => ({
  currency: "USD",
  direction: "outflow",
  cadence: "monthly",
  typicalAmountMinor: -BigInt(2300),
  lastAmountMinor: -BigInt(2300),
  status: "proposed",
  ...over,
});

const STATUSES: StreamStatus[] = ["proposed", "confirmed", "dismissed", "canceled"];

test("to review and confirmed streams are tracked; dismissed and canceled are not", () => {
  expect(STATUSES.map(tracked)).toEqual([true, true, false, false]);
});

test("yearly cost is the typical amount times the cycles in a year, sign preserved", () => {
  expect(CYCLES_PER_YEAR).toEqual({ weekly: 52, biweekly: 26, monthly: 12, annual: 1 });
  expect(annualAmountMinor(stream({ cadence: "weekly", typicalAmountMinor: -BigInt(1500) }))).toBe(-BigInt(78000));
  expect(annualAmountMinor(stream({ cadence: "biweekly", typicalAmountMinor: BigInt(250000) }))).toBe(BigInt(6500000));
  expect(annualAmountMinor(stream({ cadence: "monthly", typicalAmountMinor: -BigInt(2300) }))).toBe(-BigInt(27600));
  expect(annualAmountMinor(stream({ cadence: "annual", typicalAmountMinor: -BigInt(9999) }))).toBe(-BigInt(9999));
});

test("yearly totals split per currency with charges and deposits apart, never netted or converted", () => {
  const totals = annualTotals([
    stream(),
    stream({ direction: "inflow", typicalAmountMinor: BigInt(250000), status: "confirmed" }),
    stream({ currency: "EUR", cadence: "annual", typicalAmountMinor: -BigInt(9999), status: "confirmed" }),
    stream({ cadence: "weekly", typicalAmountMinor: -BigInt(1500), status: "confirmed" }),
  ]);
  expect(totals).toEqual([
    { currency: "EUR", outMinor: -BigInt(9999), inMinor: BigInt(0) },
    { currency: "USD", outMinor: -BigInt(105600), inMinor: BigInt(3000000) },
  ]);
});

test("canceled and dismissed streams leave the yearly totals; nothing tracked totals nothing", () => {
  const canceled = stream({ typicalAmountMinor: -BigInt(5000), status: "canceled" });
  const dismissed = stream({ direction: "inflow", typicalAmountMinor: BigInt(250000), status: "dismissed" });
  expect(annualTotals([stream(), canceled, dismissed])).toEqual([
    { currency: "USD", outMinor: -BigInt(27600), inMinor: BigInt(0) },
  ]);
  expect(annualTotals([canceled, dismissed])).toEqual([]);
  expect(annualTotals([])).toEqual([]);
});

test.each([
  ["outflow", -BigInt(2300), -BigInt(2472), false],
  ["outflow", -BigInt(2300), -BigInt(2473), true],
  ["outflow", -BigInt(4000), -BigInt(4300), false],
  ["outflow", -BigInt(4000), -BigInt(4301), true],
  ["outflow", -BigInt(2300), -BigInt(2599), true],
  ["outflow", -BigInt(2300), -BigInt(2300), false],
  ["outflow", -BigInt(2300), -BigInt(2100), false],
  ["outflow", -BigInt(2300), -BigInt(1000), false],
  ["inflow", BigInt(250000), BigInt(300000), false],
  ["inflow", BigInt(250000), BigInt(200000), false],
] as const)(
  "a price increase is an %s whose last charge %d moved from the usual %d beyond the 7.5% band: %s",
  (direction, typicalAmountMinor, lastAmountMinor, flagged) => {
    expect(priceIncreased(stream({ direction, typicalAmountMinor, lastAmountMinor }))).toBe(flagged);
  },
);

test("charged after cancel means the last charge day is strictly after the decision day", () => {
  const canceled = (decidedOn: string | null, lastDate = "2026-03-29") => ({
    status: "canceled" as const,
    decidedOn,
    lastDate,
  });
  expect(chargedAfterCancel(canceled("2026-03-01"))).toBe(true);
  expect(chargedAfterCancel(canceled("2026-03-28"))).toBe(true);
  expect(chargedAfterCancel(canceled("2026-03-29"))).toBe(false);
  expect(chargedAfterCancel(canceled("2026-03-30"))).toBe(false);
  expect(chargedAfterCancel(canceled(null))).toBe(false);
  for (const status of ["proposed", "confirmed", "dismissed"] as const) {
    expect(chargedAfterCancel({ status, decidedOn: "2026-03-01", lastDate: "2026-03-29" })).toBe(false);
  }
});
