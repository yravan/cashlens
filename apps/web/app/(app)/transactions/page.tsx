import type { Metadata } from "next";

import { listCategoryGroups } from "@/lib/data/categories";
import { listTransactions } from "@/lib/data/ledger";
import { formatMinorUnits } from "@/lib/ledger/minor-units";
import { CategorySelect } from "./category-select";

export const metadata: Metadata = { title: "Transactions" };

export default async function TransactionsPage() {
  const [rows, groups] = await Promise.all([listTransactions(), listCategoryGroups()]);

  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Transactions</h1>
      <p
        data-testid="transactions-count"
        className="mt-2 text-sm text-zinc-500 dark:text-zinc-400"
      >
        {rows.length === 1
          ? "1 transaction in the ledger"
          : `${rows.length} transactions in the ledger`}
      </p>
      <p className="mt-2 max-w-xl text-sm leading-6 text-zinc-500 dark:text-zinc-400">
        Set any transaction&apos;s category below. Search, filters, and full history land with
        leaf 3.6.1.
      </p>

      {rows.length > 0 && (
        <ul className="mt-8 divide-y divide-zinc-200 border-t border-zinc-300 dark:divide-zinc-800 dark:border-zinc-700">
          {rows.map((row) => (
            <li
              key={row.id}
              data-testid="transaction-row"
              className="grid gap-3 py-4 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,14rem)] sm:items-center"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{row.merchant ?? row.description}</p>
                <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                  {row.date} · {row.source}
                  {row.status === "pending" && " · pending"}
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
                label={row.merchant ?? row.description}
                groups={groups}
              />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
