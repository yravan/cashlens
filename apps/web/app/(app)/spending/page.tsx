import type { Metadata } from "next";
import Link from "next/link";

import { spendingByCategory, type SpendingByCategory, type SpendingSection } from "@/lib/data/ledger";
import {
  parseSpendingQuery,
  UNCATEGORIZED,
  type SpendingParam,
  type SpendingQuery,
} from "@/lib/ledger/history-query";
import { formatMinorUnits } from "@/lib/ledger/minor-units";
import { SpendingFilters } from "./spending-filters";

export const metadata: Metadata = { title: "Spending" };

const signed = (minor: number, currency: string) =>
  `${minor > 0 ? "+" : ""}${formatMinorUnits(minor, currency)}`;

function drillHref(categoryId: string, query: SpendingQuery, currency: string): string {
  const params = new URLSearchParams({ category: categoryId });
  if (query.from !== null) params.set("from", query.from);
  if (query.to !== null) params.set("to", query.to);
  params.set("currency", currency);
  return `/transactions?${params.toString()}`;
}

function Amount({ label, value, testId }: { label: string; value: string; testId: string }) {
  return (
    <div className="min-w-0">
      <p className="text-xs font-medium tracking-wide text-zinc-500 dark:text-zinc-400">{label}</p>
      <p data-testid={testId} className="mt-0.5 font-mono text-sm font-medium tabular-nums">
        {value}
      </p>
    </div>
  );
}

function DirectionNote({
  totals,
  currency,
}: {
  totals: { spentMinor: number; receivedMinor: number };
  currency: string;
}) {
  if (totals.spentMinor === 0 || totals.receivedMinor === 0) return null;
  return (
    <p data-testid="direction-note" className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
      {formatMinorUnits(totals.spentMinor, currency)} out ·{" "}
      {signed(totals.receivedMinor, currency)} in
    </p>
  );
}

function CategoryRow({
  category,
  query,
  currency,
}: {
  category: SpendingSection["groups"][number]["categories"][number];
  query: SpendingQuery;
  currency: string;
}) {
  return (
    <li data-testid="spend-category" className="flex items-baseline justify-between gap-3 py-2">
      <div className="min-w-0">
        <Link
          href={drillHref(category.id, query, currency)}
          className="text-sm underline-offset-4 hover:underline"
        >
          {category.name}
        </Link>
        <DirectionNote totals={category} currency={currency} />
      </div>
      <p data-testid="category-net" className="font-mono text-sm tabular-nums">
        {signed(category.netMinor, currency)}
      </p>
    </li>
  );
}

function CurrencySection({ section, query }: { section: SpendingSection; query: SpendingQuery }) {
  const { currency } = section;
  return (
    <section
      data-testid={`spend-currency-${currency}`}
      aria-labelledby={`spend-heading-${currency}`}
      className="grid gap-3 md:grid-cols-[8rem_minmax(0,1fr)]"
    >
      <h2
        id={`spend-heading-${currency}`}
        className="pt-4 text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500 dark:text-zinc-400"
      >
        {currency}
      </h2>
      <div>
        <div className="grid grid-cols-3 gap-3 border-t border-zinc-300 py-4 sm:justify-items-end sm:text-right dark:border-zinc-700">
          <Amount
            label="Money in"
            testId="spend-in"
            value={formatMinorUnits(section.totals.receivedMinor, currency)}
          />
          <Amount
            label="Money out"
            testId="spend-out"
            value={formatMinorUnits(section.totals.spentMinor, currency)}
          />
          <Amount
            label="Net"
            testId="spend-net"
            value={signed(section.totals.netMinor, currency)}
          />
        </div>
        <ul className="divide-y divide-zinc-200 border-t border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
          {section.groups.map((group) => (
            <li key={group.id} data-testid="spend-group" className="py-3">
              <div className="flex items-baseline justify-between gap-3">
                <p className="text-sm font-medium">{group.name}</p>
                <p data-testid="group-net" className="font-mono text-sm font-medium tabular-nums">
                  {signed(group.netMinor, currency)}
                </p>
              </div>
              <DirectionNote totals={group} currency={currency} />
              {group.categories.length > 0 && (
                <ul className="mt-1 divide-y divide-zinc-100 pl-4 dark:divide-zinc-900">
                  {group.categories.map((category) => (
                    <CategoryRow
                      key={category.id}
                      category={category}
                      query={query}
                      currency={currency}
                    />
                  ))}
                </ul>
              )}
            </li>
          ))}
          {section.uncategorized && (
            <li data-testid="spend-uncategorized" className="py-3">
              <div className="flex items-baseline justify-between gap-3">
                <Link
                  href={drillHref(UNCATEGORIZED, query, currency)}
                  className="text-sm font-medium underline-offset-4 hover:underline"
                >
                  Uncategorized
                </Link>
                <p data-testid="group-net" className="font-mono text-sm font-medium tabular-nums">
                  {signed(section.uncategorized.netMinor, currency)}
                </p>
              </div>
              <DirectionNote totals={section.uncategorized} currency={currency} />
            </li>
          )}
        </ul>
      </div>
    </section>
  );
}

