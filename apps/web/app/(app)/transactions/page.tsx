import type { Metadata } from "next";
import Link from "next/link";

import { llmConfigured, uncategorizedCount } from "@/lib/data/auto-categorize";
import { transactionHistory, type TransactionHistory } from "@/lib/data/ledger";
import {
  historyQueryString,
  isFiltered,
  parseHistoryQuery,
  type HistoryParam,
  type HistoryQuery,
} from "@/lib/ledger/history-query";
import { formatMinorUnits } from "@/lib/ledger/minor-units";
import { AutoCategorize } from "./auto-categorize";
import { CategorySelect } from "./category-select";
import { HistoryFilters } from "./filter-form";
import { TransferMatch } from "./transfer-match";
import { TransferUnlink } from "./transfer-unlink";

export const metadata: Metadata = { title: "Transactions" };

const pageHref = (query: HistoryQuery, page: number) => {
  const qs = historyQueryString(query, page);
  return qs ? `/transactions?${qs}` : "/transactions";
};

function TransactionRow({
  row,
  groups,
}: {
  row: TransactionHistory["rows"][number];
  groups: TransactionHistory["options"]["categoryGroups"];
}) {
  return (
    <li
      data-testid="transaction-row"
      className="grid gap-3 py-4 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,14rem)] sm:items-center"
    >
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{row.merchant ?? row.description}</p>
        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
          {row.date} · {row.accountName}
        </p>
        <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
          {row.source} · {row.status}
        </p>
      </div>
      <p className="font-mono text-sm font-medium tabular-nums sm:text-right">
        {formatMinorUnits(row.amountMinor, row.currency)}
        <span className="ml-1 text-xs font-normal text-zinc-500 dark:text-zinc-400">
          {row.currency}
        </span>
      </p>
      <span className="flex flex-col items-start gap-1">
        <CategorySelect
          transactionId={row.id}
          categoryId={row.categoryId}
          label={`${row.merchant ?? row.description} on ${row.date}`}
          groups={groups}
        />
        {row.categorySource === "auto" && (
          <span
            data-testid="auto-category"
            title={row.categoryReason ?? undefined}
            className={`text-xs ${
              row.categoryConfidence === "low"
                ? "text-amber-600 dark:text-amber-500"
                : "text-zinc-500 dark:text-zinc-400"
            }`}
          >
            Auto · {row.categoryConfidence}
            {row.categoryConfidence === "low" && " — check"}
          </span>
        )}
        {row.transferPairId && (
          <span data-testid="transfer-marker" className="text-xs text-zinc-500 dark:text-zinc-400">
            Transfer · {row.amountMinor < 0 ? "to" : "from"}{" "}
            {row.transferCounterpart ?? "another account"} ·{" "}
            <TransferUnlink
              pairId={row.transferPairId}
              label={`${row.merchant ?? row.description} on ${row.date}`}
            />
          </span>
        )}
      </span>
    </li>
  );
}

export default async function TransactionsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const parsed = parseHistoryQuery(params);
  const history = await transactionHistory(parsed);
  const autoCategorize = llmConfigured() && (await uncategorizedCount()) > 0;
  const values = (key: HistoryParam) => {
    const value = params[key];
    return typeof value === "string" ? value : "";
  };
  // Soft navigation reuses uncontrolled inputs' DOM state; keying the form on the
  // applied query remounts the controls so the URL stays the source of truth.
  const formKey = parsed.ok ? historyQueryString(parsed.query, 1) : JSON.stringify(params);

  const heading = (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Transactions</h1>
      {history.options.currencies.length > 0 && <TransferMatch />}
      {autoCategorize && <AutoCategorize />}
    </>
  );

  if (!parsed.ok) {
    return (
      <>
        {heading}
        <p
          data-testid="filter-error"
          role="status"
          className="mt-2 max-w-xl text-sm leading-6 text-red-600 dark:text-red-400"
        >
          Those filters aren&apos;t valid — dates must be real days in order, amounts need a
          currency and run low to high, and nothing here takes a negative value.
        </p>
        <HistoryFilters key={formKey} options={history.options} values={values} />
      </>
    );
  }

  const { query } = parsed;
  const ledgerEmpty = history.options.currencies.length === 0;
  const plural = history.total === 1 ? "" : "s";
  const count = isFiltered(query)
    ? `${history.total} matching transaction${plural}`
    : `${history.total} transaction${plural} in the ledger`;
  const noMatch =
    history.total === 0
      ? {
          message: "No transactions match these filters.",
          href: "/transactions",
          label: "Clear filters",
        }
      : {
          message: "Nothing on this page.",
          href: pageHref(query, 1),
          label: "Back to the first page",
        };
  const pageLink = (rel: "prev" | "next", to: number, label: string) => (
    <Link rel={rel} href={pageHref(query, to)} className="underline underline-offset-4">
      {label}
    </Link>
  );

  return (
    <>
      {heading}
      <p
        data-testid="transactions-count"
        role="status"
        className="mt-2 text-sm text-zinc-500 dark:text-zinc-400"
      >
        {count}
      </p>

      {ledgerEmpty ? (
        <section className="mt-10 border-y border-zinc-200 py-8 dark:border-zinc-800">
          <h2 className="text-lg font-medium tracking-tight">No transactions yet</h2>
          <p className="mt-2 max-w-lg text-sm leading-6 text-zinc-500 dark:text-zinc-400">
            Connect a bank or card and its history lands here, searchable and filterable.
          </p>
          <Link
            href="/accounts"
            className="mt-4 inline-block text-sm underline underline-offset-4"
          >
            Go to accounts
          </Link>
        </section>
      ) : (
        <>
          <HistoryFilters key={formKey} options={history.options} values={values} />

          {history.rows.length === 0 ? (
            <section data-testid="no-match" className="mt-8 max-w-xl py-4">
              <p className="text-sm leading-6 text-zinc-500 dark:text-zinc-400">
                {noMatch.message}
              </p>
              <Link
                href={noMatch.href}
                className="mt-2 inline-block text-sm underline underline-offset-4"
              >
                {noMatch.label}
              </Link>
            </section>
          ) : (
            <ul
              data-testid="transaction-list"
              className="mt-6 divide-y divide-zinc-200 border-b border-zinc-300 dark:divide-zinc-800 dark:border-zinc-700"
            >
              {history.rows.map((row) => (
                <TransactionRow key={row.id} row={row} groups={history.options.categoryGroups} />
              ))}
            </ul>
          )}

          {history.pageCount > 1 && history.rows.length > 0 && (
            <nav
              aria-label="Pagination"
              className="mt-6 flex items-center justify-between text-sm"
            >
              {history.page > 1 ? (
                pageLink("prev", history.page - 1, "Previous")
              ) : (
                <span aria-hidden="true" />
              )}
              <p className="text-zinc-500 dark:text-zinc-400">
                Page {history.page} of {history.pageCount}
              </p>
              {history.page < history.pageCount ? (
                pageLink("next", history.page + 1, "Next")
              ) : (
                <span aria-hidden="true" />
              )}
            </nav>
          )}
        </>
      )}
    </>
  );
}
