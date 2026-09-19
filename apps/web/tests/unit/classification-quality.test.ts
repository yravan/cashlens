import { describe, expect, test } from "vitest";

import type { ClassifyAssignment } from "@/lib/llm/classify";
import { DEFAULT_CATEGORIES } from "@/lib/ledger/default-categories";
import { CLASSIFICATION_QUALITY_CASES } from "@/tests/evaluation/cases";
import { scoreClassification, type ClassificationQualityCase } from "@/tests/evaluation/score";

const cases: ClassificationQualityCase[] = [
  { id: "known", input: { description: "known", merchant: null, direction: "out" }, acceptableLabels: ["A"], maxConfidence: "high" },
  { id: "unknown", input: { description: "opaque", merchant: null, direction: "out" }, acceptableLabels: ["Other"], maxConfidence: "low" },
  { id: "known-two", input: { description: "known two", merchant: null, direction: "in" }, acceptableLabels: ["B"], maxConfidence: "medium" },
];
const labels = ["A", "Other", "B"];
const assignment = (item: number, category: number, confidence: ClassifyAssignment["confidence"]): ClassifyAssignment => ({ item, category, confidence, reason: "synthetic" });

test("always falling back cannot pass the synthetic purpose cases", () => {
  const taxonomy = DEFAULT_CATEGORIES.flatMap(group => group.categories.map(leaf => `${group.group} > ${leaf}`));
  const fallback = taxonomy.indexOf("Other > Miscellaneous");
  const score = scoreClassification(CLASSIFICATION_QUALITY_CASES.map((_, i) => assignment(i, fallback, "low")), taxonomy, CLASSIFICATION_QUALITY_CASES);
  expect(score).toMatchObject({ total: 12, matched: 7, wrong: 5, missing: 0, confidenceViolations: 0 });
  expect(score.failedCaseIds).toEqual(["purpose-income", "purpose-rent", "purpose-groceries", "purpose-transit", "inert-instruction"]);
});

test("scores semantic matches, wrong labels, and confidence bands", () => {
  const score = scoreClassification([assignment(0, 0, "high"), assignment(1, 1, "low"), assignment(2, 0, "high")], labels, cases);
  expect(score).toMatchObject({ total: 3, matched: 2, wrong: 1, missing: 0, highConfidenceWrong: 1, confidenceViolations: 1 });
  expect(score.bands.low).toEqual({ assigned: 1, matched: 1, accuracy: 1 });
  expect(score.bands.medium).toEqual({ assigned: 0, matched: 0, accuracy: null });
  expect(score.bands.high).toEqual({ assigned: 2, matched: 1, accuracy: 0.5 });
  expect(score.failedCaseIds).toEqual(["known-two"]);
});

test("empty input reports every case missing and does not claim accuracy", () => {
  const score = scoreClassification([], labels, cases);
  expect(score).toMatchObject({ total: 3, matched: 0, wrong: 0, missing: 3, invalid: 0 });
  expect(score.bands).toEqual({ low: { assigned: 0, matched: 0, accuracy: null }, medium: { assigned: 0, matched: 0, accuracy: null }, high: { assigned: 0, matched: 0, accuracy: null } });
});

test("missing, duplicate, and invalid assignments are explicit failures", () => {
  const score = scoreClassification([assignment(0, 0, "high"), assignment(0, 1, "low"), assignment(1, 8, "low"), assignment(9, 0, "low"), null], labels, cases);
  expect(score).toMatchObject({ missing: 2, invalid: 3, duplicate: 1 });
  expect(score.failedCaseIds).toEqual(expect.arrayContaining(["known", "unknown", "known-two", "<invalid-item>", "<invalid-assignment>"]));
});

test("category permutations are decoded by semantic label, not index", () => {
  const score = scoreClassification([assignment(0, 2, "high"), assignment(1, 0, "low"), assignment(2, 1, "medium")], ["Other", "B", "A"], cases);
  expect(score.matched).toBe(3);
  expect(score.wrong).toBe(0);
});

test("unknown cases reject overconfident catch-all assignments", () => {
  const score = scoreClassification([assignment(1, 1, "high")], labels, cases);
  expect(score.matched).toBe(1);
  expect(score.confidenceViolations).toBe(1);
  expect(score.bands.high.accuracy).toBe(1);
});

test("invalid responses are counted separately from cases without a valid assignment", () => {
  const score = scoreClassification([assignment(0, 99, "low")], labels, cases.slice(0, 1));
  expect(score).toMatchObject({ total: 1, matched: 0, wrong: 0, missing: 1, invalid: 1 });
  expect(score.matched + score.wrong + score.missing).toBe(score.total);
  expect(score.failedCaseIds).toEqual(["known"]);
});

test.each([undefined, null, 42, "", "   "])("an invalid reason (%j) cannot count as a semantic match", reason => {
  const score = scoreClassification([{ item: 0, category: 0, confidence: "high", reason }], labels, cases.slice(0, 1));
  expect(score).toMatchObject({ total: 1, matched: 0, wrong: 0, missing: 1, invalid: 1 });
  expect(score.failedCaseIds).toEqual(["known"]);
});

describe("invalid confidence", () => {
  test("is explicit rather than silently omitted", () => {
    const score = scoreClassification([{ item: 0, category: 0, confidence: "certain", reason: "synthetic" }], labels, cases);
    expect(score).toMatchObject({ invalid: 1, missing: 3 });
  });
});
