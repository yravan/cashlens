import { createHash } from "node:crypto";
import Papa from "papaparse";
import { expect, test } from "vitest";

import {
  guessMapping,
  importRows,
  interpretStatement,
  MAX_IMPORT_BODY_BYTES,
  MAX_IMPORT_ROWS,
  normalizeAmount,
  parseStatementDate,
  parseStatementImportInput,
  statementAmount,
  type StatementMapping,
} from "@/lib/ledger/statement-import";

const invalid = { ok: false };
const row = (date: string, amount: string, description: string) => ({ date, amount, description });
const mapping = (over: Partial<StatementMapping> = {}): StatementMapping => ({
  date: "Date",
  amount: "Amount",
  outflow: "",
  inflow: "",
  description: "Description",
  layout: "signed",
  order: "mdy",
  decimalMark: ".",
  flip: false,
  ...over,
});
const key = (date: string, minor: number, description: string, occurrence: number) =>
  createHash("sha256").update(`${date}\n${minor}\n${description}\n${occurrence}`).digest("hex");

test.each([
  ["2026-03-14", "ymd", "2026-03-14"],
  ["2026/3/4", "ymd", "2026-03-04"],
  ["2026.03.14", "ymd", "2026-03-14"],
  [" 2026-03-14 ", "ymd", "2026-03-14"],
  ["03/14/2026", "mdy", "2026-03-14"],
  ["3/4/2026", "mdy", "2026-03-04"],
  ["3-4-2026", "mdy", "2026-03-04"],
  ["14/03/2026", "dmy", "2026-03-14"],
  ["14.3.2026", "dmy", "2026-03-14"],
  ["29/02/2024", "dmy", "2024-02-29"],
  ["14/03/2026", "mdy", null],
  ["2026-02-30", "ymd", null],
  ["29/02/2026", "dmy", null],
  ["2026-3-14", "mdy", null],
  ["03/14/26", "mdy", null],
  ["14 Mar 2026", "dmy", null],
  ["2026-03-14T10:00:00", "ymd", null],
  ["2026-03-14 10:00", "ymd", null],
  ["20260314", "ymd", null],
  ["0/14/2026", "mdy", null],
  ["2026-03-1444", "ymd", null],
  ["", "ymd", null],
] as const)("date %j read as %s is %j", (value, order, expected) => {
  expect(parseStatementDate(value, order)).toBe(expected);
});

test.each([
  ["12.34", ".", "12.34"],
  ["-12.34", ".", "-12.34"],
  ["+12.34", ".", "12.34"],
  ["12", ".", "12"],
  ["0.00", ".", "0.00"],
  ["1,234.56", ".", "1234.56"],
  ["1,234,567", ".", "1234567"],
  ["12,34", ".", "1234"],
  ["$1,234.56", ".", "1234.56"],
  ["-$12.34", ".", "-12.34"],
  ["$-12.34", ".", "-12.34"],
  ["(12.34)", ".", "-12.34"],
  ["($1,234.56)", ".", "-1234.56"],
  ["−12.34", ".", "-12.34"],
  [" 12.34 ", ".", "12.34"],
  ["12,34", ",", "12.34"],
  ["1.234,56", ",", "1234.56"],
  ["1 234,56", ",", "1234.56"],
  ["€ 1.234,56", ",", "1234.56"],
  ["-1.234,56", ",", "-1234.56"],
  ["1234", ",", "1234"],
  ["", ".", null],
  ["-", ".", null],
  ["()", ".", null],
  ["12.34 DR", ".", null],
  ["USD 12.34", ".", null],
  ["1e3", ".", null],
  ["12.34.56", ".", null],
  ["12,34,56", ",", null],
  [".5", ".", null],
  ["5.", ".", null],
  ["12.34-", ".", null],
  ["--12.34", ".", null],
  ["(12.34", ".", null],
] as const)("amount %j with decimal mark %j is %j", (value, mark, expected) => {
  expect(normalizeAmount(value, mark)).toBe(expected);
});

