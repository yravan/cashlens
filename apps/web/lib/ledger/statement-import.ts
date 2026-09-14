import { isIsoDate } from "./history-query";
import { isPlainObject } from "./manual-transactions";
import { PLAIN_DECIMAL } from "./minor-units";
import {
  hasExactKeys,
  offlineBalanceMinor,
  parseName,
  type ParsedOfflineInput,
} from "./offline-accounts";

export const MAX_IMPORT_ROWS = 5000;
export const MAX_IMPORT_BODY_BYTES = 1024 * 1024;

export type DateOrder = "ymd" | "mdy" | "dmy";
export type DecimalMark = "." | ",";
export type AmountCells = { amount: string } | { outflow: string; inflow: string };
export type StatementRow = { date: string; amount: string; description: string };
export type StatementImportInput = { rows: StatementRow[] };
export type ImportRow = { date: string; amountMinor: number; description: string; sourceId: string };
export type MappingGuess = Record<"date" | "amount" | "outflow" | "inflow" | "description", string | null>;

const SYNONYMS: Record<keyof MappingGuess, string[]> = {
  date: ["date", "transaction date", "posted date", "posting date", "booking date", "value date"],
  amount: ["amount", "transaction amount"],
  outflow: ["debit", "withdrawal", "withdrawals", "outflow", "money out", "paid out"],
  inflow: ["credit", "deposit", "deposits", "inflow", "money in", "paid in"],
  description: ["description", "payee", "merchant", "name", "memo", "narrative", "details"],
};
const DATE_PARTS = /^\s*(\d{1,4})[-/.](\d{1,2})[-/.](\d{1,4})\s*$/;
const SIGNED_DECIMAL = /^-?\d+(\.\d+)?$/;
const ROW_KEYS = ["date", "amount", "description"] as const;

const collapse = (text: string) => text.trim().toLowerCase().replace(/\s+/g, " ");
const moves = (amount: string) => /[1-9]/.test(amount);

export function guessMapping(headers: string[]): MappingGuess {
  const pick = (names: string[]) =>
    headers.find((header) => names.includes(collapse(header))) ?? null;
  return {
    date: pick(SYNONYMS.date),
    amount: pick(SYNONYMS.amount),
    outflow: pick(SYNONYMS.outflow),
    inflow: pick(SYNONYMS.inflow),
    description: pick(SYNONYMS.description),
  };
}

export function parseStatementDate(value: string, order: DateOrder): string | null {
  const parts = DATE_PARTS.exec(value);
  if (!parts) return null;
  const [, first, middle, last] = parts;
  const [year, month, day] =
    order === "ymd" ? [first, middle, last] : order === "mdy" ? [last, first, middle] : [last, middle, first];
  if (year.length !== 4 || day.length > 2) return null;
  const iso = `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  return isIsoDate(iso) ? iso : null;
}

export function normalizeAmount(value: string, decimalMark: DecimalMark): string | null {
  let text = value.replace(/−/g, "-").replace(/[\s$€£¥₹]/g, "");
  const bracketed = text.startsWith("(") && text.endsWith(")");
  if (bracketed) text = text.slice(1, -1);
  const negative = bracketed || text.startsWith("-");
  if (text.startsWith("-") || text.startsWith("+")) text = text.slice(1);
  text = text.split(decimalMark === "." ? "," : ".").join("");
  if (decimalMark === ",") text = text.replace(",", ".");
  if (!PLAIN_DECIMAL.test(text)) return null;
  return negative ? `-${text}` : text;
}

function pairedAmount(outflow: string, inflow: string, decimalMark: DecimalMark): string | null {
  const out = outflow.trim() === "" ? "0" : normalizeAmount(outflow, decimalMark);
  const into = inflow.trim() === "" ? "0" : normalizeAmount(inflow, decimalMark);
  if (out === null || into === null || (moves(out) && moves(into))) return null;
  return moves(out) ? `-${out.replace(/^-/, "")}` : moves(into) ? into.replace(/^-/, "") : "0";
}

export function statementAmount(cells: AmountCells, decimalMark: DecimalMark, flip: boolean): string | null {
  const amount =
    "amount" in cells
      ? normalizeAmount(cells.amount, decimalMark)
      : pairedAmount(cells.outflow, cells.inflow, decimalMark);
  if (amount === null || !flip || !moves(amount)) return amount;
  return amount.startsWith("-") ? amount.slice(1) : `-${amount}`;
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function importRows(rows: StatementRow[], currency: string): Promise<ImportRow[] | null> {
  const seen = new Map<string, number>();
  const imported: ImportRow[] = [];
  for (const row of rows) {
    const amountMinor = offlineBalanceMinor(row.amount, currency);
    if (amountMinor === null || amountMinor === 0) return null;
    const tuple = `${row.date}\n${amountMinor}\n${collapse(row.description)}`;
    const occurrence = (seen.get(tuple) ?? 0) + 1;
    seen.set(tuple, occurrence);
    imported.push({
      date: row.date,
      amountMinor,
      description: row.description,
      sourceId: await sha256Hex(`${tuple}\n${occurrence}`),
    });
  }
  return imported;
}

function parseRow(value: unknown): StatementRow | null {
  if (!isPlainObject(value) || !hasExactKeys(value, ROW_KEYS)) return null;
  const { date, amount } = value;
  const description = parseName(value.description);
  if (
    typeof date !== "string" ||
    !isIsoDate(date) ||
    typeof amount !== "string" ||
    amount.length > 32 ||
    !SIGNED_DECIMAL.test(amount) ||
    !moves(amount) ||
    description === null
  ) {
    return null;
  }
  return { date, amount, description };
}

export function parseStatementImportInput(body: unknown): ParsedOfflineInput<StatementImportInput> {
  if (!isPlainObject(body) || !hasExactKeys(body, ["rows"])) return { ok: false };
  const { rows } = body;
  if (!Array.isArray(rows) || rows.length === 0 || rows.length > MAX_IMPORT_ROWS) return { ok: false };
  const parsed: StatementRow[] = [];
  for (const value of rows) {
    const row = parseRow(value);
    if (row === null) return { ok: false };
    parsed.push(row);
  }
  return { ok: true, input: { rows: parsed } };
}
