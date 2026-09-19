"use client";

import { useMemo, useRef, useState, useTransition, type ChangeEvent, type FormEvent } from "react";
import { useRouter } from "next/navigation";

import type { OfflineAccountError } from "@/lib/data/offline-accounts";
import { formatMinorUnits } from "@/lib/ledger/minor-units";
import {
  guessMapping,
  interpretStatement,
  MAX_IMPORT_BODY_BYTES,
  MAX_IMPORT_ROWS,
  type ParsedStatement,
  type StatementMapping,
  type StatementPreview,
} from "@/lib/ledger/statement-import";
import { inputClass, responseErrorFor } from "../mutation-form";

type Parsed = ParsedStatement & { headers: string[] };
type Outcome = { inserted: number; skipped: number };
type Column = "date" | "amount" | "outflow" | "inflow" | "description";

const ERROR_COPY: Record<OfflineAccountError | "too_large" | "invalid_body", string> = {
  invalid_request: "Some rows can’t be imported as they are. Check the columns and try again.",
  account_not_found: "That account is no longer available.",
  too_large:
    "That file is too large to import in one go. Split it into files by complete dates, keeping every row for a date together. A single date over the limit cannot be imported yet; do not split that date across files.",
  invalid_body: "Couldn’t send the rows. Try again.",
};
const FAILURE = "Couldn’t import the statement. Try again.";
const responseError = responseErrorFor(ERROR_COPY);
const formClass =
  "mt-3 min-w-0 rounded-lg border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-950";
const primaryButton =
  "rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900";
const quietButton =
  "rounded-md border border-zinc-300 px-4 py-2 text-sm disabled:opacity-50 dark:border-zinc-700";
const labelClass = "min-w-0 text-sm font-medium";
const DATE_ORDERS = [
  ["ymd", "Year/Month/Day"],
  ["mdy", "Month/Day/Year"],
  ["dmy", "Day/Month/Year"],
] as const;

const rows = (count: number) => `${count} row${count === 1 ? "" : "s"}`;

function initialMapping(headers: string[]): StatementMapping {
  const guess = guessMapping(headers);
  return {
    date: guess.date ?? "",
    amount: guess.amount ?? "",
    outflow: guess.outflow ?? "",
    inflow: guess.inflow ?? "",
    description: guess.description ?? "",
    layout: guess.amount === null && (guess.outflow ?? guess.inflow) !== null ? "split" : "signed",
    order: "ymd",
    decimalMark: ".",
    flip: false,
  };
}

function summary(total: number, preview: StatementPreview, reportedOn: string | null): string {
  if (total > MAX_IMPORT_ROWS) return `${rows(total)} · at most ${MAX_IMPORT_ROWS} can be imported at once`;
  const { malformed } = preview;
  if (malformed.length > 0) {
    const more = malformed.length - 5;
    const listed = `${malformed.slice(0, 5).join(", ")}${more > 0 ? ` and ${more} more` : ""}`;
    return `${rows(total)} · ${malformed.length} can’t be read (row${malformed.length === 1 ? "" : "s"} ${listed})`;
  }
  if (reportedOn === null) return rows(total);
  const after = preview.rows.filter((row) => row.date >= reportedOn).length;
  return `${rows(total)} · ${after} dated on or after ${reportedOn} will change the balance`;
}

