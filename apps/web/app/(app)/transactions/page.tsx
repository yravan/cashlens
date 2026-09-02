import type { Metadata } from "next";
import Link from "next/link";

import { transactionHistory, type TransactionHistory } from "@/lib/data/ledger";
import {
  historyQueryString,
  isFiltered,
  parseHistoryQuery,
  type HistoryQuery,
} from "@/lib/ledger/history-query";
import { formatMinorUnits } from "@/lib/ledger/minor-units";
import { CategorySelect } from "./category-select";
import { HistoryFilters } from "./filter-form";

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
      <CategorySelect
        transactionId={row.id}
        categoryId={row.categoryId}
        label={`${row.merchant ?? row.description} on ${row.date}`}
        groups={groups}
      />
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
  const values = (key: string) => {
    const value = params[key];
    return typeof value === "string" ? value : "";
  };

  const heading = (
    <h1 className="text-2xl font-semibold tracking-tight">Transactions</h1>
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
        <HistoryFilters options={history.options} values={values} />
      </>
    );
  }

  const { query } = parsed;
  const filtered = isFiltered(query);
  const ledgerEmpty = history.options.currencies.length === 0;
  const count = filtered
    ? `${history.total} matching transaction${history.total === 1 ? "" : "s"}`
    : `${history.total} transaction${history.total === 1 ? "" : "s"} in the ledger`;

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
          <HistoryFilters options={history.options} values={values} />

          {history.rows.length === 0 ? (
            <section data-testid="no-match" className="mt-8 max-w-xl py-4">
              {history.total === 0 ? (
                <>
                  <p className="text-sm leading-6 text-zinc-500 dark:text-zinc-400">
                    No transactions match these filters.
                  </p>
                  <Link
                    href="/transactions"
                    className="mt-2 inline-block text-sm underline underline-offset-4"
                  >
                    Clear filters
                  </Link>
                </>
              ) : (
                <>
                  <p className="text-sm leading-6 text-zinc-500 dark:text-zinc-400">
                    Nothing on this page.
                  </p>
                  <Link
                    href={pageHref(query, 1)}
                    className="mt-2 inline-block text-sm underline underline-offset-4"
                  >
                    Back to the first page
                  </Link>
                </>
              )}
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
                <Link
                  rel="prev"
                  href={pageHref(query, history.page - 1)}
                  className="underline underline-offset-4"
                >
                  Previous
                </Link>
              ) : (
                <span aria-hidden="true" />
              )}
              <p className="text-zinc-500 dark:text-zinc-400">
                Page {history.page} of {history.pageCount}
              </p>
              {history.page < history.pageCount ? (
                <Link
                  rel="next"
                  href={pageHref(query, history.page + 1)}
                  className="underline underline-offset-4"
                >
                  Next
                </Link>
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
