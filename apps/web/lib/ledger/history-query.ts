import { formatMajorUnits, parseMajorUnits } from "./minor-units";

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

export const UNCATEGORIZED = "uncategorized";

export type SpendingQuery = Pick<HistoryQuery, "from" | "to" | "currency">;
export type ParsedSpendingQuery = { ok: true; query: SpendingQuery } | { ok: false };

export const SPENDING_PARAMS = ["from", "to", "currency"] as const;
export type SpendingParam = (typeof SPENDING_PARAMS)[number];
const SPENDING_KEYS = new Set<string>(SPENDING_PARAMS);

export function parseSpendingQuery(
  params: Record<string, string | string[] | undefined>,
): ParsedSpendingQuery {
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && !SPENDING_KEYS.has(key)) return { ok: false };
  }
  const parsed = parseHistoryQuery(params);
  if (!parsed.ok) return { ok: false };
  const { from, to, currency } = parsed.query;
  return { ok: true, query: { from, to, currency } };
}

const KEYS = new Set<string>(HISTORY_PARAMS);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const CURRENCY = /^[A-Z]{3}$/;
const PAGE = /^[1-9]\d*$/;

export function isIsoDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
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

  const account = given.get("account");
  if (account !== undefined) {
    if (!UUID.test(account)) return { ok: false };
    query.accountId = account;
  }

  const category = given.get("category");
  if (category !== undefined) {
    if (category !== UNCATEGORIZED && !UUID.test(category)) return { ok: false };
    query.categoryId = category;
  }

  for (const key of ["from", "to"] as const) {
    const value = given.get(key);
    if (value === undefined) continue;
    if (!isIsoDate(value)) return { ok: false };
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
    const minor = parseMajorUnits(value, query.currency);
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
    if (query.minMinor !== null) params.set("min", formatMajorUnits(query.minMinor, query.currency));
    if (query.maxMinor !== null) params.set("max", formatMajorUnits(query.maxMinor, query.currency));
  }
  if (page !== 1) params.set("page", String(page));
  return params.toString();
}

export const isFiltered = (query: HistoryQuery): boolean => historyQueryString(query, 1) !== "";
