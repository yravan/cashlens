import { expect, test } from "vitest";

import {
  HISTORY_PAGE_SIZE,
  historyQueryString,
  isFiltered,
  parseHistoryQuery,
  searchPattern,
  type HistoryQuery,
} from "@/lib/ledger/history-query";

const ACCOUNT = "00000000-0000-4000-8000-000000000101";
const CATEGORY = "00000000-0000-4000-8000-000000001007";

const EMPTY: HistoryQuery = {
  q: null,
  accountId: null,
  categoryId: null,
  from: null,
  to: null,
  currency: null,
  minMinor: null,
  maxMinor: null,
  page: 1,
};

const valid = (query: Partial<HistoryQuery>) => ({ ok: true, query: { ...EMPTY, ...query } });
const invalid = { ok: false };

test("page size is the fixed 50-row contract", () => {
  expect(HISTORY_PAGE_SIZE).toBe(50);
});

test("no parameters parse to the unfiltered first page", () => {
  expect(parseHistoryQuery({})).toEqual(valid({}));
  expect(isFiltered(EMPTY)).toBe(false);
});

test("every parameter canonicalizes together", () => {
  expect(
    parseHistoryQuery({
      q: "  Acme Corp  ",
      account: ACCOUNT,
      category: CATEGORY,
      from: "2026-03-01",
      to: "2026-03-31",
      currency: "USD",
      min: "10",
      max: "2500.50",
      page: "3",
    }),
  ).toEqual(
    valid({
      q: "Acme Corp",
      accountId: ACCOUNT,
      categoryId: CATEGORY,
      from: "2026-03-01",
      to: "2026-03-31",
      currency: "USD",
      minMinor: 1000,
      maxMinor: 250050,
      page: 3,
    }),
  );
});

test("empty and whitespace-only values are absent, as native GET forms submit them", () => {
  expect(
    parseHistoryQuery({ q: "", account: "", category: "", from: "", to: "", currency: "", min: "", max: "", page: "" }),
  ).toEqual(valid({}));
  expect(parseHistoryQuery({ q: "   " })).toEqual(valid({}));
});

test("unknown parameters are rejected, never ignored", () => {
  expect(parseHistoryQuery({ sort: "amount" })).toEqual(invalid);
  expect(parseHistoryQuery({ q: "coffee", limit: "500" })).toEqual(invalid);
  expect(parseHistoryQuery({ userId: ACCOUNT })).toEqual(invalid);
});

test("a repeated scalar parameter is rejected, never widened", () => {
  for (const key of ["q", "account", "category", "from", "to", "currency", "min", "max", "page"]) {
    expect(parseHistoryQuery({ currency: "USD", [key]: ["a", "b"] })).toEqual(invalid);
  }
});

test("q is a trimmed 1-100 character literal", () => {
  expect(parseHistoryQuery({ q: "a" })).toEqual(valid({ q: "a" }));
  expect(parseHistoryQuery({ q: "x".repeat(100) })).toEqual(valid({ q: "x".repeat(100) }));
  expect(parseHistoryQuery({ q: "x".repeat(101) })).toEqual(invalid);
  expect(parseHistoryQuery({ q: ` ${"x".repeat(100)} ` })).toEqual(valid({ q: "x".repeat(100) }));
  expect(parseHistoryQuery({ q: "50% off_sale" })).toEqual(valid({ q: "50% off_sale" }));
});

test("account and category must be UUIDs", () => {
  expect(parseHistoryQuery({ account: ACCOUNT.toUpperCase() })).toEqual(
    valid({ accountId: ACCOUNT.toUpperCase() }),
  );
  for (const value of [
    "not-a-uuid",
    "0000000000004000800000000000101",
    `${ACCOUNT} `,
    `${ACCOUNT}'`,
    "00000000-0000-4000-8000-00000000010g",
  ]) {
    expect(parseHistoryQuery({ account: value })).toEqual(invalid);
    expect(parseHistoryQuery({ category: value })).toEqual(invalid);
  }
});

test("dates are strict real calendar dates", () => {
  expect(parseHistoryQuery({ from: "2024-02-29" })).toEqual(valid({ from: "2024-02-29" }));
  for (const value of [
    "2026-3-01",
    "2026-03-1",
    "03/01/2026",
    "2026-13-01",
    "2026-00-10",
    "2026-02-30",
    "2026-02-29",
    "2026-04-31",
    "20260301",
    "2026-03-01T00:00:00Z",
    "yesterday",
  ]) {
    expect(parseHistoryQuery({ from: value })).toEqual(invalid);
    expect(parseHistoryQuery({ to: value })).toEqual(invalid);
  }
});

test("a reversed date range is rejected; a single-day range is not", () => {
  expect(parseHistoryQuery({ from: "2026-03-02", to: "2026-03-01" })).toEqual(invalid);
  expect(parseHistoryQuery({ from: "2026-03-01", to: "2026-03-01" })).toEqual(
    valid({ from: "2026-03-01", to: "2026-03-01" }),
  );
});

test("currency is a strict uppercase three-letter code", () => {
  expect(parseHistoryQuery({ currency: "EUR" })).toEqual(valid({ currency: "EUR" }));
  for (const value of ["usd", "Usd", "US", "USDT", "US1", "$", " USD"]) {
    expect(parseHistoryQuery({ currency: value })).toEqual(invalid);
  }
});

test("amounts require the currency that gives them meaning", () => {
  expect(parseHistoryQuery({ min: "10" })).toEqual(invalid);
  expect(parseHistoryQuery({ max: "10" })).toEqual(invalid);
  expect(parseHistoryQuery({ min: "10", max: "20" })).toEqual(invalid);
});