test("a single amount column flips as a whole and two columns pick the side that moves", () => {
  expect(statementAmount({ amount: "(12.34)" }, ".", false)).toBe("-12.34");
  expect(statementAmount({ amount: "12.34" }, ".", true)).toBe("-12.34");
  expect(statementAmount({ amount: "-12.34" }, ".", true)).toBe("12.34");
  expect(statementAmount({ amount: "0.00" }, ".", true)).toBe("0.00");
  expect(statementAmount({ amount: "abc" }, ".", true)).toBeNull();
  expect(statementAmount({ outflow: "12.34", inflow: "" }, ".", false)).toBe("-12.34");
  expect(statementAmount({ outflow: "", inflow: "1,500.00" }, ".", false)).toBe("1500.00");
  expect(statementAmount({ outflow: "12.34", inflow: "0.00" }, ".", false)).toBe("-12.34");
  expect(statementAmount({ outflow: "0", inflow: "5" }, ".", false)).toBe("5");
  expect(statementAmount({ outflow: "-12.34", inflow: "" }, ".", false)).toBe("-12.34");
  expect(statementAmount({ outflow: "", inflow: "-5.00" }, ".", false)).toBe("5.00");
  expect(statementAmount({ outflow: "12.34", inflow: "" }, ".", true)).toBe("12.34");
  expect(statementAmount({ outflow: "", inflow: "" }, ".", false)).toBe("0");
  expect(statementAmount({ outflow: "0.00", inflow: "0.00" }, ".", false)).toBe("0");
  expect(statementAmount({ outflow: "12.34", inflow: "5.00" }, ".", false)).toBeNull();
  expect(statementAmount({ outflow: "x", inflow: "" }, ".", false)).toBeNull();
  expect(statementAmount({ outflow: "", inflow: "1e3" }, ".", false)).toBeNull();
  expect(statementAmount({ outflow: "12,34", inflow: "" }, ",", false)).toBe("-12.34");
});

test("rows convert at the currency exponent and carry a normalized content key with an occurrence", async () => {
  await expect(
    importRows([row("2026-03-14", "-12.34", "Coffee  Shop"), row("2026-03-14", "1500", "Payroll")], "USD"),
  ).resolves.toEqual([
    {
      date: "2026-03-14",
      amountMinor: -1234,
      description: "Coffee  Shop",
      sourceId: key("2026-03-14", -1234, "coffee shop", 1),
    },
    {
      date: "2026-03-14",
      amountMinor: 150000,
      description: "Payroll",
      sourceId: key("2026-03-14", 150000, "payroll", 1),
    },
  ]);
  await expect(importRows([row("2026-03-14", "-1200", "Ramen")], "JPY")).resolves.toEqual([
    { date: "2026-03-14", amountMinor: -1200, description: "Ramen", sourceId: key("2026-03-14", -1200, "ramen", 1) },
  ]);
  await expect(importRows([row("2026-03-14", "1.234", "Fils")], "KWD")).resolves.toMatchObject([
    { amountMinor: 1234 },
  ]);
  await expect(importRows([row("2026-03-14", "1.5", "Half a yen")], "JPY")).resolves.toBeNull();
  await expect(importRows([row("2026-03-14", "1.234", "Tenth of a cent")], "USD")).resolves.toBeNull();
  await expect(importRows([row("2026-03-14", "0.00", "Nothing moved")], "USD")).resolves.toBeNull();
  await expect(importRows([row("2026-03-14", "-0", "Nothing moved")], "JPY")).resolves.toBeNull();
  await expect(
    importRows([row("2026-03-14", "1", "fine"), row("2026-03-14", "1.234", "too fine")], "USD"),
  ).resolves.toBeNull();
});

test("the key ignores case, whitespace, and amount spelling, and numbers identical tuples in file order", async () => {
  const rows = await importRows(
    [
      row("2026-03-14", "-12.34", "COFFEE SHOP"),
      row("2026-03-14", "-12.34", " coffee\tshop "),
      row("2026-03-14", "-0012.34", "Coffee Shop"),
      row("2026-03-15", "-12.34", "Coffee Shop"),
      row("2026-03-14", "-12.35", "Coffee Shop"),
      row("2026-03-14", "12.34", "Coffee Shop"),
      row("2026-03-14", "-12.34", "Coffee Shop Downtown"),
    ],
    "USD",
  );
  expect(rows?.map((entry) => entry.sourceId)).toEqual([
    key("2026-03-14", -1234, "coffee shop", 1),
    key("2026-03-14", -1234, "coffee shop", 2),
    key("2026-03-14", -1234, "coffee shop", 3),
    key("2026-03-15", -1234, "coffee shop", 1),
    key("2026-03-14", -1235, "coffee shop", 1),
    key("2026-03-14", 1234, "coffee shop", 1),
    key("2026-03-14", -1234, "coffee shop downtown", 1),
  ]);
  expect(rows?.map((entry) => entry.description)).toEqual([
    "COFFEE SHOP",
    " coffee\tshop ",
    "Coffee Shop",
    "Coffee Shop",
    "Coffee Shop",
    "Coffee Shop",
    "Coffee Shop Downtown",
  ]);
  expect(rows?.[0].sourceId).toMatch(/^[0-9a-f]{64}$/);
});

