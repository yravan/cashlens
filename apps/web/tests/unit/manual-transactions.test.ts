import { expect, test } from "vitest";

import {
  isEmptyMutationBody,
  manualAmountMinor,
  parseManualTransactionInput,
} from "@/lib/ledger/manual-transactions";
import { formatMajorUnits, parseMajorUnits } from "@/lib/ledger/minor-units";

const VALID = {
  accountId: "not-yet-resolved",
  direction: "outflow",
  amount: "90071992547409.90",
  date: "2024-02-29",
  description: "  Cash groceries  ",
  merchant: "   ",
  categoryId: "also-resolved-later",
} as const;

const invalid = { ok: false };

test("the request is a closed plain object with exactly seven required keys", () => {
  expect(parseManualTransactionInput(VALID)).toEqual({
    ok: true,
    input: {
      ...VALID,
      description: "Cash groceries",
      merchant: null,
    },
  });

  for (const key of Object.keys(VALID)) {
    const body: Record<string, unknown> = { ...VALID };
    delete body[key];
    expect(parseManualTransactionInput(body)).toEqual(invalid);
  }

  expect(parseManualTransactionInput({ ...VALID, currency: "EUR" })).toEqual(invalid);
  expect(parseManualTransactionInput(null)).toEqual(invalid);
  expect(parseManualTransactionInput([VALID])).toEqual(invalid);
  expect(parseManualTransactionInput(Object.assign(Object.create(null), VALID))).toEqual(invalid);
  expect(parseManualTransactionInput(Object.assign(new (class Input {})(), VALID))).toEqual(invalid);
  expect(parseManualTransactionInput(Object.create(VALID))).toEqual(invalid);
});

test("wrong JSON types fail while malformed string ids survive for resource lookup", () => {
  const wrongTypes: [keyof typeof VALID, unknown][] = [
    ["accountId", null],
    ["accountId", 1],
    ["direction", null],
    ["direction", true],
    ["amount", 12.34],
    ["amount", null],
    ["date", 20240911],
    ["date", null],
    ["description", null],
    ["description", ["cash"]],
    ["merchant", 1],
    ["merchant", false],
    ["categoryId", 1],
    ["categoryId", false],
  ];

  for (const [key, value] of wrongTypes) {
    expect(parseManualTransactionInput({ ...VALID, [key]: value })).toEqual(invalid);
  }

  expect(
    parseManualTransactionInput({
      ...VALID,
      accountId: "not-a-uuid",
      categoryId: "also-not-a-uuid",
    }),
  ).toEqual({
    ok: true,
    input: {
      ...VALID,
      accountId: "not-a-uuid",
      categoryId: "also-not-a-uuid",
      description: "Cash groceries",
      merchant: null,
    },
  });
});

test("direction is exactly money out or money in", () => {
  expect(parseManualTransactionInput({ ...VALID, direction: "outflow" }).ok).toBe(true);
  expect(parseManualTransactionInput({ ...VALID, direction: "inflow" }).ok).toBe(true);
  for (const direction of ["expense", "income", "OUTFLOW", "", "outflow "]) {
    expect(parseManualTransactionInput({ ...VALID, direction })).toEqual(invalid);
  }
});

test("date is a real ISO calendar day without a wall-clock restriction", () => {
  for (const date of ["1900-01-01", "2024-02-29", "9999-12-31"]) {
    expect(parseManualTransactionInput({ ...VALID, date }).ok).toBe(true);
  }
  for (const date of [
    "2026-2-01",
    "2026-02-30",
    "2026-04-31",
    "2026-13-01",
    "2026-09-11T00:00:00Z",
    "tomorrow",
  ]) {
    expect(parseManualTransactionInput({ ...VALID, date })).toEqual(invalid);
  }
});

test("description and merchant normalize only after their length boundary", () => {
  expect(parseManualTransactionInput({ ...VALID, description: ` ${"x".repeat(200)} ` })).toMatchObject({
    ok: true,
    input: { description: "x".repeat(200) },
  });
  expect(parseManualTransactionInput({ ...VALID, description: "   " })).toEqual(invalid);
  expect(parseManualTransactionInput({ ...VALID, description: "x".repeat(201) })).toEqual(invalid);

  expect(parseManualTransactionInput({ ...VALID, merchant: null })).toMatchObject({
    ok: true,
    input: { merchant: null },
  });
  expect(parseManualTransactionInput({ ...VALID, merchant: "   " })).toMatchObject({
    ok: true,
    input: { merchant: null },
  });
  expect(parseManualTransactionInput({ ...VALID, merchant: ` ${"m".repeat(200)} ` })).toMatchObject({
    ok: true,
    input: { merchant: "m".repeat(200) },
  });
  expect(parseManualTransactionInput({ ...VALID, merchant: "m".repeat(201) })).toEqual(invalid);
});

