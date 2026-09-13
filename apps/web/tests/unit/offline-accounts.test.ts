import { expect, test } from "vitest";

import {
  OFFLINE_CURRENCIES,
  OFFLINE_TYPE_LABELS,
  OWED_TYPES,
  offlineBalanceMinor,
  parseOfflineAccountInput,
  parseOfflineBalanceInput,
  parseRenameInput,
} from "@/lib/ledger/offline-accounts";

const VALID = {
  name: "  Kalshi  ",
  type: "other",
  currency: "USD",
  balance: "250.00",
  reportedOn: "2026-09-12",
} as const;
const invalid = { ok: false };

test("the create body is a closed plain object with exactly five keys", () => {
  expect(parseOfflineAccountInput(VALID)).toEqual({
    ok: true,
    input: { ...VALID, name: "Kalshi" },
  });
  expect(parseOfflineAccountInput({ ...VALID, extra: 1 })).toEqual(invalid);
  expect(
    parseOfflineAccountInput({ name: "x", type: "other", currency: "USD", balance: "1" }),
  ).toEqual(invalid);
  expect(parseOfflineAccountInput(Object.create(null))).toEqual(invalid);
  expect(parseOfflineAccountInput([])).toEqual(invalid);
  expect(parseOfflineAccountInput(null)).toEqual(invalid);
  expect(parseOfflineAccountInput("{}")).toEqual(invalid);
});

test("name is trimmed and bounded to 1–200 characters", () => {
  expect(parseOfflineAccountInput({ ...VALID, name: "   " })).toEqual(invalid);
  expect(parseOfflineAccountInput({ ...VALID, name: "x".repeat(201) })).toEqual(invalid);
  expect(parseOfflineAccountInput({ ...VALID, name: ` ${"x".repeat(200)} ` })).toMatchObject({
    ok: true,
  });
  expect(parseOfflineAccountInput({ ...VALID, name: 7 })).toEqual(invalid);
});

test("type is one of the five ledger account types and every type has a label", () => {
  for (const type of Object.keys(OFFLINE_TYPE_LABELS)) {
    expect(parseOfflineAccountInput({ ...VALID, type })).toMatchObject({ ok: true, input: { type } });
  }
  expect(OFFLINE_TYPE_LABELS).toEqual({
    depository: "Cash",
    credit: "Credit card",
    loan: "Loan",
    investment: "Investment",
    other: "Other",
  });
  expect([...OWED_TYPES].sort()).toEqual(["credit", "loan"]);
  expect(parseOfflineAccountInput({ ...VALID, type: "brokerage" })).toEqual(invalid);
  expect(parseOfflineAccountInput({ ...VALID, type: "toString" })).toEqual(invalid);
  expect(parseOfflineAccountInput({ ...VALID, type: null })).toEqual(invalid);
});

test("currency is three uppercase letters and the shortlist is well-formed", () => {
  for (const currency of ["usd", "US", "USDX", "€UR", ""]) {
    expect(parseOfflineAccountInput({ ...VALID, currency })).toEqual(invalid);
  }
  expect(parseOfflineAccountInput({ ...VALID, currency: "KWD" })).toMatchObject({ ok: true });
  expect(OFFLINE_CURRENCIES).toEqual(["USD", "EUR", "GBP", "CAD", "AUD", "JPY", "CHF", "INR"]);
});

test("balance is a signed plain decimal of at most 32 characters", () => {
  for (const balance of ["", "+1", "1,000", "1.", ".5", "1e3", "NaN", "--1", "-", `${"9".repeat(32)}.0`]) {
    expect(parseOfflineAccountInput({ ...VALID, balance })).toEqual(invalid);
    expect(parseOfflineBalanceInput({ balance, reportedOn: "2026-09-12" })).toEqual(invalid);
  }
  for (const balance of ["0", "-0", "-12.5", "1".repeat(32)]) {
    expect(parseOfflineBalanceInput({ balance, reportedOn: "2026-09-12" })).toEqual({
      ok: true,
      input: { balance, reportedOn: "2026-09-12" },
    });
  }
  expect(parseOfflineBalanceInput({ balance: 12, reportedOn: "2026-09-12" })).toEqual(invalid);
});

test("reportedOn must be a real calendar day", () => {
  for (const reportedOn of ["2026-02-30", "2026-9-1", "20260912", "2026-09-12T00:00:00Z", "", null]) {
    expect(parseOfflineBalanceInput({ balance: "1", reportedOn })).toEqual(invalid);
  }
  expect(parseOfflineBalanceInput({ balance: "1", reportedOn: "2024-02-29" })).toMatchObject({
    ok: true,
  });
});

test("the rename body is closed to exactly one key and shares the create name rule", () => {
  expect(parseRenameInput({ name: "  Kalshi  " })).toEqual({ ok: true, input: { name: "Kalshi" } });
  expect(parseRenameInput({ name: ` ${"x".repeat(200)} ` })).toEqual({
    ok: true,
    input: { name: "x".repeat(200) },
  });
  for (const name of ["", "   ", "x".repeat(201), 7, null, undefined, ["x"]]) {
    expect(parseRenameInput({ name })).toEqual(invalid);
  }
  for (const body of [{}, { name: "x", extra: 1 }, { name: "x", balance: "1" }, { title: "x" }]) {
    expect(parseRenameInput(body)).toEqual(invalid);
  }
  for (const body of [null, [], "{}", Object.create(null), "Kalshi"]) {
    expect(parseRenameInput(body)).toEqual(invalid);
  }
});

test("the balance body is closed to exactly two keys", () => {
  expect(parseOfflineBalanceInput({ balance: "1", reportedOn: "2026-09-12", name: "x" })).toEqual(
    invalid,
  );
  expect(parseOfflineBalanceInput({ balance: "1" })).toEqual(invalid);
  expect(parseOfflineBalanceInput({})).toEqual(invalid);
});

test("balances convert exactly at the currency exponent with the sign applied", () => {
  expect(offlineBalanceMinor("250.00", "USD")).toBe(25000);
  expect(offlineBalanceMinor("-12.5", "USD")).toBe(-1250);
  expect(offlineBalanceMinor("0", "USD")).toBe(0);
  expect(Object.is(offlineBalanceMinor("-0", "USD"), 0)).toBe(true);
  expect(offlineBalanceMinor("1234", "JPY")).toBe(1234);
  expect(offlineBalanceMinor("1.234", "KWD")).toBe(1234);
  expect(offlineBalanceMinor("1.234", "USD")).toBeNull();
  expect(offlineBalanceMinor("1.5", "JPY")).toBeNull();
  expect(offlineBalanceMinor("1.2345", "KWD")).toBeNull();
  expect(offlineBalanceMinor("90071992547409.91", "USD")).toBe(9007199254740991);
  expect(offlineBalanceMinor("90071992547409.92", "USD")).toBeNull();
  expect(offlineBalanceMinor("-90071992547409.91", "USD")).toBe(-9007199254740991);
});