const VALID_ROW = row("2026-03-14", "-12.34", "  Coffee ");
const NONE = { date: null, amount: null, outflow: null, inflow: null, description: null };

test("the import body is a closed object holding 1 to 5,000 closed rows", () => {
  expect(parseStatementImportInput({ rows: [VALID_ROW] })).toEqual({
    ok: true,
    input: { rows: [row("2026-03-14", "-12.34", "Coffee")] },
  });
  expect(
    parseStatementImportInput(
      JSON.parse('{"rows":[{"date":"2026-03-14","amount":"1","description":"x"}],"__proto__":{"a":1}}'),
    ),
  ).toEqual(invalid);
  expect(parseStatementImportInput({ rows: [VALID_ROW], extra: 1 })).toEqual(invalid);
  expect(parseStatementImportInput({})).toEqual(invalid);
  expect(parseStatementImportInput([VALID_ROW])).toEqual(invalid);
  expect(parseStatementImportInput(null)).toEqual(invalid);
  expect(parseStatementImportInput("rows")).toEqual(invalid);
  expect(parseStatementImportInput({ rows: VALID_ROW })).toEqual(invalid);
  expect(parseStatementImportInput({ rows: [] })).toEqual(invalid);
  expect(MAX_IMPORT_ROWS).toBe(5000);
  expect(parseStatementImportInput({ rows: Array(MAX_IMPORT_ROWS).fill(VALID_ROW) }).ok).toBe(true);
  expect(parseStatementImportInput({ rows: Array(MAX_IMPORT_ROWS + 1).fill(VALID_ROW) })).toEqual(invalid);
  expect(MAX_IMPORT_BODY_BYTES).toBe(1024 * 1024);
});

test.each([
  [{ ...VALID_ROW, extra: 1 }],
  [{ date: "2026-03-14", amount: "1" }],
  [["2026-03-14", "1", "x"]],
  [null],
  [{ ...VALID_ROW, date: "2026-02-30" }],
  [{ ...VALID_ROW, date: "14/03/2026" }],
  [{ ...VALID_ROW, date: 20260314 }],
  [{ ...VALID_ROW, amount: 12.34 }],
  [{ ...VALID_ROW, amount: "" }],
  [{ ...VALID_ROW, amount: "+1" }],
  [{ ...VALID_ROW, amount: "1e3" }],
  [{ ...VALID_ROW, amount: "12." }],
  [{ ...VALID_ROW, amount: ".5" }],
  [{ ...VALID_ROW, amount: "1,234.56" }],
  [{ ...VALID_ROW, amount: "0" }],
  [{ ...VALID_ROW, amount: "0.00" }],
  [{ ...VALID_ROW, amount: "-0" }],
  [{ ...VALID_ROW, amount: `1${"0".repeat(32)}` }],
  [{ ...VALID_ROW, description: "" }],
  [{ ...VALID_ROW, description: "   " }],
  [{ ...VALID_ROW, description: "x".repeat(201) }],
  [{ ...VALID_ROW, description: null }],
])("row %j is rejected and rejects the whole body", (bad) => {
  expect(parseStatementImportInput({ rows: [VALID_ROW, bad] })).toEqual(invalid);
});

test("a description of exactly 200 characters and a 32-character amount are accepted", () => {
  const long = "x".repeat(200);
  const amount = `-${"9".repeat(31)}`;
  expect(parseStatementImportInput({ rows: [row("2026-03-14", amount, ` ${long} `)] })).toEqual({
    ok: true,
    input: { rows: [row("2026-03-14", amount, long)] },
  });
});