test("the body boundary accepts only bounded unsigned plain-decimal syntax", () => {
  for (const amount of ["0", "00.00", "1", "0.5", "1.234", "1".repeat(32)]) {
    expect(parseManualTransactionInput({ ...VALID, amount }).ok).toBe(true);
  }
  for (const amount of [
    "",
    "1".repeat(33),
    "-1",
    "+1",
    ".5",
    "1.",
    "1e2",
    "0x10",
    "1,000",
    "1 000",
    " 1",
    "1 ",
    "NaN",
    "Infinity",
    "$5",
  ]) {
    expect(parseManualTransactionInput({ ...VALID, amount })).toEqual(invalid);
  }
});

test("exact decimal parsing honors USD, JPY, and KWD exponents", () => {
  expect(parseMajorUnits("0", "USD")).toBe(0);
  expect(parseMajorUnits("0.5", "USD")).toBe(50);
  expect(parseMajorUnits("1.20", "USD")).toBe(120);
  expect(parseMajorUnits("0001.23", "USD")).toBe(123);
  expect(parseMajorUnits("980", "JPY")).toBe(980);
  expect(parseMajorUnits("1.5", "JPY")).toBeNull();
  expect(parseMajorUnits("1.234", "KWD")).toBe(1234);
  expect(parseMajorUnits("1.2345", "KWD")).toBeNull();
});

test("exact decimal parsing preserves safe-integer boundaries without floating point", () => {
  expect(parseMajorUnits("90071992547409.90", "USD")).toBe(9007199254740990);
  expect(parseMajorUnits("90071992547409.91", "USD")).toBe(Number.MAX_SAFE_INTEGER);
  expect(parseMajorUnits("90071992547409.92", "USD")).toBeNull();
  expect(parseMajorUnits("9007199254740991", "JPY")).toBe(Number.MAX_SAFE_INTEGER);
  expect(parseMajorUnits("9007199254740992", "JPY")).toBeNull();
  expect(parseMajorUnits("9007199254740.991", "KWD")).toBe(Number.MAX_SAFE_INTEGER);
  expect(parseMajorUnits("9007199254740.992", "KWD")).toBeNull();
  expect(parseMajorUnits(`${"0".repeat(64)}1.20`, "USD")).toBe(120);
});

test("exact decimal parsing rejects malformed input rather than throwing", () => {
  for (const amount of ["", "-1", "+1", ".5", "1.", "1e2", "1,000", " 1", "1 ", "NaN"]) {
    expect(parseMajorUnits(amount, "USD")).toBeNull();
  }
});

test("unadorned formatting is the exact inverse at each exponent", () => {
  expect(formatMajorUnits(0, "USD")).toBe("0");
  expect(formatMajorUnits(50, "USD")).toBe("0.5");
  expect(formatMajorUnits(120, "USD")).toBe("1.2");
  expect(formatMajorUnits(123, "USD")).toBe("1.23");
  expect(formatMajorUnits(980, "JPY")).toBe("980");
  expect(formatMajorUnits(1234, "KWD")).toBe("1.234");
  expect(formatMajorUnits(1200, "KWD")).toBe("1.2");
  expect(formatMajorUnits(9007199254740990, "USD")).toBe("90071992547409.9");

  for (const [minor, currency] of [
    [1, "USD"],
    [123456, "USD"],
    [Number.MAX_SAFE_INTEGER, "JPY"],
    [Number.MAX_SAFE_INTEGER, "KWD"],
  ] as const) {
    expect(parseMajorUnits(formatMajorUnits(minor, currency), currency)).toBe(minor);
  }
});

test("unadorned formatting rejects values outside its unsigned safe-integer domain", () => {
  for (const amount of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1, Number.POSITIVE_INFINITY, Number.NaN]) {
    expect(() => formatMajorUnits(amount, "USD")).toThrow(
      "minor units must be a non-negative safe integer",
    );
  }
});

test("account-dependent amount conversion rejects zero and applies direction exactly", () => {
  expect(manualAmountMinor("outflow", "12.34", "USD")).toBe(-1234);
  expect(manualAmountMinor("inflow", "12.34", "USD")).toBe(1234);
  expect(manualAmountMinor("outflow", "1.234", "KWD")).toBe(-1234);
  expect(manualAmountMinor("inflow", "1234", "JPY")).toBe(1234);
  expect(manualAmountMinor("outflow", "0", "USD")).toBeNull();
  expect(manualAmountMinor("inflow", "00.00", "USD")).toBeNull();
  expect(manualAmountMinor("inflow", "1.5", "JPY")).toBeNull();
  expect(manualAmountMinor("outflow", "90071992547409.92", "USD")).toBeNull();
});

test("delete accepts exactly one empty plain object", () => {
  expect(isEmptyMutationBody({})).toBe(true);
  expect(isEmptyMutationBody(null)).toBe(false);
  expect(isEmptyMutationBody([])).toBe(false);
  expect(isEmptyMutationBody({ confirmed: true })).toBe(false);
  expect(isEmptyMutationBody(Object.create(null))).toBe(false);
  expect(isEmptyMutationBody(new (class Empty {})())).toBe(false);
});