function Notes({ summary }: { summary: SpendingByCategory }) {
  return (
    <>
      {summary.transferRows > 0 && (
        <p
          data-testid="spend-transfer-note"
          className="mt-3 max-w-xl text-sm leading-6 text-zinc-500 dark:text-zinc-400"
        >
          {summary.transferRows === 1
            ? "1 transaction is an internal transfer leg — left out so nothing counts twice."
            : `${summary.transferRows} transactions are internal transfer legs — left out so nothing counts twice.`}
        </p>
      )}
      {summary.pendingCount > 0 && (
        <p
          data-testid="spend-pending-note"
          className="mt-1 max-w-xl text-sm leading-6 text-zinc-500 dark:text-zinc-400"
        >
          {summary.pendingCount === 1
            ? "1 pending transaction will count once it posts."
            : `${summary.pendingCount} pending transactions will count once they post.`}
        </p>
      )}
    </>
  );
}

export default async function SpendingPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const parsed = parseSpendingQuery(params);
  const summary = await spendingByCategory(parsed);
  const values = (key: SpendingParam) => {
    const value = params[key];
    return typeof value === "string" ? value : "";
  };

  const heading = (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Spending</h1>
      <p className="mt-2 max-w-xl text-sm leading-6 text-zinc-500 dark:text-zinc-400">
        True spend per category from posted transactions, most spent first — money in shows with
        a plus sign. Transfers between your own accounts never count.
      </p>
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
          That period isn&apos;t valid — dates must be real days in order, currency is a
          three-letter code, and nothing else filters this page.
        </p>
        <SpendingFilters currencies={summary.options.currencies} values={values} />
      </>
    );
  }

  const { query } = parsed;
  const filtered = query.from !== null || query.to !== null || query.currency !== null;

  return (
    <>
      {heading}
      {summary.options.currencies.length === 0 ? (
        <section className="mt-10 border-y border-zinc-200 py-8 dark:border-zinc-800">
          <h2 className="text-lg font-medium tracking-tight">No spending yet</h2>
          <p className="mt-2 max-w-lg text-sm leading-6 text-zinc-500 dark:text-zinc-400">
            Connect a bank or card and totals per category land here, drillable to every
            transaction.
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
          <SpendingFilters currencies={summary.options.currencies} values={values} />
          {summary.currencies.length === 0 ? (
            <section data-testid="no-activity" className="mt-8 max-w-xl py-4">
              <p className="text-sm leading-6 text-zinc-500 dark:text-zinc-400">
                {filtered
                  ? "No posted activity in this period."
                  : "No posted activity outside internal transfers yet."}
              </p>
              {filtered && (
                <Link
                  href="/spending"
                  className="mt-2 inline-block text-sm underline underline-offset-4"
                >
                  Clear the period
                </Link>
              )}
              <Notes summary={summary} />
            </section>
          ) : (
            <>
              <div className="mt-6 space-y-10">
                {summary.currencies.map((section) => (
                  <CurrencySection key={section.currency} section={section} query={query} />
                ))}
              </div>
              <Notes summary={summary} />
            </>
          )}
        </>
      )}
    </>
  );
}