test("amounts convert exactly at the currency's exponent", () => {
  expect(parseHistoryQuery({ currency: "USD", min: "0" })).toEqual(
    valid({ currency: "USD", minMinor: 0 }),
  );
  expect(parseHistoryQuery({ currency: "USD", min: "0.5" })).toEqual(
    valid({ currency: "USD", minMinor: 50 }),
  );
  expect(parseHistoryQuery({ currency: "USD", max: "1234.56" })).toEqual(
    valid({ currency: "USD", maxMinor: 123456 }),
  );
  expect(parseHistoryQuery({ currency: "JPY", min: "980" })).toEqual(
    valid({ currency: "JPY", minMinor: 980 }),
  );
  expect(parseHistoryQuery({ currency: "BHD", min: "1.234" })).toEqual(
    valid({ currency: "BHD", minMinor: 1234 }),
  );
  expect(parseHistoryQuery({ currency: "USD", min: "0.615" })).toEqual(invalid);
  expect(parseHistoryQuery({ currency: "JPY", min: "1.5" })).toEqual(invalid);
  expect(parseHistoryQuery({ currency: "BHD", min: "1.2345" })).toEqual(invalid);
});

test("amounts are non-negative plain decimals, nothing else", () => {
  for (const value of ["-1", "+1", "1e2", "0x10", ".5", "1.", "1,000", "1 000", "NaN", "Infinity", "$5", "abc"]) {
    expect(parseHistoryQuery({ currency: "USD", min: value })).toEqual(invalid);
    expect(parseHistoryQuery({ currency: "USD", max: value })).toEqual(invalid);
  }
});

test("amounts past the safe-integer range are rejected, never rounded", () => {
  expect(parseHistoryQuery({ currency: "USD", min: "90071992547409.91" })).toEqual(
    valid({ currency: "USD", minMinor: 9007199254740991 }),
  );
  expect(parseHistoryQuery({ currency: "USD", min: "90071992547409.92" })).toEqual(invalid);
  expect(parseHistoryQuery({ currency: "USD", min: "9".repeat(30) })).toEqual(invalid);
});

test("a reversed amount range is rejected; an exact-amount range is not", () => {
  expect(parseHistoryQuery({ currency: "USD", min: "20", max: "10" })).toEqual(invalid);
  expect(parseHistoryQuery({ currency: "USD", min: "10", max: "10" })).toEqual(
    valid({ currency: "USD", minMinor: 1000, maxMinor: 1000 }),
  );
});

test("page is a strict positive integer with a safe offset", () => {
  expect(parseHistoryQuery({ page: "1" })).toEqual(valid({ page: 1 }));
  expect(parseHistoryQuery({ page: "999" })).toEqual(valid({ page: 999 }));
  for (const value of ["0", "-1", "01", "1.5", "1e2", "two", " 1", "9".repeat(20)]) {
    expect(parseHistoryQuery({ page: value })).toEqual(invalid);
  }
});

test("isFiltered reflects any active filter but never bare pagination", () => {
  expect(isFiltered({ ...EMPTY, page: 7 })).toBe(false);
  expect(isFiltered({ ...EMPTY, q: "coffee" })).toBe(true);
  expect(isFiltered({ ...EMPTY, accountId: ACCOUNT })).toBe(true);
  expect(isFiltered({ ...EMPTY, categoryId: CATEGORY })).toBe(true);
  expect(isFiltered({ ...EMPTY, from: "2026-01-01" })).toBe(true);
  expect(isFiltered({ ...EMPTY, to: "2026-01-01" })).toBe(true);
  expect(isFiltered({ ...EMPTY, currency: "USD" })).toBe(true);
  expect(isFiltered({ ...EMPTY, currency: "USD", minMinor: 0 })).toBe(true);
  expect(isFiltered({ ...EMPTY, currency: "USD", maxMinor: 0 })).toBe(true);
});

test("the search pattern escapes wildcards so q stays literal", () => {
  expect(searchPattern("acme")).toBe("%acme%");
  expect(searchPattern("50%_off\\")).toBe("%50\\%\\_off\\\\%");
  expect(searchPattern("%%")).toBe("%\\%\\%%");
});

test("a query serializes back to a URL that re-parses identically", () => {
  const parsed = parseHistoryQuery({
    q: "maple market",
    account: ACCOUNT,
    category: CATEGORY,
    from: "2026-03-01",
    to: "2026-03-31",
    currency: "USD",
    min: "12.50",
    max: "1000",
    page: "2",
  });
  if (!parsed.ok) throw new Error("expected a valid query");

  const serialized = historyQueryString(parsed.query, 2);
  expect(serialized).toBe(
    `q=maple+market&account=${ACCOUNT}&category=${CATEGORY}&from=2026-03-01&to=2026-03-31&currency=USD&min=12.5&max=1000&page=2`,
  );
  expect(parseHistoryQuery(Object.fromEntries(new URLSearchParams(serialized)))).toEqual({
    ok: true,
    query: { ...parsed.query, page: 2 },
  });
});

test("serialization omits inactive filters and the default page", () => {
  expect(historyQueryString(EMPTY, 1)).toBe("");
  expect(historyQueryString({ ...EMPTY, q: "coffee" }, 1)).toBe("q=coffee");
  expect(historyQueryString({ ...EMPTY, q: "coffee" }, 2)).toBe("q=coffee&page=2");
  expect(historyQueryString({ ...EMPTY, currency: "JPY", minMinor: 980 }, 1)).toBe(
    "currency=JPY&min=980",
  );
  expect(historyQueryString({ ...EMPTY, currency: "BHD", maxMinor: 1200 }, 1)).toBe(
    "currency=BHD&max=1.2",
  );
});
