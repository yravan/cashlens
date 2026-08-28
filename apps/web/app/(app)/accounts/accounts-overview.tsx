import type { accountOverview } from "@/lib/data/ledger";
import { formatMinorUnits } from "@/lib/ledger/minor-units";

type Overview = Awaited<ReturnType<typeof accountOverview>>;
type Account = Overview["accounts"][number];
type AccountType = Account["type"];

// Record, not a list: a new account_type has to be given a group here or the build fails.
const GROUP_LABELS: Record<AccountType, string> = {
  depository: "Cash",
  credit: "Credit",
  loan: "Loans",
  investment: "Investments",
  other: "Other",
};
const GROUPS = Object.entries(GROUP_LABELS) as [AccountType, string][];

function Summary({
  title,
  detail,
  totals,
  testId,
}: {
  title: string;
  detail: string;
  totals: Record<string, number>;
  testId: string;
}) {
  const entries = Object.entries(totals).sort(([a], [b]) => a.localeCompare(b));
  return (
    <div className="py-5 md:px-6 md:first:pl-0 md:last:pr-0">
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500 dark:text-zinc-400">
        {title}
      </p>
      <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">{detail}</p>
      {entries.length === 0 ? (
        <p className="mt-4 font-mono text-xl text-zinc-400 dark:text-zinc-500">
          <span aria-hidden="true">—</span>
          <span className="sr-only">None</span>
        </p>
      ) : (
        <ul className="mt-4 space-y-2">
          {entries.map(([currency, amount]) => (
            <li key={currency} className="flex items-baseline justify-between gap-4">
              <span className="text-xs font-medium tracking-wide text-zinc-500 dark:text-zinc-400">
                {currency}
              </span>
              <span
                data-testid={`${testId}-${currency}`}
                className="font-mono text-xl font-medium tabular-nums tracking-tight"
              >
                {formatMinorUnits(amount, currency)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function AccountRow({ account }: { account: Account }) {
  const detail = [
    account.subtype && account.subtype[0].toUpperCase() + account.subtype.slice(1),
    account.mask && `•••• ${account.mask}`,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <li
      data-testid="account-row"
      className="grid gap-3 py-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
    >
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{account.name}</p>
        {detail && <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{detail}</p>}
      </div>
      <div className="sm:text-right">
        {account.currentMinor === null ? (
          <p className="text-sm text-zinc-500 dark:text-zinc-400">Balance unavailable</p>
        ) : (
          <p className="font-mono text-base font-medium tabular-nums">
            {formatMinorUnits(account.currentMinor, account.currency)}
          </p>
        )}
        <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">{account.currency}</p>
      </div>
    </li>
  );
}

export function AccountsOverview({ overview }: { overview: Overview }) {
  if (overview.accounts.length === 0) {
    return (
      <section className="mt-10 border-y border-zinc-200 py-8 dark:border-zinc-800">
        <h2 className="text-lg font-medium tracking-tight">No accounts yet</h2>
        <p className="mt-2 max-w-lg text-sm leading-6 text-zinc-500 dark:text-zinc-400">
          Connect a bank or card to bring its accounts and latest balances into one place.
        </p>
      </section>
    );
  }

  return (
    <>
      <section aria-labelledby="balance-summary" className="mt-10">
        <h2 id="balance-summary" className="sr-only">Balance summary</h2>
        <div className="grid border-y border-zinc-300 md:grid-cols-2 md:divide-x md:divide-zinc-300 dark:border-zinc-700 md:dark:divide-zinc-700">
          <Summary
            title="Cash on hand"
            detail="Current cash-account balances"
            totals={overview.cashOnHand}
            testId="cash-on-hand"
          />
          <Summary
            title="Credit owed"
            detail="Current credit-account balances"
            totals={overview.creditOwed}
            testId="credit-owed"
          />
        </div>
      </section>

      <section aria-labelledby="all-accounts" className="mt-10">
        <h2 id="all-accounts" className="text-lg font-medium tracking-tight">All accounts</h2>
        <div className="mt-5 space-y-8">
          {GROUPS.map(([type, label]) => {
            const grouped = overview.accounts.filter((account) => account.type === type);
            if (grouped.length === 0) return null;
            return (
              <section
                key={type}
                data-testid={`account-group-${type}`}
                aria-labelledby={`account-group-heading-${type}`}
                className="grid gap-3 md:grid-cols-[8rem_minmax(0,1fr)]"
              >
                <h3
                  id={`account-group-heading-${type}`}
                  className="pt-4 text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500 dark:text-zinc-400"
                >
                  {label}
                </h3>
                <ul className="divide-y divide-zinc-200 border-t border-zinc-300 dark:divide-zinc-800 dark:border-zinc-700">
                  {grouped.map((account) => <AccountRow key={account.id} account={account} />)}
                </ul>
              </section>
            );
          })}
        </div>
      </section>
    </>
  );
}
