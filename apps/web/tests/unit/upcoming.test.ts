import { expect, test } from "vitest";

import {
  monthEndOf,
  parseUpcomingQuery,
  projectUpcoming,
  type UpcomingInput,
} from "@/lib/ledger/upcoming";

let sequence = 0;
const stream = (over: Partial<UpcomingInput> = {}): UpcomingInput => {
  sequence += 1;
  return {
    accountId: "acct-1",
    currency: "USD",
    direction: "outflow",
    normalizedName: `STREAM ${sequence}`,
    name: `Stream ${sequence}`,
    cadence: "monthly",
    typicalAmountMinor: -2300,
    lastAmountMinor: -2300,
    firstDate: "2026-01-29",
    lastDate: "2026-03-29",
    occurrences: 3,
    confidence: "high",
    status: "proposed",
    ...over,
  };
};

const occurrenceOf = (source: UpcomingInput, date: string, overdue = false) => ({
  accountId: source.accountId,
  currency: source.currency,
  direction: source.direction,
  normalizedName: source.normalizedName,
  name: source.name,
  cadence: source.cadence,
  amountMinor: source.typicalAmountMinor,
  lastDate: source.lastDate,
  date,
  overdue,
});

const staleOf = (source: UpcomingInput) => ({
  accountId: source.accountId,
  currency: source.currency,
  direction: source.direction,
  normalizedName: source.normalizedName,
  name: source.name,
  cadence: source.cadence,
  amountMinor: source.typicalAmountMinor,
  lastDate: source.lastDate,
});

test("the query accepts only a real ISO date under the single `on` key", () => {
  expect(parseUpcomingQuery({})).toEqual({ ok: true, query: { on: null } });
  expect(parseUpcomingQuery({ on: "2026-04-01" })).toEqual({
    ok: true,
    query: { on: "2026-04-01" },
  });
  expect(parseUpcomingQuery({ on: "" })).toEqual({ ok: true, query: { on: null } });
  expect(parseUpcomingQuery({ on: undefined })).toEqual({ ok: true, query: { on: null } });
  for (const bad of [
    { on: "2026-02-30" },
    { on: "2026-13-01" },
    { on: "04/01/2026" },
    { on: "2026-4-1" },
    { on: "2026-04-01T00:00:00Z" },
    { on: ["2026-04-01"] },
    { until: "2026-04-01" },
    { on: "2026-04-01", extra: "1" },
  ]) {
    expect(parseUpcomingQuery(bad)).toEqual({ ok: false });
  }
});

test("monthEndOf lands on real month ends, February and leap years included", () => {
  expect(monthEndOf("2026-04-01")).toBe("2026-04-30");
  expect(monthEndOf("2026-02-15")).toBe("2026-02-28");
  expect(monthEndOf("2028-02-01")).toBe("2028-02-29");
  expect(monthEndOf("2026-12-31")).toBe("2026-12-31");
  expect(monthEndOf("2026-01-31")).toBe("2026-01-31");
});

test("a monthly stream projects its next date inside the reference month", () => {
  const streamflix = stream();
  expect(projectUpcoming([streamflix], "2026-04-01")).toEqual({
    monthEnd: "2026-04-30",
    currencies: [
      {
        currency: "USD",
        toLeaveMinor: -2300,
        toArriveMinor: 0,
        charges: [occurrenceOf(streamflix, "2026-04-29")],
        deposits: [],
      },
    ],
    stale: [],
  });
});

test("a date the reference has passed shows overdue and still counts to leave", () => {
  const streamflix = stream();
  const projected = projectUpcoming([streamflix], "2026-04-30");
  expect(projected.currencies).toEqual([
    {
      currency: "USD",
      toLeaveMinor: -2300,
      toArriveMinor: 0,
      charges: [occurrenceOf(streamflix, "2026-04-29", true)],
      deposits: [],
    },
  ]);
  expect(projected.stale).toEqual([]);
});

test("a reference on the expected date itself is due, not overdue", () => {
  const streamflix = stream();
  const projected = projectUpcoming([streamflix], "2026-04-29");
  expect(projected.currencies[0].charges).toEqual([occurrenceOf(streamflix, "2026-04-29")]);
});

test("two missed dates make a stream stale: out of the list and the totals", () => {
  const streamflix = stream();
  expect(projectUpcoming([streamflix], "2026-06-01")).toEqual({
    monthEnd: "2026-06-30",
    currencies: [],
    stale: [staleOf(streamflix)],
  });
});

test("the stale boundary is exact: a second expected date on the reference still projects", () => {
  const streamflix = stream();
  const projected = projectUpcoming([streamflix], "2026-05-29");
  expect(projected.currencies).toEqual([
    {
      currency: "USD",
      toLeaveMinor: -4600,
      toArriveMinor: 0,
      charges: [
        occurrenceOf(streamflix, "2026-04-29", true),
        occurrenceOf(streamflix, "2026-05-29"),
      ],
      deposits: [],
    },
  ]);
  expect(projected.stale).toEqual([]);
});

test("a weekly stream projects every remaining date of the month", () => {
  const gym = stream({ cadence: "weekly", lastDate: "2026-08-31", typicalAmountMinor: -1500 });
  const projected = projectUpcoming([gym], "2026-09-01");
  expect(projected.currencies[0].charges).toEqual([
    occurrenceOf(gym, "2026-09-07"),
    occurrenceOf(gym, "2026-09-14"),
    occurrenceOf(gym, "2026-09-21"),
    occurrenceOf(gym, "2026-09-28"),
  ]);
  expect(projected.currencies[0].toLeaveMinor).toBe(-6000);
});

