import { expect, test } from "vitest";

import { formatMinorUnits, toMinorUnits } from "@/lib/ledger/minor-units";

test.each([
  [110, "USD", 11000],
  [110.94, "USD", 11094],
  [210.33, "USD", 21033],
  [0.01, "USD", 1],
  [0, "USD", 0],
  [-67.42, "USD", -6742],
  [2000, "USD", 200000],
  [4.56, "EUR", 456],
  [0.615, "USD", 62],
  [-0.615, "USD", -62],
  [1.005, "USD", 101],
  [-1.005, "USD", -101],
  [12345, "JPY", 12345],
  [-987, "KRW", -987],
  [1000.5, "ISK", 1001],
  [12.345, "KWD", 12345],
  [-3.141, "BHD", -3141],
  [99.99, "XXX", 9999],
  [56.5, "EUR", 5650],
])("%s %s -> %s minor units", (amount, currency, expected) => {
  expect(toMinorUnits(amount, currency)).toBe(expected);
});

test("negative zero normalizes to zero", () => {
  expect(Object.is(toMinorUnits(-0, "USD"), 0)).toBe(true);
  expect(Object.is(toMinorUnits(-0.0001, "USD"), 0)).toBe(true);
});

test.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
  "%s is rejected",
  (amount) => {
    expect(() => toMinorUnits(amount, "USD")).toThrow("finite");
  },
);

test("amounts that overflow safe integers are rejected", () => {
  expect(() => toMinorUnits(Number.MAX_SAFE_INTEGER, "USD")).toThrow("safe integer");
  expect(() => toMinorUnits(-Number.MAX_SAFE_INTEGER, "KWD")).toThrow("safe integer");
});

test.each([
  [1734120, "USD", "$17,341.20"],
  [120450, "EUR", "€1,204.50"],
  [51245, "USD", "$512.45"],
  [-51245, "USD", "-$512.45"],
  [0, "USD", "$0.00"],
  [-0, "USD", "$0.00"],
  [1, "USD", "$0.01"],
  [-1, "USD", "-$0.01"],
  [99, "USD", "$0.99"],
  [100, "USD", "$1.00"],
  [5, "EUR", "€0.05"],
  [123456789, "USD", "$1,234,567.89"],
  [9007199254740991, "USD", "$90,071,992,547,409.91"],
  [-9007199254740991, "USD", "-$90,071,992,547,409.91"],
  [12345, "JPY", "¥12,345"],
  [-987, "KRW", "-₩987"],
  [123456, "BHD", "BHD 123.456"],
  [123456, "IQD", "IQD 123.456"],
  [9999, "XXX", "¤99.99"],
])("%s %s formats as %s", (minor, currency, expected) => {
  expect(formatMinorUnits(minor, currency)).toBe(expected);
});

test.each([0.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])(
  "%s minor units are rejected",
  (minor) => {
    expect(() => formatMinorUnits(minor, "USD")).toThrow("safe integer");
  },
);
