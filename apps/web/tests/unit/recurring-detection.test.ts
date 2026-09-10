import { expect, test } from "vitest";

import {
  detectRecurringStreams,
  MIN_OCCURRENCES,
  nextExpectedDate,
  normalizeRecurringName,
  type RecurringRow,
  type RecurringStream,
} from "@/lib/ledger/recurring-detection";

let sequence = 0;
const row = (
  date: string,
  amountMinor: number,
  rest: Partial<RecurringRow> = {},
): RecurringRow => ({
  id: `row-${(sequence += 1)}`,
  accountId: "acct-1",
  amountMinor,
  currency: "USD",
  date,
  description: "SUBSCRIPTION CHARGE",
  merchant: null,
  status: "posted",
  ...rest,
});

const only = (streams: RecurringStream[]): RecurringStream => {
  expect(streams).toHaveLength(1);
  return streams[0];
};

test("normalization strips per-charge descriptor noise, keeps identity", () => {
  expect(normalizeRecurringName("streamflix")).toBe("STREAMFLIX");
  expect(normalizeRecurringName("AMZN Mktp US*RT4KZ8")).toBe("AMZN MKTP US");
  expect(normalizeRecurringName("AMZN Mktp US*M23L91TS3")).toBe("AMZN MKTP US");
  expect(normalizeRecurringName("SQ *BLUE BOTTLE COFFEE")).toBe("SQ BLUE BOTTLE COFFEE");
  expect(normalizeRecurringName("PAYPAL *AIRBNBHM 402935")).toBe("PAYPAL AIRBNBHM");
  expect(normalizeRecurringName("MAPLE MARKET #204")).toBe("MAPLE MARKET");
  expect(normalizeRecurringName("MAPLE MARKET #205")).toBe("MAPLE MARKET");
  expect(normalizeRecurringName("NETFLIX.COM 866-579-7172")).toBe("NETFLIX.COM");
  expect(normalizeRecurringName("CITY POWER & LIGHT 0091 WEB PMTS")).toBe(
    "CITY POWER & LIGHT 0091 WEB PMTS",
  );
  expect(normalizeRecurringName("  Uber\t*Trip   ")).toBe("UBER TRIP");
  expect(normalizeRecurringName("7-ELEVEN")).toBe("7-ELEVEN");
  expect(normalizeRecurringName("7-ELEVEN*RT4KZ8")).toBe("7-ELEVEN");
  expect(normalizeRecurringName("STORE 1234")).toBe("STORE");
  expect(normalizeRecurringName("***")).toBe("");
  expect(normalizeRecurringName("!!!")).toBe("");
});

test("monthly cadence: month-length variance and Feb-end clamping stay in class", () => {
  const stream = only(
    detectRecurringStreams([
      row("2026-01-29", -2300),
      row("2026-02-28", -2300),
      row("2026-03-29", -2300),
    ]),
  );
  expect(stream).toMatchObject({
    cadence: "monthly",
    confidence: "high",
    typicalAmountMinor: -2300,
    lastAmountMinor: -2300,
    firstDate: "2026-01-29",
    lastDate: "2026-03-29",
    occurrences: 3,
    direction: "outflow",
    normalizedName: "SUBSCRIPTION CHARGE",
  });
});

test("weekly cadence detects with day jitter inside tolerance", () => {
  const stream = only(
    detectRecurringStreams([
      row("2026-03-01", -899),
      row("2026-03-07", -899),
      row("2026-03-15", -899),
      row("2026-03-22", -899),
    ]),
  );
  expect(stream).toMatchObject({ cadence: "weekly", confidence: "high", occurrences: 4 });
});

test("biweekly cadence detects exact 14-day paychecks as biweekly, not weekly skips", () => {
  const stream = only(
    detectRecurringStreams([
      row("2026-01-02", 180000),
      row("2026-01-16", 180000),
      row("2026-01-30", 180000),
    ]),
  );
  expect(stream).toMatchObject({ cadence: "biweekly", confidence: "high", direction: "inflow" });
});