test("a weekly stream one week behind lists the missed date once, then the rest", () => {
  const gym = stream({ cadence: "weekly", lastDate: "2026-09-01", typicalAmountMinor: -1500 });
  const projected = projectUpcoming([gym], "2026-09-12");
  expect(projected.currencies[0].charges).toEqual([
    occurrenceOf(gym, "2026-09-08", true),
    occurrenceOf(gym, "2026-09-15"),
    occurrenceOf(gym, "2026-09-22"),
    occurrenceOf(gym, "2026-09-29"),
  ]);
  expect(projected.currencies[0].toLeaveMinor).toBe(-6000);
});

test("dismissed streams neither project nor count as stale", () => {
  const active = stream();
  const dismissed = stream({ status: "dismissed" });
  const dead = stream({ status: "dismissed", lastDate: "2025-01-10" });
  const projected = projectUpcoming([active, dismissed, dead], "2026-04-01");
  expect(projected.currencies[0].charges).toEqual([occurrenceOf(active, "2026-04-29")]);
  expect(projected.stale).toEqual([]);
});

test("proposed and confirmed both project", () => {
  const proposed = stream({ status: "proposed" });
  const confirmed = stream({ status: "confirmed" });
  const projected = projectUpcoming([proposed, confirmed], "2026-04-01");
  expect(projected.currencies[0].charges).toHaveLength(2);
  expect(projected.currencies[0].toLeaveMinor).toBe(-4600);
});

test("inflows land in deposits and to-arrive, never in the charges total", () => {
  const paycheck = stream({
    direction: "inflow",
    typicalAmountMinor: 250000,
    lastAmountMinor: 250000,
    lastDate: "2026-03-27",
  });
  const streamflix = stream();
  expect(projectUpcoming([paycheck, streamflix], "2026-04-01").currencies).toEqual([
    {
      currency: "USD",
      toLeaveMinor: -2300,
      toArriveMinor: 250000,
      charges: [occurrenceOf(streamflix, "2026-04-29")],
      deposits: [occurrenceOf(paycheck, "2026-04-27")],
    },
  ]);
});

test("currencies stay separate sections, sorted, sums never mixed", () => {
  const usd = stream();
  const eur = stream({ currency: "EUR", typicalAmountMinor: -999, lastDate: "2026-03-10" });
  const projected = projectUpcoming([eur, usd], "2026-04-01");
  expect(projected.currencies.map((section) => [section.currency, section.toLeaveMinor])).toEqual([
    ["EUR", -999],
    ["USD", -2300],
  ]);
});

test("a stream whose next date falls after month end is quiet: neither listed nor stale", () => {
  const insurance = stream({ cadence: "annual", lastDate: "2025-06-15" });
  expect(projectUpcoming([insurance], "2026-04-01")).toEqual({
    monthEnd: "2026-04-30",
    currencies: [],
    stale: [],
  });
});

test("an annual stream two renewals behind is stale", () => {
  const insurance = stream({ cadence: "annual", lastDate: "2024-03-10" });
  const projected = projectUpcoming([insurance], "2026-09-01");
  expect(projected.currencies).toEqual([]);
  expect(projected.stale).toEqual([staleOf(insurance)]);
});

test("the December window ends at the 31st and never spills into January", () => {
  const streamflix = stream({ lastDate: "2026-11-05" });
  const projected = projectUpcoming([streamflix], "2026-12-01");
  expect(projected.monthEnd).toBe("2026-12-31");
  expect(projected.currencies[0].charges).toEqual([occurrenceOf(streamflix, "2026-12-05")]);
});

test("a month-end anchor clamps into February through 6.4.1's next-date rule", () => {
  const rent = stream({ lastDate: "2026-01-31", typicalAmountMinor: -180000 });
  const projected = projectUpcoming([rent], "2026-02-01");
  expect(projected.currencies[0].charges).toEqual([occurrenceOf(rent, "2026-02-28")]);
});

test("charges order by date then name; stale order by last-seen desc then name", () => {
  const zebra = stream({ normalizedName: "ZEBRA", name: "Zebra", lastDate: "2026-03-29" });
  const apex = stream({ normalizedName: "APEX", name: "Apex", lastDate: "2026-03-29" });
  const early = stream({ normalizedName: "EARLY", name: "Early", lastDate: "2026-03-05" });
  const projected = projectUpcoming([zebra, apex, early], "2026-04-01");
  expect(projected.currencies[0].charges.map((charge) => [charge.name, charge.date])).toEqual([
    ["Early", "2026-04-05"],
    ["Apex", "2026-04-29"],
    ["Zebra", "2026-04-29"],
  ]);

  const staleZebra = stream({ normalizedName: "ZS", name: "Z Stale", lastDate: "2026-01-02" });
  const staleApex = stream({ normalizedName: "AS", name: "A Stale", lastDate: "2026-01-02" });
  const staleOlder = stream({ normalizedName: "OS", name: "Older", lastDate: "2025-12-01" });
  const staleness = projectUpcoming([staleOlder, staleZebra, staleApex], "2026-04-01");
  expect(staleness.stale.map((item) => item.name)).toEqual(["A Stale", "Z Stale", "Older"]);
});

test("no streams at all projects an empty month", () => {
  expect(projectUpcoming([], "2026-04-01")).toEqual({
    monthEnd: "2026-04-30",
    currencies: [],
    stale: [],
  });
});
