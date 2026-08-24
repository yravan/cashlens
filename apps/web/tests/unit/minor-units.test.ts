import { expect, test } from "vitest";

import { toMinorUnits } from "@/lib/ledger/minor-units";

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