test("semi-monthly (1st/15th) lands in the biweekly bucket", () => {
  const stream = only(
    detectRecurringStreams([
      row("2026-01-01", 250000),
      row("2026-01-15", 250000),
      row("2026-02-01", 250000),
      row("2026-02-16", 250000),
      row("2026-03-02", 250000),
    ]),
  );
  expect(stream).toMatchObject({ cadence: "biweekly", confidence: "high", occurrences: 5 });
});

test("annual cadence detects across leap-year lengths", () => {
  const stream = only(
    detectRecurringStreams([
      row("2024-02-29", -9900),
      row("2025-02-28", -9900),
      row("2026-02-28", -9900),
    ]),
  );
  expect(stream).toMatchObject({ cadence: "annual", confidence: "high" });
});

// Windows are repeated as literals on purpose: importing CADENCE_WINDOWS would
// move the assertion with any edit and prove nothing.
test("each cadence window is inclusive at both edges, and its double is the missed-occurrence window", () => {
  const streamsForGaps = (...gaps: number[]) => {
    const offsets = gaps.reduce((acc, gap) => [...acc, acc[acc.length - 1] + gap], [0]);
    return detectRecurringStreams(
      offsets.map((offset) =>
        row(new Date(Date.UTC(2026, 0, 1 + offset)).toISOString().slice(0, 10), -2300),
      ),
    );
  };
  const classOf = (...gaps: number[]) => {
    const stream = only(streamsForGaps(...gaps));
    return [stream.cadence, stream.confidence];
  };
  for (const { cadence, lo, hi, mid } of [
    { cadence: "weekly", lo: 5, hi: 9, mid: 7 },
    { cadence: "biweekly", lo: 11, hi: 17, mid: 14 },
    { cadence: "monthly", lo: 26, hi: 35, mid: 30 },
    { cadence: "annual", lo: 330, hi: 400, mid: 365 },
  ] as const) {
    expect([classOf(lo, lo), classOf(hi, hi)]).toEqual([
      [cadence, "high"],
      [cadence, "high"],
    ]);
    expect([streamsForGaps(lo - 1, lo - 1), streamsForGaps(hi + 1, hi + 1)]).toEqual([[], []]);

    expect([classOf(mid, 2 * lo), classOf(mid, 2 * hi)]).toEqual([
      [cadence, "medium"],
      [cadence, "medium"],
    ]);
    expect(streamsForGaps(mid, 2 * hi + 1)).toEqual([]);
  }
});

test("a gap outside every class window and its double kills the group", () => {
  expect(
    detectRecurringStreams([
      row("2026-01-05", -2300),
      row("2026-02-05", -2300),
      row("2026-03-17", -2300),
    ]),
  ).toEqual([]);
});

test("unsupported cadences (every 3 weeks, quarterly) never classify", () => {
  expect(
    detectRecurringStreams([
      row("2026-01-01", -5000),
      row("2026-01-22", -5000),
      row("2026-02-12", -5000),
    ]),
  ).toEqual([]);
  expect(
    detectRecurringStreams([
      row("2026-01-01", -40000),
      row("2026-04-01", -40000),
      row("2026-07-01", -40000),
    ]),
  ).toEqual([]);
});

test("one missed occurrence (doubled gap) keeps the stream at medium confidence", () => {
  const stream = only(
    detectRecurringStreams([
      row("2026-01-15", -12000),
      row("2026-02-15", -12000),
      row("2026-04-15", -12000),
      row("2026-05-15", -12000),
    ]),
  );
  expect(stream).toMatchObject({ cadence: "monthly", confidence: "medium", occurrences: 4 });
});

test("three occurrences with one skip still classify when base gaps hold the majority tie", () => {
  const stream = only(
    detectRecurringStreams([
      row("2026-01-15", -12000),
      row("2026-02-15", -12000),
      row("2026-04-15", -12000),
    ]),
  );
  expect(stream).toMatchObject({ cadence: "monthly", confidence: "medium", occurrences: 3 });
});

test("more skips than on-cadence gaps rejects the group", () => {
  expect(
    detectRecurringStreams([
      row("2026-01-15", -12000),
      row("2026-02-15", -12000),
      row("2026-04-15", -12000),
      row("2026-06-15", -12000),
    ]),
  ).toEqual([]);
});

