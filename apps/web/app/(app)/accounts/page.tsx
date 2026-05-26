import { Link2 } from "lucide-react";

import { ManualSyncButton } from "@/components/manual-sync-button";
import { PlaidConnectButton } from "@/components/plaid-connect-button";
import { SectionCard } from "@/components/section-card";
import { StatusBadge } from "@/components/status-badge";
import { apiFetch } from "@/lib/server-api";
import type { Account, Dashboard } from "@/lib/types";
import { formatCurrency, formatDateTime } from "@/lib/utils";

export default async function AccountsPage() {
  const [accounts, dashboard] = await Promise.all([
    apiFetch<Account[]>("/accounts"),
    apiFetch<Dashboard>("/dashboard"),
  ]);

  return (
    <div className="grid gap-4">
      <SectionCard
        eyebrow="Connections"
        title="Institutions and sync controls"
        action={<PlaidConnectButton />}
      >
        <div className="grid gap-3 lg:grid-cols-2">
          {dashboard.plaid_items.map((item) => (
            <article key={item.id} className="rounded-[24px] border border-[var(--border)] bg-white px-4 py-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-3">
                    <div className="rounded-2xl bg-[var(--accent-soft)] p-3 text-[var(--accent-strong)]">
                      <Link2 className="h-4 w-4" />
                    </div>
                    <div>
                      <p className="text-lg font-semibold text-[var(--foreground)]">{item.institution_name}</p>
                      <p className="text-sm text-[var(--muted)]">{item.plaid_item_id}</p>
                    </div>
                  </div>
                  <p className="mt-4 text-sm text-[var(--muted)]">Last synced {formatDateTime(item.last_synced_at)}</p>
                </div>
                <StatusBadge tone={item.status === "healthy" ? "success" : "warning"}>{item.status}</StatusBadge>
              </div>
              <div className="mt-5">
                <ManualSyncButton plaidItemId={item.id} />
              </div>
            </article>
          ))}
        </div>
      </SectionCard>

      <SectionCard eyebrow="Accounts" title="Current balances">
        <div className="overflow-hidden rounded-[24px] border border-[var(--border)] bg-white">
          <table>
            <thead className="border-b border-[var(--border)] bg-[var(--accent-soft)]/50 text-sm text-[var(--muted)]">
              <tr>
                <th className="px-4 py-3 font-semibold">Account</th>
                <th className="px-4 py-3 font-semibold">Type</th>
                <th className="px-4 py-3 font-semibold">Institution</th>
                <th className="px-4 py-3 font-semibold">Last update</th>
                <th className="px-4 py-3 text-right font-semibold">Current balance</th>
              </tr>
            </thead>
            <tbody>
              {accounts.map((account) => {
                const item = dashboard.plaid_items.find((candidate) => candidate.id === account.plaid_item_id);
                return (
                  <tr key={account.id} className="border-b border-[var(--border)] last:border-0">
                    <td className="px-4 py-4">
                      <p className="font-semibold text-[var(--foreground)]">{account.name}</p>
                      <p className="text-sm text-[var(--muted)]">
                        {account.official_name ?? "Personal account"} {account.mask ? `• •••• ${account.mask}` : ""}
                      </p>
                    </td>
                    <td className="px-4 py-4 text-sm text-[var(--muted)]">
                      {account.type} {account.subtype ? `• ${account.subtype}` : ""}
                    </td>
                    <td className="px-4 py-4 text-sm text-[var(--muted)]">{item?.institution_name ?? "Unassigned"}</td>
                    <td className="px-4 py-4 text-sm text-[var(--muted)]">{formatDateTime(account.last_balance_at)}</td>
                    <td className="px-4 py-4 text-right font-semibold text-[var(--foreground)]">
                      {formatCurrency(account.current_balance)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </SectionCard>
    </div>
  );
}
