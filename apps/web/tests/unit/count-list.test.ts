import { expect, test } from "vitest";

import { countList } from "@/app/(app)/accounts/count-list";

test("a zero count never reaches the disclosure", () => {
  const disclosure = countList([
    [1, "account"],
    [3, "imported transaction"],
    [0, "known obligation"],
  ]);
  expect(disclosure).not.toMatch(/0 known obligations/);
  expect(disclosure).toBe("1 account and 3 imported transactions");
});

test.each<[[number, string][], string]>([
  [
    [
      [1, "account"],
      [1, "imported transaction"],
      [1, "known obligation"],
    ],
    "1 account, 1 imported transaction, and 1 known obligation",
  ],
  [
    [
      [2, "transaction"],
      [0, "known obligation"],
    ],
    "2 transactions",
  ],
  [
    [
      [0, "transaction"],
      [1, "known obligation"],
    ],
    "1 known obligation",
  ],
  [
    [
      [0, "transaction"],
      [0, "known obligation"],
    ],
    "",
  ],
])("%j reads as %j", (counts, expected) => {
  expect(countList(counts)).toBe(expected);
});