test("a weekly run with one missed week stays weekly, never biweekly", () => {
  const stream = only(
    detectRecurringStreams([
      row("2026-03-01", -1500),
      row("2026-03-08", -1500),
      row("2026-03-22", -1500),
      row("2026-03-29", -1500),
    ]),
  );
  expect(stream).toMatchObject({ cadence: "weekly", confidence: "medium" });
});

test("amounts within the 7.5% stable band keep high confidence, median is typical", () => {
  const stream = only(
    detectRecurringStreams([
      row("2026-01-10", -2000),
      row("2026-02-10", -2100),
      row("2026-03-10", -2050),
    ]),
  );
  expect(stream).toMatchObject({
    confidence: "high",
    typicalAmountMinor: -2050,
    lastAmountMinor: -2050,
  });
});

test("typical amount medians an even count over the middle pair, truncating toward zero", () => {
  const stream = only(
    detectRecurringStreams([
      row("2026-01-10", -2000),
      row("2026-02-10", -2101),
      row("2026-03-10", -2200),
      row("2026-04-10", -2300),
    ]),
  );
  expect(stream).toMatchObject({ typicalAmountMinor: -2150, occurrences: 4, confidence: "high" });
});

test("amount drift beyond 7.5% but inside 25% demotes to medium, stream survives", () => {
  const stream = only(
    detectRecurringStreams([
      row("2026-01-10", -2000),
      row("2026-02-10", -2400),
      row("2026-03-10", -2050),
    ]),
  );
  expect(stream).toMatchObject({ confidence: "medium", typicalAmountMinor: -2050, occurrences: 3 });
});

test("stable-band boundary is inclusive at exactly 7.5% and exclusive one unit past", () => {
  const at = only(
    detectRecurringStreams([
      row("2026-01-10", -4000),
      row("2026-02-10", -4000),
      row("2026-03-10", -4300),
    ]),
  );
  expect(at.confidence).toBe("high");
  const past = only(
    detectRecurringStreams([
      row("2026-01-10", -4000),
      row("2026-02-10", -4000),
      row("2026-03-10", -4301),
    ]),
  );
  expect(past.confidence).toBe("medium");
});

test("accept-band boundary is inclusive at exactly 25% and drops one unit past", () => {
  const at = only(
    detectRecurringStreams([
      row("2026-01-10", -4000),
      row("2026-02-10", -4000),
      row("2026-03-10", -4000),
      row("2026-04-10", -5000),
    ]),
  );
  expect(at.occurrences).toBe(4);
  const past = only(
    detectRecurringStreams([
      row("2026-01-10", -4000),
      row("2026-02-10", -4000),
      row("2026-03-10", -4000),
      row("2026-04-10", -5001),
    ]),
  );
  expect(past).toMatchObject({ occurrences: 3, lastDate: "2026-03-10", confidence: "medium" });
});

test("one wild outlier is ejected and the remaining occurrences still form the stream", () => {
  const stream = only(
    detectRecurringStreams([
      row("2026-01-03", -1549),
      row("2026-02-03", -1549),
      row("2026-03-03", -1549),
      row("2026-03-20", -10000),
    ]),
  );
  expect(stream).toMatchObject({
    cadence: "monthly",
    confidence: "medium",
    typicalAmountMinor: -1549,
    occurrences: 3,
    lastDate: "2026-03-03",
  });
});

test("outlier ejection below the minimum kills the group", () => {
  expect(
    detectRecurringStreams([
      row("2026-01-03", -1549),
      row("2026-02-03", -1549),
      row("2026-03-03", -10000),
    ]),
  ).toEqual([]);
});

test("scattered amounts with no stable core never form a stream", () => {
  expect(
    detectRecurringStreams([
      row("2026-01-03", -1000),
      row("2026-02-03", -5000),
      row("2026-03-03", -9000),
      row("2026-04-03", -14000),
    ]),
  ).toEqual([]);
});

test("same-day rows aggregate into one occurrence with the summed amount", () => {
  const stream = only(
    detectRecurringStreams([
      row("2026-01-05", -1150),
      row("2026-01-05", -1150),
      row("2026-02-05", -2300),
      row("2026-03-05", -2300),
    ]),
  );
  expect(stream).toMatchObject({ typicalAmountMinor: -2300, occurrences: 3, confidence: "high" });
});

