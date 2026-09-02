import { currencyExponent } from "./minor-units";

export const HISTORY_PAGE_SIZE = 50;

export type HistoryQuery = {
  q: string | null;
  accountId: string | null;
  categoryId: string | null;
  from: string | null;
  to: string | null;
  currency: string | null;
  minMinor: number | null;
  maxMinor: number | null;
  page: number;
};

export type ParsedHistoryQuery = { ok: true; query: HistoryQuery } | { ok: false };

export const HISTORY_PARAMS = [
  "q",
  "account",
  "category",
  "from",
  "to",
  "currency",
  "min",
  "max",
  "page",
] as const;
export type HistoryParam = (typeof HISTORY_PARAMS)[number];

const KEYS = new Set<string>(HISTORY_PARAMS);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const CURRENCY = /^[A-Z]{3}$/;
const AMOUNT = /^\d+(\.\d+)?$/;
const PAGE = /^[1-9]\d*$/;

function isRealDate(value: string): boolean {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function toMinor(value: string, currency: string): number | null {
  if (!AMOUNT.test(value)) return null;
  const [whole, fraction = ""] = value.split(".");
  const digits = currencyExponent(currency);
  if (fraction.length > digits) return null;
  const minor = Number(whole) * 10 ** digits + Number(fraction.padEnd(digits, "0") || "0");
  return Number.isSafeInteger(minor) ? minor : null;
}

function toMajor(minor: number, currency: string): string {
  const digits = currencyExponent(currency);
  const units = String(minor).padStart(digits + 1, "0");
  const point = units.length - digits;
  const fraction = units.slice(point).replace(/0+$/, "");
  return fraction ? `${units.slice(0, point)}.${fraction}` : units.slice(0, point);
}

export function parseHistoryQuery(
  params: Record<string, string | string[] | undefined>,
): ParsedHistoryQuery {
  const given = new Map<string, string>();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue;
    if (!KEYS.has(key) || Array.isArray(value)) return { ok: false };
    if (value !== "") given.set(key, value);
  }

  const query: HistoryQuery = {
    q: null,
    accountId: null,
    categoryId: null,
    from: null,
    to: null,
    currency: null,
    minMinor: null,
    maxMinor: null,
    page: 1,
  };

  const q = given.get("q")?.trim();
  if (q !== undefined && q !== "") {
    if (q.length > 100) return { ok: false };
    query.q = q;
  }

  for (const [key, field] of [["account", "accountId"], ["category", "categoryId"]] as const) {
    const value = given.get(key);
    if (value === undefined) continue;
    if (!UUID.test(value)) return { ok: false };
    query[field] = value;
  }

  for (const key of ["from", "to"] as const) {
    const value = given.get(key);
    if (value === undefined) continue;
    if (!ISO_DATE.test(value) || !isRealDate(value)) return { ok: false };
    query[key] = value;
  }
  if (query.from !== null && query.to !== null && query.from > query.to) return { ok: false };

  const currency = given.get("currency");
  if (currency !== undefined) {
    if (!CURRENCY.test(currency)) return { ok: false };
    query.currency = currency;
  }

  for (const [key, field] of [["min", "minMinor"], ["max", "maxMinor"]] as const) {
    const value = given.get(key);
    if (value === undefined) continue;
    if (query.currency === null) return { ok: false };
    const minor = toMinor(value, query.currency);
    if (minor === null) return { ok: false };
    query[field] = minor;
  }
  if (query.minMinor !== null && query.maxMinor !== null && query.minMinor > query.maxMinor) {
    return { ok: false };
  }

  const page = given.get("page");
  if (page !== undefined) {
    if (!PAGE.test(page)) return { ok: false };
    const parsed = Number(page);
    if (!Number.isSafeInteger((parsed - 1) * HISTORY_PAGE_SIZE)) return { ok: false };
    query.page = parsed;
  }

  return { ok: true, query };
}

export function searchPattern(q: string): string {
  return `%${q.replace(/[\\%_]/g, (wildcard) => `\\${wildcard}`)}%`;
}

export function historyQueryString(query: HistoryQuery, page: number): string {
  const params = new URLSearchParams();
  if (query.q !== null) params.set("q", query.q);
  if (query.accountId !== null) params.set("account", query.accountId);
  if (query.categoryId !== null) params.set("category", query.categoryId);
  if (query.from !== null) params.set("from", query.from);
  if (query.to !== null) params.set("to", query.to);
  if (query.currency !== null) {
    params.set("currency", query.currency);
    if (query.minMinor !== null) params.set("min", toMajor(query.minMinor, query.currency));
    if (query.maxMinor !== null) params.set("max", toMajor(query.maxMinor, query.currency));
  }
  if (page !== 1) params.set("page", String(page));
  return params.toString();
}

export const isFiltered = (query: HistoryQuery): boolean => historyQueryString(query, 1) !== "";