test("header guessing picks the first synonym match per field, case- and space-insensitively", () => {
  expect(guessMapping(["Transaction Date", "Description", "Amount", "Balance"])).toEqual({
    ...NONE,
    date: "Transaction Date",
    amount: "Amount",
    description: "Description",
  });
  expect(guessMapping(["  DATE ", "Payee", "Debit", "Credit"])).toEqual({
    ...NONE,
    date: "  DATE ",
    outflow: "Debit",
    inflow: "Credit",
    description: "Payee",
  });
  expect(guessMapping(["Posted   Date", "Date", "Money Out", "Money In", "Memo", "Name"])).toEqual({
    ...NONE,
    date: "Posted   Date",
    outflow: "Money Out",
    inflow: "Money In",
    description: "Memo",
  });
  expect(guessMapping(["Foo", "Bar"])).toEqual(NONE);
  expect(guessMapping([])).toEqual(NONE);
});

test("preview interpretation maps records through the chosen columns and settings", () => {
  const records = [
    { Date: "03/10/2026", Description: " E2E FARMERS MARKET ", Amount: "(12.50)" },
    { Date: "04/01/2026", Description: "E2E BOOK SALE", Amount: "$9.75" },
  ];
  expect(interpretStatement({ data: records, errors: [] }, mapping(), "USD")).toEqual({
    rows: [
      { date: "2026-03-10", amount: "-12.50", description: "E2E FARMERS MARKET", amountMinor: -1250 },
      { date: "2026-04-01", amount: "9.75", description: "E2E BOOK SALE", amountMinor: 975 },
    ],
    malformed: [],
  });
  expect(interpretStatement({ data: records, errors: [] }, mapping({ order: "ymd" }), "USD")).toEqual({
    rows: [],
    malformed: [2, 3],
  });
  expect(
    interpretStatement({ data: records, errors: [] }, mapping({ flip: true }), "USD").rows.map(
      (row) => row.amountMinor,
    ),
  ).toEqual([1250, -975]);
});

test("quote errors fail the entire file closed", () => {
  const parsed = Papa.parse<Record<string, string>>(
    `Date,Amount,Description
03/10/2026,(12.50),E2E FARMERS MARKET
03/20/2026,(6.00),"E2E LAUNDRY`,
    {
      header: true,
      skipEmptyLines: "greedy",
      transformHeader: (header) => header.trim(),
    },
  );
  expect(interpretStatement({ data: parsed.data, errors: parsed.errors }, mapping(), "USD")).toEqual({
    rows: [],
    malformed: [2, 3],
  });
});

test("prototype-chain mapped cells are malformed instead of throwing", () => {
  expect(
    interpretStatement(
      {
        data: [{ Date: "03/10/2026", Description: "E2E COFFEE" }],
        errors: [],
      },
      mapping({ amount: "constructor" }),
      "USD",
    ),
  ).toEqual({
    rows: [],
    malformed: [2],
  });
});

test("preview interpretation flags parser errors, ambiguous pairs, zero, exponent, and blank descriptions by spreadsheet row", () => {
  const split = mapping({ layout: "split", outflow: "Debit", inflow: "Credit", order: "dmy", decimalMark: "," });
  expect(
    interpretStatement(
      {
        data: [
          { Date: "10.03.2026", Debit: "1.234,50", Credit: "", Description: "RENT" },
          { Date: "11.03.2026", Debit: "", Credit: "20,00", Description: "REFUND" },
          { Date: "12.03.2026", Debit: "5,00", Credit: "5,00", Description: "BOTH" },
          { Date: "13.03.2026", Debit: "", Credit: "", Description: "NEITHER" },
        ],
        errors: [{ row: 1 }, {}],
      },
      split,
      "EUR",
    ),
  ).toEqual({
    rows: [{ date: "2026-03-10", amount: "-1234.50", description: "RENT", amountMinor: -123450 }],
    malformed: [3, 4, 5],
  });
  expect(
    interpretStatement(
      {
        data: [
          { Date: "2026-03-10", Amount: "12.5", Description: "FRACTION" },
          { Date: "2026-03-10", Amount: "0", Description: "ZERO" },
          { Date: "2026-03-10", Amount: "100", Description: "   " },
          { Date: "2026-03-10", Description: "MISSING" },
          { Date: "2026-03-10", Amount: "-100", Description: "OK" },
        ],
        errors: [],
      },
      mapping({ order: "ymd" }),
      "JPY",
    ),
  ).toEqual({
    rows: [{ date: "2026-03-10", amount: "-100", description: "OK", amountMinor: -100 }],
    malformed: [2, 3, 4, 5],
  });
});