test("minimum occurrences is a hard boundary: two dates never, three exactly does", () => {
  expect(MIN_OCCURRENCES).toBe(3);
  expect(
    detectRecurringStreams([row("2026-01-27", 250000), row("2026-02-27", 250000)]),
  ).toEqual([]);
  const stream = only(
    detectRecurringStreams([
      row("2026-01-27", 250000),
      row("2026-02-27", 250000),
      row("2026-03-27", 250000),
    ]),
  );
  expect(stream.occurrences).toBe(3);
});

test("pending rows never count as evidence", () => {
  expect(
    detectRecurringStreams([
      row("2026-01-27", 250000),
      row("2026-02-27", 250000),
      row("2026-03-27", 250000, { status: "pending" }),
    ]),
  ).toEqual([]);
});

test("excluded transfer-pair members never count as evidence", () => {
  const excluded = row("2026-03-27", 250000);
  expect(
    detectRecurringStreams(
      [row("2026-01-27", 250000), row("2026-02-27", 250000), excluded],
      new Set([excluded.id]),
    ),
  ).toEqual([]);
});

test("a zero-amount row is never an occurrence, alone on a date or beside a charge", () => {
  const stream = only(
    detectRecurringStreams([
      row("2026-01-10", -2300),
      row("2026-02-10", -2300),
      row("2026-02-10", 0),
      row("2026-03-10", -2300),
      row("2026-03-25", 0),
    ]),
  );
  expect(stream).toMatchObject({ occurrences: 3, lastDate: "2026-03-10", confidence: "high" });
});

test("directions split: outflow charges and a same-name refund never mix", () => {
  const streams = detectRecurringStreams([
    row("2026-01-12", -1899, { merchant: "Skyline Air" }),
    row("2026-02-12", -1899, { merchant: "Skyline Air" }),
    row("2026-03-12", -1899, { merchant: "Skyline Air" }),
    row("2026-03-14", 1899, { merchant: "Skyline Air" }),
  ]);
  const stream = only(streams);
  expect(stream).toMatchObject({ direction: "outflow", occurrences: 3 });
});

test("paychecks detect as inflow streams", () => {
  const stream = only(
    detectRecurringStreams([
      row("2026-01-27", 250000, { description: "ACME CORP PAYROLL", merchant: "Acme Corp" }),
      row("2026-02-27", 250000, { description: "ACME CORP PAYROLL", merchant: "Acme Corp" }),
      row("2026-03-27", 250000, { description: "ACME CORP PAYROLL", merchant: "Acme Corp" }),
    ]),
  );
  expect(stream).toMatchObject({
    direction: "inflow",
    name: "Acme Corp",
    normalizedName: "ACME CORP",
    cadence: "monthly",
  });
});

test("accounts and currencies split streams even under one merchant name", () => {
  const dates = ["2026-01-10", "2026-02-10", "2026-03-10"];
  const streams = detectRecurringStreams([
    ...dates.map((date) => row(date, -2300, { accountId: "acct-1" })),
    ...dates.map((date) => row(date, -2300, { accountId: "acct-2" })),
    ...dates.map((date) => row(date, -2300, { accountId: "acct-1", currency: "EUR" })),
  ]);
  expect(streams).toHaveLength(3);
  expect(new Set(streams.map((s) => `${s.accountId}:${s.currency}`))).toEqual(
    new Set(["acct-1:USD", "acct-2:USD", "acct-1:EUR"]),
  );
});

test("the merchant field groups rows whose descriptions vary per charge", () => {
  const stream = only(
    detectRecurringStreams([
      row("2026-01-04", -799, { merchant: "Streamflix", description: "STREAMFLIX*9Q1" }),
      row("2026-02-04", -799, { merchant: "Streamflix", description: "STREAMFLIX*X77" }),
      row("2026-03-04", -799, { merchant: "Streamflix", description: "STREAMFLIX HELP.STREAMFLIX.COM" }),
    ]),
  );
  expect(stream).toMatchObject({ name: "Streamflix", normalizedName: "STREAMFLIX" });
});

test("description fallback groups store-numbered descriptors when merchant is null", () => {
  const stream = only(
    detectRecurringStreams([
      row("2026-01-08", -6742, { description: "MAPLE MARKET #204" }),
      row("2026-02-08", -6742, { description: "MAPLE MARKET #205" }),
      row("2026-03-08", -6742, { description: "MAPLE MARKET #206" }),
    ]),
  );
  expect(stream).toMatchObject({ name: "MAPLE MARKET", normalizedName: "MAPLE MARKET" });
});

