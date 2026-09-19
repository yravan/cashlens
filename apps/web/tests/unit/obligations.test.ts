import { expect, test } from "vitest";

import {
  parseObligationEndInput,
  parseObligationInput,
} from "@/lib/ledger/obligations";

const VALID = {
  accountId: "00000000-0000-4000-8000-000000000001",
  name: "  Rent  ",
  amount: "1800.00",
  currency: "USD",
  cadence: "monthly",
  startsOn: "2026-04-05",
  endsOn: null,
} as const;

test("a valid obligation body is normalized for storage", () => {
  expect(parseObligationInput(VALID)).toEqual({
    ok: true,
    input: {
      accountId: VALID.accountId,
      name: "Rent",
      amountMinor: 180000,
      currency: "USD",
      cadence: "monthly",
      startsOn: "2026-04-05",
      endsOn: null,
    },
  });
});

test("the obligation body is a closed plain object with exactly seven keys", () => {
  const invalid = { ok: false };
  expect(parseObligationInput({ ...VALID, extra: true })).toEqual(invalid);
  expect(parseObligationInput({ ...VALID, endsOn: undefined })).toEqual(invalid);
  expect(parseObligationInput(Object.assign(Object.create(null), VALID))).toEqual(invalid);
  expect(parseObligationInput([])).toEqual(invalid);
  expect(parseObligationInput(null)).toEqual(invalid);
});

test("the end body is exactly an empty plain object", () => {
  expect(parseObligationEndInput({})).toBe(true);
  for (const body of [{ ended: true }, [], null, Object.create(null), new (class Empty {})()]) {
    expect(parseObligationEndInput(body)).toBe(false);
  }
});

test("name is trimmed and limited to 1–200 characters", () => {
  expect(parseObligationInput({ ...VALID, name: `  ${"x".repeat(200)}  ` })).toMatchObject({
    ok: true,
    input: { name: "x".repeat(200) },
  });

  for (const name of ["", "   ", "x".repeat(201), 7, null]) {
    expect(parseObligationInput({ ...VALID, name })).toEqual({ ok: false });
  }
});

test("every obligation field rejects an invalid value type", () => {
  for (const [field, value] of [
    ["accountId", 7],
    ["name", 7],
    ["amount", 7],
    ["currency", 7],
    ["cadence", 7],
    ["startsOn", 7],
    ["endsOn", 7],
  ] as const) {
    expect(parseObligationInput({ ...VALID, [field]: value })).toEqual({ ok: false });
  }
});

test("amount is an exact positive major-unit decimal capped at 32 characters", () => {
  expect(parseObligationInput({ ...VALID, amount: "0.01" })).toMatchObject({
    ok: true,
    input: { amountMinor: 1 },
  });
  expect(
    parseObligationInput({ ...VALID, amount: "90071992547409.91" }),
  ).toMatchObject({ ok: true, input: { amountMinor: Number.MAX_SAFE_INTEGER } });
  expect(
    parseObligationInput({ ...VALID, amount: "1", currency: "JPY" }),
  ).toMatchObject({ ok: true, input: { amountMinor: 1 } });
  expect(
    parseObligationInput({ ...VALID, amount: "0.001", currency: "KWD" }),
  ).toMatchObject({ ok: true, input: { amountMinor: 1 } });

  for (const amount of [
    "0",
    "0.00",
    "+1",
    "-1",
    "1e3",
    "1,000",
    "1.",
    ".5",
    "1.001",
    "90071992547409.92",
    `${"0".repeat(31)}1.00`,
  ]) {
    expect(parseObligationInput({ ...VALID, amount })).toEqual({ ok: false });
  }
});

test("currency is exactly three uppercase ASCII letters", () => {
  expect(parseObligationInput({ ...VALID, currency: "KWD", amount: "1.234" })).toMatchObject({
    ok: true,
    input: { currency: "KWD", amountMinor: 1234 },
  });
  for (const currency of ["usd", "US", "USDX", "€UR", "", 7, null]) {
    expect(parseObligationInput({ ...VALID, currency })).toEqual({ ok: false });
  }
});

test("cadence is closed to the five declared schedule choices", () => {
  for (const cadence of ["once", "weekly", "biweekly", "monthly", "annual"] as const) {
    expect(parseObligationInput({ ...VALID, cadence })).toMatchObject({
      ok: true,
      input: { cadence },
    });
  }
  for (const cadence of ["daily", "quarterly", "toString", "", 1, null]) {
    expect(parseObligationInput({ ...VALID, cadence })).toEqual({ ok: false });
  }
});

test("start and end dates must be real ISO calendar days", () => {
  expect(
    parseObligationInput({
      ...VALID,
      startsOn: "2024-02-29",
      endsOn: "2025-02-28",
    }),
  ).toMatchObject({ ok: true });
  for (const startsOn of ["2026-02-30", "2026-4-05", "20260405", "2026-04-05T00:00:00Z", ""]) {
    expect(parseObligationInput({ ...VALID, startsOn })).toEqual({ ok: false });
  }
  for (const endsOn of ["2026-02-30", "2026-4-05", "20260405", "2026-04-05T00:00:00Z", ""]) {
    expect(parseObligationInput({ ...VALID, endsOn })).toEqual({ ok: false });
  }
});

test("end date is an inclusive bound that cannot precede the start", () => {
  expect(
    parseObligationInput({ ...VALID, startsOn: "2026-04-05", endsOn: "2026-04-05" }),
  ).toMatchObject({ ok: true });
  expect(
    parseObligationInput({ ...VALID, startsOn: "2026-04-05", endsOn: "2026-04-04" }),
  ).toEqual({ ok: false });
});

test("a one-time obligation cannot have an end date", () => {
  expect(parseObligationInput({ ...VALID, cadence: "once" })).toMatchObject({ ok: true });
  expect(
    parseObligationInput({ ...VALID, cadence: "once", endsOn: "2026-04-05" }),
  ).toEqual({ ok: false });
});
