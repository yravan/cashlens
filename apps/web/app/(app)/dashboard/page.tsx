import { ArrowDownLeft, ArrowUpRight, Landmark, PiggyBank } from "lucide-react";

import { MarkAllReadButton } from "@/components/mark-all-read-button";
import { SectionCard } from "@/components/section-card";
import { StatusBadge } from "@/components/status-badge";
import { SummaryCard } from "@/components/summary-card";
import { apiFetch } from "@/lib/server-api";
import type { Dashboard } from "@/lib/types";
import { formatCompactCurrency, formatCurrency, formatDateTime } from "@/lib/utils";

export default async function DashboardPage() {
  const dashboard = await apiFetch<Dashboard>("/dashboard");

  return (
    <div className="grid gap-4">
      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <SummaryCard
          label="Total cash"
          value={formatCompactCurrency(dashboard.summary.total_cash_balance)}
          caption="Checking and savings accounts"
          icon={<Landmark className="h-6 w-6" />}
        />
        <SummaryCard
          label="Credit balance"
          value={formatCompactCurrency(dashboard.summary.total_credit_balance)}
          caption="Outstanding card balances"
          accent="rgba(249, 221, 186, 0.8)"
          icon={<PiggyBank className="h-6 w-6" />}
        />
        <SummaryCard
          label="Net inflow"
          value={formatCompactCurrency(dashboard.summary.net_inflow_this_month)}
          caption="Deposits and refunds this month"
          icon={<ArrowDownLeft className="h-6 w-6" />}
        />
        <SummaryCard
          label="True spend"
          value={formatCompactCurrency(dashboard.summary.true_spend_this_month)}
          caption={`Unread notifications: ${dashboard.summary.unread_notifications}`}
          accent="rgba(212, 242, 224, 0.9)"
          icon={<ArrowUpRight className="h-6 w-6" />}
        />
      </section>

      <section className="grid gap-4 xl:grid-cols-[1.3fr_0.9fr]">
        <SectionCard
          eyebrow="Balances"
          title="Accounts snapshot"
          action={<StatusBadge tone="success">Latest sync: {dashboard.summary.latest_sync_status}</StatusBadge>}
        >
          <div className="grid gap-3">
            {dashboard.accounts.map((account) => (
              <div
                key={account.id}
                className="flex flex-col gap-3 rounded-[24px] border border-[var(--border)] bg-white px-4 py-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <div>
                  <p className="text-lg font-semibold text-[var(--foreground)]">{account.name}</p>
                  <p className="text-sm text-[var(--muted)]">
                    {account.type} {account.subtype ? `• ${account.subtype}` : ""} {account.mask ? `• •••• ${account.mask}` : ""}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-lg font-semibold text-[var(--foreground)]">{formatCurrency(account.current_balance)}</p>
                  <p className="text-sm text-[var(--muted)]">Updated {formatDateTime(account.last_balance_at)}</p>
                </div>
              </div>
            ))}
          </div>
        </SectionCard>

        <SectionCard eyebrow="Plaid" title="Connected institutions">
          <div className="grid gap-3">
            {dashboard.plaid_items.map((item) => (
              <div key={item.id} className="rounded-[24px] border border-[var(--border)] bg-white px-4 py-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-lg font-semibold text-[var(--foreground)]">{item.institution_name}</p>
                    <p className="text-sm text-[var(--muted)]">Item {item.plaid_item_id}</p>
                  </div>
                  <StatusBadge tone={item.status === "healthy" ? "success" : "warning"}>{item.status}</StatusBadge>
                </div>
                <p className="mt-3 text-sm text-[var(--muted)]">Last synced {formatDateTime(item.last_synced_at)}</p>
              </div>
            ))}
          </div>
        </SectionCard>
      </section>

      <section className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
        <SectionCard eyebrow="Activity" title="Recent transactions">
          <div className="overflow-hidden rounded-[24px] border border-[var(--border)] bg-white">
            <table className="min-w-full">
              <thead className="border-b border-[var(--border)] bg-[var(--accent-soft)]/50">
                <tr className="text-sm text-[var(--muted)]">
                  <th className="px-4 py-3 font-semibold">Merchant</th>
                  <th className="px-4 py-3 font-semibold">Category</th>
                  <th className="px-4 py-3 font-semibold">Date</th>
                  <th className="px-4 py-3 text-right font-semibold">Amount</th>
                </tr>
              </thead>
              <tbody>
                {dashboard.recent_transactions.map((transaction) => (
                  <tr key={transaction.id} className="border-b border-[var(--border)] last:border-0">
                    <td className="px-4 py-4">
                      <p className="font-semibold text-[var(--foreground)]">{transaction.merchant_name}</p>
                      <p className="text-sm text-[var(--muted)]">{transaction.event_type}</p>
                    </td>
                    <td className="px-4 py-4 text-sm text-[var(--muted)]">
                      {transaction.category ?? "Needs review"}
                      {transaction.subcategory ? ` / ${transaction.subcategory}` : ""}
                    </td>
                    <td className="px-4 py-4 text-sm text-[var(--muted)]">{transaction.date}</td>
                    <td className="px-4 py-4 text-right font-semibold text-[var(--foreground)]">
                      {transaction.amount > 0 ? "+" : "-"}
                      {formatCurrency(Math.abs(transaction.amount))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </SectionCard>

        <SectionCard eyebrow="Alerts" title="Recent notifications" action={<MarkAllReadButton />}>
          <div className="grid gap-3">
            {dashboard.recent_notifications.map((notification) => (
              <article key={notification.id} className="rounded-[24px] border border-[var(--border)] bg-white px-4 py-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold text-[var(--foreground)]">{notification.title}</p>
                    <p className="mt-1 text-sm leading-6 text-[var(--muted)]">{notification.body}</p>
                  </div>
                  <StatusBadge tone={notification.read_at ? "neutral" : "warning"}>
                    {notification.read_at ? "Read" : "Unread"}
                  </StatusBadge>
                </div>
                <p className="mt-3 text-xs font-medium uppercase tracking-[0.18em] text-[var(--muted)]">
                  {notification.type} • {formatDateTime(notification.created_at)}
                </p>
              </article>
            ))}
          </div>
        </SectionCard>
      </section>
    </div>
  );
}
