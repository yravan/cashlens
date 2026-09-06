import Link from "next/link";

import type { CashFlowSummary } from "@/lib/data/ledger";
import { formatMinorUnits } from "@/lib/ledger/minor-units";

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

// The bucket is a plain "YYYY-MM" string; never route it through Date for
// display (UTC-midnight parsing shifts a day in negative-offset zones).
function monthParts(month: string): { label: string; from: string; to: string } {
  const year = Number(month.slice(0, 4));
  const monthNumber = Number(month.slice(5, 7));
  const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  return {
    label: `${MONTH_NAMES[monthNumber - 1]} ${month.slice(0, 4)}`,
    from: `${month}-01`,
    to: `${month}-${String(lastDay).padStart(2, "0")}`,
  };
}

const signed = (minor: number, currency: string) =>
  `${minor > 0 ? "+" : ""}${formatMinorUnits(minor, currency)}`;

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

function Notes({ summary }: { summary: CashFlowSummary }) {
  return (
    <>
      {summary.transferRows > 0 && (
        <p data-testid="flow-transfer-note" className="mt-3 max-w-xl text-sm leading-6 text-zinc-500 dark:text-zinc-400">
          {summary.transferRows === 1
            ? "1 transaction is an internal transfer leg — left out so nothing counts twice."
            : `${summary.transferRows} transactions are internal transfer legs — left out so nothing counts twice.`}
        </p>
      )}
      {summary.pendingCount > 0 && (
        <p data-testid="flow-pending-note" className="mt-1 max-w-xl text-sm leading-6 text-zinc-500 dark:text-zinc-400">
          {summary.pendingCount === 1
            ? "1 pending transaction will count once it posts."
            : `${summary.pendingCount} pending transactions will count once they post.`}
        </p>
      )}
    </>
  );
}

export function CashFlow({ summary }: { summary: CashFlowSummary }) {
  if (summary.currencies.length === 0) {
    return (
      <section className="mt-10 border-y border-zinc-200 py-8 dark:border-zinc-800">
        <h2 className="text-lg font-medium tracking-tight">No cash flow yet</h2>
        <p className="mt-2 max-w-lg text-sm leading-6 text-zinc-500 dark:text-zinc-400">
          Connect a bank or card and money in, money out, and net land here by month.
        </p>
        <Notes summary={summary} />
        <Link href="/accounts" className="mt-4 inline-block text-sm underline underline-offset-4">
          Go to accounts
        </Link>
      </section>
    );
  }

  return (
    <>
      <div className="mt-10 space-y-10">
        {summary.currencies.map(({ currency, months }) => (
          <section
            key={currency}
            data-testid={`flow-currency-${currency}`}
            aria-labelledby={`flow-heading-${currency}`}
            className="grid gap-3 md:grid-cols-[8rem_minmax(0,1fr)]"
          >
            <h2
              id={`flow-heading-${currency}`}
              className="pt-4 text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500 dark:text-zinc-400"
            >
              {currency}
            </h2>
            <ul className="divide-y divide-zinc-200 border-t border-zinc-300 dark:divide-zinc-800 dark:border-zinc-700">
              {months.map((flow) => {
                const { label, from, to } = monthParts(flow.month);
                return (
                  <li
                    key={flow.month}
                    data-testid="flow-month"
                    className="grid gap-3 py-4 sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)] sm:items-center"
                  >
                    <Link
                      href={`/transactions?from=${from}&to=${to}&currency=${currency}`}
                      className="text-sm font-medium underline-offset-4 hover:underline"
                    >
                      {label}
                    </Link>
                    <div className="grid grid-cols-3 gap-3 sm:justify-items-end sm:text-right">
                      <Amount label="Money in" testId="flow-in" value={formatMinorUnits(flow.inflowMinor, currency)} />
                      <Amount label="Money out" testId="flow-out" value={formatMinorUnits(flow.outflowMinor, currency)} />
                      <Amount label="Net" testId="flow-net" value={signed(flow.netMinor, currency)} />
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
      <Notes summary={summary} />
    </>
  );
}
