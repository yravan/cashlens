import { isIsoDate } from "./history-query";
import { parseMajorUnits } from "./minor-units";

// Mirrors the account_type enum; lib/data stops compiling if the two drift in either direction.
export type OfflineAccountType = "depository" | "credit" | "loan" | "investment" | "other";

export const OFFLINE_TYPE_LABELS: Record<OfflineAccountType, string> = {
  depository: "Cash",
  credit: "Credit card",
  loan: "Loan",
  investment: "Investment",
  other: "Other",
};
export const OWED_TYPES: ReadonlySet<OfflineAccountType> = new Set<OfflineAccountType>([
  "credit",
  "loan",
]);
export const OFFLINE_CURRENCIES: readonly string[] = [
  "USD",
  "EUR",
  "GBP",
  "CAD",
  "AUD",
  "JPY",
  "CHF",
  "INR",
];

export type OfflineAccountInput = {
  name: string;
  type: OfflineAccountType;
  currency: string;
  balance: string;
  reportedOn: string;
};
export type OfflineBalanceInput = { balance: string; reportedOn: string };
export type ParsedOfflineInput<T> = { ok: true; input: T } | { ok: false };

const ACCOUNT_KEYS = ["name", "type", "currency", "balance", "reportedOn"] as const;
const BALANCE_KEYS = ["balance", "reportedOn"] as const;
const CURRENCY = /^[A-Z]{3}$/;
const BALANCE = /^-?\d+(\.\d+)?$/;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function hasExactKeys(body: Record<string, unknown>, keys: readonly string[]): boolean {
  const present = Object.keys(body);
  return present.length === keys.length && keys.every((key) => Object.hasOwn(body, key));
}

const isAccountType = (value: unknown): value is OfflineAccountType =>
  typeof value === "string" && Object.hasOwn(OFFLINE_TYPE_LABELS, value);
const isBalance = (value: unknown): value is string =>
  typeof value === "string" && value.length <= 32 && BALANCE.test(value);
const isDay = (value: unknown): value is string => typeof value === "string" && isIsoDate(value);

export function parseOfflineAccountInput(body: unknown): ParsedOfflineInput<OfflineAccountInput> {
  if (!isPlainObject(body) || !hasExactKeys(body, ACCOUNT_KEYS)) return { ok: false };
  const { name, type, currency, balance, reportedOn } = body;
  if (
    typeof name !== "string" ||
    !isAccountType(type) ||
    typeof currency !== "string" ||
    !CURRENCY.test(currency) ||
    !isBalance(balance) ||
    !isDay(reportedOn)
  ) {
    return { ok: false };
  }
  const normalizedName = name.trim();
  if (normalizedName.length === 0 || normalizedName.length > 200) return { ok: false };
  return { ok: true, input: { name: normalizedName, type, currency, balance, reportedOn } };
}

export function parseOfflineBalanceInput(body: unknown): ParsedOfflineInput<OfflineBalanceInput> {
  if (!isPlainObject(body) || !hasExactKeys(body, BALANCE_KEYS)) return { ok: false };
  const { balance, reportedOn } = body;
  if (!isBalance(balance) || !isDay(reportedOn)) return { ok: false };
  return { ok: true, input: { balance, reportedOn } };
}

export function offlineBalanceMinor(balance: string, currency: string): number | null {
  const negative = balance.startsWith("-");
  const minor = parseMajorUnits(negative ? balance.slice(1) : balance, currency);
  if (minor === null) return null;
  return minor === 0 ? 0 : negative ? -minor : minor;
}
