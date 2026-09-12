import {
  CONFIDENCE_LEVELS,
  type ClassifyAssignment,
  type ClassifyItem,
  type Confidence,
} from "@/lib/llm/classify";

export type ClassificationQualityCase = {
  id: string;
  input: ClassifyItem;
  acceptableLabels: readonly string[];
  maxConfidence: Confidence;
};

export type ConfidenceBand = {
  assigned: number;
  matched: number;
  accuracy: number | null;
};

export type ClassificationQualityScore = {
  total: number;
  matched: number;
  wrong: number;
  missing: number; // Cases without a valid assignment, including invalid-only responses.
  invalid: number;
  duplicate: number;
  highConfidenceWrong: number;
  confidenceViolations: number;
  bands: Record<Confidence, ConfidenceBand>;
  failedCaseIds: string[];
};

const confidenceRank: Record<Confidence, number> = { low: 0, medium: 1, high: 2 };
const isIndex = (value: unknown, length: number): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= 0 && value < length;
const isConfidence = (value: unknown): value is Confidence =>
  typeof value === "string" && CONFIDENCE_LEVELS.includes(value as Confidence);

const emptyBand = (): ConfidenceBand => ({ assigned: 0, matched: 0, accuracy: null });

export function scoreClassification(
  assignments: readonly unknown[],
  categoryLabels: readonly string[],
  cases: readonly ClassificationQualityCase[],
): ClassificationQualityScore {
  const bands: Record<Confidence, ConfidenceBand> = {
    low: emptyBand(),
    medium: emptyBand(),
    high: emptyBand(),
  };
  const failedCaseIds = new Set<string>();
  const seen = new Set<number>();
  let matched = 0;
  let wrong = 0;
  let missing = 0;
  let invalid = 0;
  let duplicate = 0;
  let highConfidenceWrong = 0;
  let confidenceViolations = 0;

  for (const candidate of assignments) {
    if (typeof candidate !== "object" || candidate === null) {
      invalid += 1;
      failedCaseIds.add("<invalid-assignment>");
      continue;
    }
    const { item, category, confidence, reason } = candidate as Partial<ClassifyAssignment>;
    if (!isIndex(item, cases.length)) {
      invalid += 1;
      failedCaseIds.add("<invalid-item>");
      continue;
    }
    if (seen.has(item)) {
      duplicate += 1;
      failedCaseIds.add(cases[item].id);
      continue;
    }
    const currentCase = cases[item];
    if (!isIndex(category, categoryLabels.length) || !isConfidence(confidence) || typeof reason !== "string" || reason.trim().length === 0) {
      invalid += 1;
      failedCaseIds.add(currentCase.id);
      continue;
    }
    seen.add(item);

    const label = categoryLabels[category];
    const isMatch = currentCase.acceptableLabels.includes(label);
    const band = bands[confidence];
    band.assigned += 1;
    if (isMatch) {
      matched += 1;
      band.matched += 1;
    } else {
      wrong += 1;
      failedCaseIds.add(currentCase.id);
      if (confidence === "high") highConfidenceWrong += 1;
    }
    if (confidenceRank[confidence] > confidenceRank[currentCase.maxConfidence]) {
      confidenceViolations += 1;
      failedCaseIds.add(currentCase.id);
    }
  }

  for (let item = 0; item < cases.length; item += 1) {
    if (!seen.has(item)) {
      missing += 1;
      failedCaseIds.add(cases[item].id);
    }
  }
  for (const band of Object.values(bands)) {
    band.accuracy = band.assigned === 0 ? null : band.matched / band.assigned;
  }

  return {
    total: cases.length,
    matched,
    wrong,
    missing,
    invalid,
    duplicate,
    highConfidenceWrong,
    confidenceViolations,
    bands,
    failedCaseIds: [...failedCaseIds],
  };
}
