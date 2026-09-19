import { expect, test } from "vitest";

import {
  monthEndOf,
  nextObligationDate,
  parseUpcomingQuery,
  projectUpcoming,
  type UpcomingInput,
  type UpcomingObligationInput,
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

const occurrenceOf = (
  source: UpcomingInput,
  date: string,
  overdue = false,
  possibleOverlap = false,
) => ({
  source: "detected",
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
  possibleOverlap,
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

const obligation = (
  over: Partial<UpcomingObligationInput> = {},
): UpcomingObligationInput => ({
  obligationId: "obligation-1",
  accountId: "acct-1",
  currency: "USD",
  name: "Rent",
  amountMinor: 180000,
  cadence: "monthly",
  startsOn: "2026-04-05",
  endsOn: null,
  endedAt: null,
  ...over,
});

const obligationOccurrenceOf = (
  source: UpcomingObligationInput,
  date: string,
  overdue = false,
  possibleOverlap = false,
) => ({
  source: "obligation",
  obligationId: source.obligationId,
  accountId: source.accountId,
  currency: source.currency,
  direction: "outflow",
  name: source.name,
  cadence: source.cadence,
  amountMinor: -source.amountMinor,
  date,
  overdue,
  possibleOverlap,
});

test("the query accepts only a real ISO date under the single `on` key", () => {
  expect(parseUpcomingQuery({})).toEqual({ ok: true, query: { on: null } });
  expect(parseUpcomingQuery({ on: "2026-04-01" })).toEqual({
    ok: true,
    query: { on: "2026-04-01" },
  });
  expect(parseUpcomingQuery({ on: "9999-12-01" })).toEqual({
    ok: true,
    query: { on: "9999-12-01" },
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

test("canceled streams leave the projection entirely: neither listed nor stale", () => {
  const active = stream();
  const canceled = stream({ status: "canceled" });
  const dead = stream({ status: "canceled", lastDate: "2025-01-10" });
  const projected = projectUpcoming([active, canceled, dead], "2026-04-01");
  expect(projected.currencies).toEqual([
    {
      currency: "USD",
      toLeaveMinor: -2300,
      toArriveMinor: 0,
      charges: [occurrenceOf(active, "2026-04-29")],
      deposits: [],
    },
  ]);
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

test.each([
  ["monthly", "9999-11-30", ["9999-12-30"], -2300],
  ["annual", "9998-12-31", ["9999-12-31"], -2300],
  ["weekly", "9999-11-27", ["9999-12-04", "9999-12-11", "9999-12-18", "9999-12-25"], -9200],
  ["biweekly", "9999-11-20", ["9999-12-04", "9999-12-18"], -4600],
] as const)(
  "stops when a %s projection crosses the four-digit year boundary",
  (cadence, lastDate, dates, total) => {
    const source = stream({ cadence, lastDate });
    const projected = projectUpcoming([source], "9999-12-01");
    expect(projected.monthEnd).toBe("9999-12-31");
    expect(projected.currencies[0].charges.map(({ date, overdue }) => [date, overdue])).toEqual(
      dates.map((date) => [date, false]),
    );
    expect(projected.currencies[0].toLeaveMinor).toBe(total);
    expect(projected.stale).toEqual([]);
  },
);

test.each([
  ["monthly", "9999-11-30", [["9999-12-30", true]], -2300],
  ["annual", "9998-11-30", [["9999-11-30", true]], -2300],
  ["weekly", "9999-12-18", [["9999-12-25", true]], -2300],
  ["biweekly", "9999-12-04", [["9999-12-18", true]], -2300],
] as const)(
  "keeps a valid overdue %s occurrence when its successor crosses the year boundary",
  (cadence, lastDate, expected, total) => {
    const source = stream({ cadence, lastDate });
    const projected = projectUpcoming([source], "9999-12-31");
    expect(projected.currencies[0].charges.map(({ date, overdue }) => [date, overdue])).toEqual(
      expected,
    );
    expect(projected.currencies[0].toLeaveMinor).toBe(total);
    expect(projected.stale).toEqual([]);
  },
);

test.each([
  ["monthly", "9999-12-30"],
  ["annual", "9999-12-31"],
  ["weekly", "9999-12-30"],
  ["biweekly", "9999-12-30"],
] as const)(
  "omits a %s stream whose first projected date is outside the four-digit year domain",
  (cadence, lastDate) => {
    const source = stream({ cadence, lastDate });
    expect(projectUpcoming([source], "9999-12-31")).toEqual({
      monthEnd: "9999-12-31",
      currencies: [],
      stale: [],
    });
  },
);

test("a month-end anchor clamps into February through 6.4.1's next-date rule", () => {
  const rent = stream({ lastDate: "2026-01-31", typicalAmountMinor: -180000 });
  const projected = projectUpcoming([rent], "2026-02-01");
  expect(projected.currencies[0].charges).toEqual([occurrenceOf(rent, "2026-02-28")]);
});

test("a month-end anchor returns to its original day after February", () => {
  const rent = stream({ lastDate: "2026-01-31", typicalAmountMinor: -180000 });
  const projected = projectUpcoming([rent], "2026-03-29");
  expect(projected.currencies).toEqual([
    {
      currency: "USD",
      toLeaveMinor: -360000,
      toArriveMinor: 0,
      charges: [
        occurrenceOf(rent, "2026-02-28", true),
        occurrenceOf(rent, "2026-03-31"),
      ],
      deposits: [],
    },
  ]);
  expect(projected.stale).toEqual([]);
});

test.each([
  ["2026-01-29", "2026-03-28", "2026-03-29"],
  ["2026-01-30", "2026-03-29", "2026-03-30"],
] as const)("day %s returns after a non-leap February", (lastDate, reference, nextDate) => {
  const rent = stream({ lastDate, typicalAmountMinor: -180000 });
  const projected = projectUpcoming([rent], reference);
  expect(projected.currencies[0].charges).toEqual([
    occurrenceOf(rent, "2026-02-28", true),
    occurrenceOf(rent, nextDate),
  ]);
  expect(projected.currencies[0].toLeaveMinor).toBe(-360000);
  expect(projected.stale).toEqual([]);
});

test("the month-end anchor is due on its original March day and stale the next day", () => {
  const rent = stream({ lastDate: "2026-01-31", typicalAmountMinor: -180000 });
  const due = projectUpcoming([rent], "2026-03-31");
  expect(due.currencies[0].charges).toEqual([
    occurrenceOf(rent, "2026-02-28", true),
    occurrenceOf(rent, "2026-03-31"),
  ]);
  expect(due.stale).toEqual([]);

  const stale = projectUpcoming([rent], "2026-04-01");
  expect(stale.currencies).toEqual([]);
  expect(stale.stale).toEqual([staleOf(rent)]);
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

test("a known monthly obligation projects a negative outflow occurrence", () => {
  const rent = obligation();
  const projected = projectUpcoming([], "2026-04-01", [rent]);

  expect(projected).toEqual({
    monthEnd: "2026-04-30",
    currencies: [
      {
        currency: "USD",
        toLeaveMinor: -180000,
        toArriveMinor: 0,
        charges: [obligationOccurrenceOf(rent, "2026-04-05")],
        deposits: [],
      },
    ],
    stale: [],
  });
});

test("known obligations stay in separate currency totals", () => {
  const rent = obligation();
  const insurance = obligation({
    obligationId: "obligation-2",
    currency: "EUR",
    cadence: "once",
    startsOn: "2026-04-12",
    amountMinor: 120000,
  });

  expect(projectUpcoming([], "2026-04-01", [rent, insurance]).currencies).toEqual([
    {
      currency: "EUR",
      toLeaveMinor: -120000,
      toArriveMinor: 0,
      charges: [obligationOccurrenceOf(insurance, "2026-04-12")],
      deposits: [],
    },
    {
      currency: "USD",
      toLeaveMinor: -180000,
      toArriveMinor: 0,
      charges: [obligationOccurrenceOf(rent, "2026-04-05")],
      deposits: [],
    },
  ]);
});

test("an exact known and detected overlap marks and counts both occurrences", () => {
  const predicted = stream({
    normalizedName: "RENT HISTORY",
    name: "Rent prediction",
    typicalAmountMinor: -180000,
    lastAmountMinor: -180000,
    lastDate: "2026-03-05",
  });
  const rent = obligation();

  expect(projectUpcoming([predicted], "2026-04-01", [rent]).currencies).toEqual([
    {
      currency: "USD",
      toLeaveMinor: -360000,
      toArriveMinor: 0,
      charges: [
        obligationOccurrenceOf(rent, "2026-04-05", false, true),
        occurrenceOf(predicted, "2026-04-05", false, true),
      ],
      deposits: [],
    },
  ]);
});

test.each([
  ["account", { accountId: "acct-2" }],
  ["currency", { currency: "EUR" }],
  ["date", { startsOn: "2026-04-06" }],
  ["magnitude", { amountMinor: 180001 }],
] as const)("a one-field %s difference does not mark an overlap", (_field, difference) => {
  const predicted = stream({
    normalizedName: "RENT HISTORY",
    name: "Rent prediction",
    typicalAmountMinor: -180000,
    lastAmountMinor: -180000,
    lastDate: "2026-03-05",
  });
  const rent = obligation(difference);
  const occurrences = projectUpcoming([predicted], "2026-04-01", [rent]).currencies.flatMap(
    (section) => section.charges,
  );

  expect(occurrences).toHaveLength(2);
  expect(occurrences.map((occurrence) => occurrence.possibleOverlap)).toEqual([false, false]);
});

test("same-source duplicates do not create a possible-overlap warning", () => {
  const firstKnown = obligation({ obligationId: "obligation-1" });
  const secondKnown = obligation({ obligationId: "obligation-2" });
  const known = projectUpcoming([], "2026-04-01", [firstKnown, secondKnown]);
  expect(known.currencies[0].charges.map((occurrence) => occurrence.possibleOverlap)).toEqual([
    false,
    false,
  ]);

  const firstDetected = stream({
    normalizedName: "RENT ONE",
    name: "Rent prediction",
    typicalAmountMinor: -180000,
    lastAmountMinor: -180000,
    lastDate: "2026-03-05",
  });
  const secondDetected = stream({
    normalizedName: "RENT TWO",
    name: "Rent prediction",
    typicalAmountMinor: -180000,
    lastAmountMinor: -180000,
    lastDate: "2026-03-05",
  });
  const detected = projectUpcoming([firstDetected, secondDetected], "2026-04-01");
  expect(detected.currencies[0].charges.map((occurrence) => occurrence.possibleOverlap)).toEqual([
    false,
    false,
  ]);
});

test("combined occurrences order by source before source-specific identity", () => {
  const predicted = stream({
    normalizedName: "ZZZ RENT",
    name: "Rent",
    typicalAmountMinor: -179999,
    lastAmountMinor: -179999,
    lastDate: "2026-03-05",
  });
  const rent = obligation({ obligationId: "00000000-0000-4000-8000-000000000001" });

  expect(
    projectUpcoming([predicted], "2026-04-01", [rent]).currencies[0].charges.map(
      (occurrence) => occurrence.source,
    ),
  ).toEqual(["detected", "obligation"]);
});

test("detected occurrences use their full structural identity as a stable tiebreaker", () => {
  const monthly = stream({
    normalizedName: "SAME RENT",
    name: "Rent",
    cadence: "monthly",
    lastDate: "2026-03-05",
  });
  const annual = stream({
    normalizedName: "SAME RENT",
    name: "Rent",
    cadence: "annual",
    lastDate: "2025-04-05",
  });

  expect(
    projectUpcoming([monthly, annual], "2026-04-01").currencies[0].charges.map(
      (occurrence) => occurrence.cadence,
    ),
  ).toEqual(["annual", "monthly"]);
});

test("a monthly obligation keeps its original anchor around the reference", () => {
  const rent = obligation({ startsOn: "2026-01-31" });
  const projected = projectUpcoming([], "2026-03-29", [rent]);

  expect(projected.currencies).toEqual([
    {
      currency: "USD",
      toLeaveMinor: -360000,
      toArriveMinor: 0,
      charges: [
        obligationOccurrenceOf(rent, "2026-02-28", true),
        obligationOccurrenceOf(rent, "2026-03-31"),
      ],
      deposits: [],
    },
  ]);
  expect(projected.stale).toEqual([]);
});

test.each([
  ["weekly", "2026-04-01", ["2026-04-08", "2026-04-15", "2026-04-22", "2026-04-29"]],
  ["biweekly", "2026-03-01", ["2026-03-29", "2026-04-12", "2026-04-26"]],
] as const)("a %s obligation jumps to the reference neighborhood", (cadence, startsOn, dates) => {
  const charge = obligation({ cadence, startsOn });
  const projected = projectUpcoming([], "2026-04-10", [charge]);

  expect(projected.currencies).toEqual([
    {
      currency: "USD",
      toLeaveMinor: -charge.amountMinor * dates.length,
      toArriveMinor: 0,
      charges: dates.map((date, index) => obligationOccurrenceOf(charge, date, index === 0)),
      deposits: [],
    },
  ]);
});

test("a very old fixed-cadence start jumps directly to the visible month", () => {
  const charge = obligation({ cadence: "weekly", startsOn: "1900-01-01" });

  expect(projectUpcoming([], "2026-04-10", [charge]).currencies[0].charges).toEqual([
    obligationOccurrenceOf(charge, "2026-04-06", true),
    obligationOccurrenceOf(charge, "2026-04-13"),
    obligationOccurrenceOf(charge, "2026-04-20"),
    obligationOccurrenceOf(charge, "2026-04-27"),
  ]);
});

test("a February 29 annual obligation clamps and returns to its leap-day anchor", () => {
  const insurance = obligation({ cadence: "annual", startsOn: "2024-02-29" });

  expect(projectUpcoming([], "2027-02-28", [insurance]).currencies).toEqual([
    {
      currency: "USD",
      toLeaveMinor: -360000,
      toArriveMinor: 0,
      charges: [
        obligationOccurrenceOf(insurance, "2026-02-28", true),
        obligationOccurrenceOf(insurance, "2027-02-28"),
      ],
      deposits: [],
    },
  ]);
  expect(projectUpcoming([], "2028-02-28", [insurance]).currencies[0].charges).toEqual([
    obligationOccurrenceOf(insurance, "2027-02-28", true),
    obligationOccurrenceOf(insurance, "2028-02-29"),
  ]);
});

test.each([
  ["before", "2026-03-15", "2026-04-01", "2026-03-15", true],
  ["on", "2026-04-01", "2026-04-01", "2026-04-01", false],
  ["within", "2026-04-18", "2026-04-01", "2026-04-18", false],
  ["after", "2026-05-01", "2026-04-01", null, false],
] as const)(
  "a one-time obligation %s the visible window remains one calendar fact",
  (_position, startsOn, reference, expected, overdue) => {
    const tuition = obligation({ cadence: "once", startsOn });
    const projected = projectUpcoming([], reference, [tuition]);

    if (expected === null) {
      expect(projected.currencies).toEqual([]);
    } else {
      expect(projected.currencies).toEqual([
        {
          currency: "USD",
          toLeaveMinor: -180000,
          toArriveMinor: 0,
          charges: [obligationOccurrenceOf(tuition, expected, overdue)],
          deposits: [],
        },
      ]);
    }
  },
);

test("an ended obligation never projects", () => {
  const ended = obligation({ endedAt: new Date("2026-03-20T12:00:00Z") });

  expect(projectUpcoming([], "2026-04-01", [ended])).toEqual({
    monthEnd: "2026-04-30",
    currencies: [],
    stale: [],
  });
});

test("an inclusive final date remains the nearest passed occurrence", () => {
  const finite = obligation({
    cadence: "weekly",
    startsOn: "2026-03-29",
    endsOn: "2026-04-12",
  });

  expect(projectUpcoming([], "2026-04-12", [finite]).currencies[0].charges).toEqual([
    obligationOccurrenceOf(finite, "2026-04-05", true),
    obligationOccurrenceOf(finite, "2026-04-12"),
  ]);
  expect(projectUpcoming([], "2026-04-20", [finite]).currencies[0].charges).toEqual([
    obligationOccurrenceOf(finite, "2026-04-12", true),
  ]);
});

test.each([
  ["monthly", "2026-01-31", "2026-02-28", "2026-03-15", "2026-02-28"],
  ["annual", "2024-02-29", "2026-02-28", "2027-02-01", "2026-02-28"],
] as const)(
  "a finite %s obligation projects its final clamped occurrence",
  (cadence, startsOn, endsOn, reference, expected) => {
    const finite = obligation({ cadence, startsOn, endsOn });

    expect(projectUpcoming([], reference, [finite]).currencies).toEqual([
      {
        currency: "USD",
        toLeaveMinor: -180000,
        toArriveMinor: 0,
        charges: [obligationOccurrenceOf(finite, expected, true)],
        deposits: [],
      },
    ]);
  },
);

test.each([
  ["weekly", "2026-04-01", null, "2026-04-15", "2026-04-15"],
  ["weekly", "2026-04-01", null, "2026-04-10", "2026-04-15"],
  ["biweekly", "2026-03-01", null, "2026-03-29", "2026-03-29"],
  ["biweekly", "2026-03-01", null, "2026-04-10", "2026-04-12"],
  ["monthly", "2026-01-31", null, "2026-02-01", "2026-02-28"],
  ["monthly", "2026-01-15", null, "2026-12-20", "2027-01-15"],
  ["annual", "2024-02-29", null, "2026-01-01", "2026-02-28"],
  ["annual", "2024-02-29", null, "2028-01-01", "2028-02-29"],
  ["annual", "2024-02-29", null, "2026-03-01", "2027-02-28"],
  ["monthly", "2026-01-15", "2026-03-15", "2026-03-01", "2026-03-15"],
  ["monthly", "2026-01-15", "2026-03-14", "2026-03-01", null],
  ["monthly", "2026-05-01", null, "2026-04-10", "2026-05-01"],
  ["once", "2026-04-05", null, "2026-04-05", "2026-04-05"],
  ["once", "2026-04-05", null, "2026-04-06", null],
] as const)(
  "nextObligationDate: %s from %s until %s, seen from %s, is %s",
  (cadence, startsOn, endsOn, reference, expected) => {
    expect(nextObligationDate({ cadence, startsOn, endsOn }, reference)).toBe(expected);
  },
);