export function StatementImport({
  account,
  onClose,
}: {
  account: { id: string; currency: string; reportedOn: string | null };
  onClose: () => void;
}) {
  const router = useRouter();
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [mapping, setMapping] = useState<StatementMapping | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const submittingRef = useRef(false);
  const preview = useMemo(
    () => (parsed && mapping ? interpretStatement(parsed, mapping, account.currency) : null),
    [parsed, mapping, account.currency],
  );
  const ready =
    parsed !== null &&
    preview !== null &&
    preview.malformed.length === 0 &&
    preview.rows.length > 0 &&
    parsed.data.length <= MAX_IMPORT_ROWS;

  const load = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    setParsed(null);
    setError(null);
    if (!file) return;
    if (file.size > MAX_IMPORT_BODY_BYTES) {
      setError(ERROR_COPY.too_large);
      return;
    }
    startTransition(async () => {
      const [{ parse }, text] = await Promise.all([import("papaparse"), file.text()]);
      const result = parse<Record<string, string>>(text, {
        header: true,
        skipEmptyLines: "greedy",
        transformHeader: (header) => header.trim(),
      });
      const headers = result.meta.fields ?? [];
      if (headers.length === 0 || result.data.length === 0) {
        setError("That file has no rows to import.");
        return;
      }
      setMapping(initialMapping(headers));
      setParsed({ headers, data: result.data, errors: result.errors });
    });
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submittingRef.current || !preview || !ready) return;
    submittingRef.current = true;
    setError(null);
    startTransition(async () => {
      try {
        const response = await fetch(`/api/accounts/${account.id}/manual/import`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            rows: preview.rows.map(({ date, amount, description }) => ({ date, amount, description })),
          }),
        });
        if (!response.ok) {
          setError(await responseError(response, FAILURE));
          return;
        }
        const { inserted, skipped } = (await response.json()) as Outcome;
        setOutcome({ inserted, skipped });
        router.refresh();
      } catch {
        setError(FAILURE);
      } finally {
        submittingRef.current = false;
      }
    });
  };

  if (outcome) {
    return (
      <div className={formClass}>
        <p data-testid="import-result" className="text-sm">
          {`Imported ${outcome.inserted} transaction${outcome.inserted === 1 ? "" : "s"} · ${
            outcome.skipped
          } ${outcome.skipped === 1 ? "was" : "were"} already in the ledger`}
        </p>
        <button type="button" onClick={onClose} className={`mt-3 ${quietButton}`}>
          Done
        </button>
      </div>
    );
  }

  const update = (patch: Partial<StatementMapping>) =>
    setMapping((current) => (current ? { ...current, ...patch } : current));
  const columnSelect = (label: string, key: Column) =>
    parsed &&
    mapping && (
      <label className={labelClass}>
        {label}
        <select
          value={mapping[key]}
          onChange={(event) => update({ [key]: event.target.value })}
          disabled={pending}
          className={inputClass}
        >
          <option value="">Choose a column</option>
          {parsed.headers.map((header) => (
            <option key={header} value={header}>
              {header}
            </option>
          ))}
        </select>
      </label>
    );

  return (
    <form aria-label="Import statement" onSubmit={submit} className={formClass}>
      <div className="grid min-w-0 gap-4 sm:grid-cols-2">
        <label className={`${labelClass} sm:col-span-2`}>
          Statement file (CSV)
          <input
            data-testid="import-file"
            type="file"
            accept=".csv,text/csv"
            onChange={load}
            disabled={pending}
            className={inputClass}
          />
        </label>
        {parsed && mapping && (
          <>
            {columnSelect("Date column", "date")}
            <label className={labelClass}>
              Date order
              <select
                value={mapping.order}
                onChange={(event) => update({ order: event.target.value as StatementMapping["order"] })}
                disabled={pending}
                className={inputClass}
              >
                {DATE_ORDERS.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className={labelClass}>
              Amount columns
              <select
                value={mapping.layout}
                onChange={(event) =>
                  update({ layout: event.target.value as StatementMapping["layout"] })
                }
                disabled={pending}
                className={inputClass}
              >
                <option value="signed">One column, signed</option>
                <option value="split">Money out and money in</option>
              </select>
            </label>
            {mapping.layout === "signed" ? (
              columnSelect("Amount column", "amount")
            ) : (
              <>
                {columnSelect("Money out column", "outflow")}
                {columnSelect("Money in column", "inflow")}
              </>
            )}
            {columnSelect("Description column", "description")}
            <label className={labelClass}>
              Decimal mark
              <select
                value={mapping.decimalMark}
                onChange={(event) =>
                  update({ decimalMark: event.target.value as StatementMapping["decimalMark"] })
                }
                disabled={pending}
                className={inputClass}
              >
                <option value=".">Point (1,234.56)</option>
                <option value=",">Comma (1.234,56)</option>
              </select>
            </label>
            {mapping.layout === "signed" && (
              <label className="flex min-w-0 items-center gap-2 text-sm font-medium sm:col-span-2">
                <input
                  type="checkbox"
                  checked={mapping.flip}
                  onChange={(event) => update({ flip: event.target.checked })}
                  disabled={pending}
                />
                Money out is positive in this file
              </label>
            )}
          </>
        )}
      </div>
      {parsed && preview && (
        <>
          <div className="mt-4 min-w-0 overflow-x-auto">
            <table data-testid="import-preview" className="w-full text-left text-sm">
              <thead className="text-xs text-zinc-500 dark:text-zinc-400">
                <tr>
                  <th scope="col" className="pr-4 font-medium">
                    Date
                  </th>
                  <th scope="col" className="pr-4 font-medium">
                    Amount
                  </th>
                  <th scope="col" className="font-medium">
                    Description
                  </th>
                </tr>
              </thead>
              <tbody>
                {preview.rows.slice(0, 5).map((row, index) => (
                  <tr key={index}>
                    <td className="whitespace-nowrap pr-4 font-mono tabular-nums">{row.date}</td>
                    <td className="whitespace-nowrap pr-4 font-mono tabular-nums">
                      {formatMinorUnits(row.amountMinor, account.currency)}
                    </td>
                    <td className="whitespace-nowrap">{row.description}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p data-testid="import-summary" className="mt-3 text-sm">
            {summary(parsed.data.length, preview, account.reportedOn)}
          </p>
        </>
      )}
      {error && (
        <p role="alert" className="mt-3 text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
      <div className="mt-4 flex flex-wrap gap-3">
        {preview && (
          <button type="submit" disabled={pending || !ready} className={primaryButton}>
            {pending ? "Importing…" : `Import ${rows(preview.rows.length)}`}
          </button>
        )}
        <button type="button" onClick={onClose} disabled={pending} className={quietButton}>
          Cancel
        </button>
      </div>
    </form>
  );
}