test("display name is the most frequent merchant, ties broken lexicographically", () => {
  const streams = detectRecurringStreams([
    row("2026-01-04", -799, { merchant: "STREAMFLIX" }),
    row("2026-02-04", -799, { merchant: "Streamflix" }),
    row("2026-03-04", -799, { merchant: "Streamflix" }),
    row("2026-04-04", -799, { merchant: "STREAMFLIX" }),
  ]);
  expect(only(streams).name).toBe("STREAMFLIX");
});

test("detection is deterministic under input order and sorts by recency", () => {
  const rows = [
    row("2026-01-27", 250000, { description: "ACME CORP PAYROLL" }),
    row("2026-02-27", 250000, { description: "ACME CORP PAYROLL" }),
    row("2026-03-27", 250000, { description: "ACME CORP PAYROLL" }),
    row("2026-01-29", -2300, { description: "STREAMFLIX" }),
    row("2026-02-28", -2300, { description: "STREAMFLIX" }),
    row("2026-03-29", -2300, { description: "STREAMFLIX" }),
  ];
  const forward = detectRecurringStreams(rows);
  const backward = detectRecurringStreams([...rows].reverse());
  const interleaved = detectRecurringStreams([rows[3], rows[0], rows[4], rows[1], rows[5], rows[2]]);
  expect(backward).toEqual(forward);
  expect(interleaved).toEqual(forward);
  expect(forward.map((s) => s.normalizedName)).toEqual(["STREAMFLIX", "ACME CORP PAYROLL"]);
});

test("streams alike but for their name sort by name, whatever order rows arrive in", () => {
  const dates = ["2026-01-10", "2026-02-10", "2026-03-10"];
  const rows = [
    ...dates.map((date) => row(date, -2300, { merchant: "Zebra Club" })),
    ...dates.map((date) => row(date, -4400, { merchant: "Alpha Gym" })),
  ];
  const names = (input: RecurringRow[]) => detectRecurringStreams(input).map((s) => s.name);
  expect(names(rows)).toEqual(["Alpha Gym", "Zebra Club"]);
  expect(names([...rows].reverse())).toEqual(["Alpha Gym", "Zebra Club"]);
});

test("nextExpectedDate: fixed-interval cadences add exact days", () => {
  expect(nextExpectedDate("2026-03-27", "weekly")).toBe("2026-04-03");
  expect(nextExpectedDate("2026-12-29", "weekly")).toBe("2027-01-05");
  expect(nextExpectedDate("2026-03-27", "biweekly")).toBe("2026-04-10");
});

test("nextExpectedDate: monthly keeps the day, clamping to short months", () => {
  expect(nextExpectedDate("2026-03-27", "monthly")).toBe("2026-04-27");
  expect(nextExpectedDate("2026-01-31", "monthly")).toBe("2026-02-28");
  expect(nextExpectedDate("2024-01-31", "monthly")).toBe("2024-02-29");
  expect(nextExpectedDate("2026-03-31", "monthly")).toBe("2026-04-30");
  expect(nextExpectedDate("2026-12-15", "monthly")).toBe("2027-01-15");
});

test("nextExpectedDate: annual keeps the date, clamping leap day", () => {
  expect(nextExpectedDate("2026-06-01", "annual")).toBe("2027-06-01");
  expect(nextExpectedDate("2024-02-29", "annual")).toBe("2025-02-28");
});

test("nextExpectedDate: an annual leap-day anchor returns in the next leap year", () => {
  const anchorDay = 29;
  const after2025 = nextExpectedDate("2024-02-29", "annual", anchorDay);
  const after2026 = nextExpectedDate(after2025, "annual", anchorDay);
  const after2027 = nextExpectedDate(after2026, "annual", anchorDay);
  expect(after2025).toBe("2025-02-28");
  expect(after2026).toBe("2026-02-28");
  expect(after2027).toBe("2027-02-28");
  expect(nextExpectedDate(after2027, "annual", anchorDay)).toBe("2028-02-29");
});
