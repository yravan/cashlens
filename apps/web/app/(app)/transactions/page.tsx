import Link from "next/link";

import { SectionCard } from "@/components/section-card";
import { StatusBadge } from "@/components/status-badge";
import { TransactionEditor } from "@/components/transaction-editor";
import { apiFetch } from "@/lib/server-api";
import type { Transaction } from "@/lib/types";
import { formatCurrency } from "@/lib/utils";

type TransactionsPageProps = {
  searchParams: Promise<{
    search?: string;
    direction?: "inflow" | "outflow";
    selected?: string;
  }>;
};

export default async function TransactionsPage({ searchParams }: TransactionsPageProps) {
  const params = await searchParams;
  const query = new URLSearchParams();
  if (params.search) query.set("search", params.search);
  if (params.direction) query.set("direction", params.direction);

  const transactions = await apiFetch<Transaction[]>(
    `/transactions${query.toString() ? `?${query.toString()}` : ""}`,
  );
  const selectedTransaction = params.selected
    ? transactions.find((transaction) => transaction.id === Number(params.selected))
    : transactions[0];

  return (
    <div className="grid gap-4 xl:grid-cols-[1.25fr_0.75fr]">
      <SectionCard eyebrow="Ledger" title="Transaction history">
        <form className="mb-5 grid gap-3 rounded-[24px] border border-[var(--border)] bg-white p-4 md:grid-cols-[1fr_220px_auto]">
          <input
            type="text"
            name="search"
            defaultValue={params.search ?? ""}
            placeholder="Search merchant or name"
            className="rounded-2xl border border-[var(--border)] bg-[var(--background)] px-4 py-3 outline-none"
          />
          <select
            name="direction"
            defaultValue={params.direction ?? ""}
            className="rounded-2xl border border-[var(--border)] bg-[var(--background)] px-4 py-3 outline-none"
          >
            <option value="">All directions</option>
            <option value="outflow">Outflow</option>
            <option value="inflow">Inflow</option>
          </select>
          <button
            type="submit"
            className="rounded-full bg-[var(--accent-strong)] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[var(--accent)]"
          >
            Apply filters
          </button>
        </form>

        <div className="overflow-hidden rounded-[24px] border border-[var(--border)] bg-white">
          <table>
            <thead className="border-b border-[var(--border)] bg-[var(--accent-soft)]/50 text-sm text-[var(--muted)]">
              <tr>
                <th className="px-4 py-3 font-semibold">Merchant</th>
                <th className="px-4 py-3 font-semibold">Category</th>
                <th className="px-4 py-3 font-semibold">Flags</th>
                <th className="px-4 py-3 font-semibold">Date</th>
                <th className="px-4 py-3 text-right font-semibold">Amount</th>
              </tr>
            </thead>
            <tbody>
              {transactions.map((transaction) => {
                const selected = selectedTransaction?.id === transaction.id;
                const queryParams = new URLSearchParams();
                if (params.search) queryParams.set("search", params.search);
                if (params.direction) queryParams.set("direction", params.direction);
                queryParams.set("selected", String(transaction.id));

                return (
                  <tr key={transaction.id} className="border-b border-[var(--border)] last:border-0">
                    <td className="px-4 py-4">
                      <Link href={`/transactions?${queryParams.toString()}`} className="block">
                        <p className="font-semibold text-[var(--foreground)]">{transaction.merchant_name}</p>
                        <p className="text-sm text-[var(--muted)]">{transaction.event_type}</p>
                      </Link>
                    </td>
                    <td className="px-4 py-4 text-sm text-[var(--muted)]">
                      {transaction.category ?? "Needs review"}
                      {transaction.subcategory ? ` / ${transaction.subcategory}` : ""}
                    </td>
                    <td className="px-4 py-4 text-sm">
                      <div className="flex flex-wrap gap-2">
                        {transaction.exclude_from_spend ? <StatusBadge tone="warning">Excluded</StatusBadge> : null}
                        {transaction.is_transfer ? <StatusBadge>Transfer</StatusBadge> : null}
                        {selected ? <StatusBadge tone="success">Selected</StatusBadge> : null}
                      </div>
                    </td>
                    <td className="px-4 py-4 text-sm text-[var(--muted)]">{transaction.date}</td>
                    <td className="px-4 py-4 text-right font-semibold text-[var(--foreground)]">
                      {transaction.amount > 0 ? "+" : "-"}
                      {formatCurrency(Math.abs(transaction.amount))}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </SectionCard>

      <div>
        {selectedTransaction ? (
          <TransactionEditor key={selectedTransaction.id} transaction={selectedTransaction} />
        ) : (
          <SectionCard eyebrow="Review" title="Select a transaction">
            <p className="text-sm text-[var(--muted)]">Choose a transaction row to edit category, subtype, or spend exclusion.</p>
          </SectionCard>
        )}
      </div>
    </div>
  );
}
