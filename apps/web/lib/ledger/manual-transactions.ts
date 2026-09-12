import { isIsoDate } from "./history-query";
import { parseMajorUnits } from "./minor-units";

export type ManualTransactionInput = {
  accountId: string;
  direction: "outflow" | "inflow";
  amount: string;
  date: string;
  description: string;
  merchant: string | null;
  categoryId: string | null;
};

export type ParsedManualTransactionInput =
  | { ok: true; input: ManualTransactionInput }
  | { ok: false };

const KEYS = [
  "accountId",
  "direction",
  "amount",
  "date",
  "description",
  "merchant",
  "categoryId",
] as const;
const AMOUNT = /^\d+(\.\d+)?$/;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

export function parseManualTransactionInput(body: unknown): ParsedManualTransactionInput {
  if (!isPlainObject(body)) return { ok: false };
  const keys = Object.keys(body);
  if (keys.length !== KEYS.length || KEYS.some((key) => !Object.hasOwn(body, key))) {
    return { ok: false };
  }

  const { accountId, direction, amount, date, description, merchant, categoryId } = body;
  if (
    typeof accountId !== "string" ||
    (direction !== "outflow" && direction !== "inflow") ||
    typeof amount !== "string" ||
    amount.length > 32 ||
    !AMOUNT.test(amount) ||
    typeof date !== "string" ||
    !isIsoDate(date) ||
    typeof description !== "string" ||
    (merchant !== null && typeof merchant !== "string") ||
    (categoryId !== null && typeof categoryId !== "string")
  ) {
    return { ok: false };
  }

  const normalizedDescription = description.trim();
  const normalizedMerchant = merchant?.trim() || null;
  if (
    normalizedDescription.length === 0 ||
    normalizedDescription.length > 200 ||
    (normalizedMerchant !== null && normalizedMerchant.length > 200)
  ) {
    return { ok: false };
  }

  return {
    ok: true,
    input: {
      accountId,
      direction,
      amount,
      date,
      description: normalizedDescription,
      merchant: normalizedMerchant,
      categoryId,
    },
  };
}

export function isEmptyMutationBody(body: unknown): boolean {
  return isPlainObject(body) && Object.keys(body).length === 0;
}

export function manualAmountMinor(
  direction: ManualTransactionInput["direction"],
  amount: string,
  currency: string,
): number | null {
  const minor = parseMajorUnits(amount, currency);
  if (minor === null || minor === 0) return null;
  return direction === "outflow" ? -minor : minor;
}
