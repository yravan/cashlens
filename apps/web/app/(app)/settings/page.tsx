import { ShieldCheck, Sparkles } from "lucide-react";

import { ManualSyncButton } from "@/components/manual-sync-button";
import { MarkAllReadButton } from "@/components/mark-all-read-button";
import { PlaidConnectButton } from "@/components/plaid-connect-button";
import { SectionCard } from "@/components/section-card";
import { StatusBadge } from "@/components/status-badge";
import { apiFetch } from "@/lib/server-api";
import type { Dashboard, LinkTokenResponse, Notification, User } from "@/lib/types";
import { clerkEnabled } from "@/lib/runtime";
import { formatDateTime } from "@/lib/utils";

export default async function SettingsPage() {
  const [user, dashboard, notifications, linkToken] = await Promise.all([
    apiFetch<User>("/me"),
    apiFetch<Dashboard>("/dashboard"),
    apiFetch<Notification[]>("/notifications"),
    apiFetch<LinkTokenResponse>("/plaid/create-link-token", { method: "POST" }),
  ]);

  return (
    <div className="grid gap-4">
      <section className="grid gap-4 lg:grid-cols-[0.9fr_1.1fr]">
        <SectionCard eyebrow="Profile" title="Workspace settings">
          <div className="grid gap-4">
            <div className="rounded-[24px] border border-[var(--border)] bg-white px-4 py-4">
              <p className="text-sm font-medium text-[var(--muted)]">User</p>
              <p className="mt-1 text-lg font-semibold text-[var(--foreground)]">{user.full_name ?? user.email}</p>
              <p className="text-sm text-[var(--muted)]">{user.email}</p>
            </div>
            <div className="rounded-[24px] border border-[var(--border)] bg-white px-4 py-4">
              <p className="text-sm font-medium text-[var(--muted)]">Auth mode</p>
              <div className="mt-2 flex items-center gap-3">
                <StatusBadge tone={clerkEnabled ? "success" : "warning"}>{clerkEnabled ? "Clerk ready" : "Demo mode"}</StatusBadge>
                <p className="text-sm text-[var(--muted)]">
                  {clerkEnabled
                    ? "Clerk credentials are configured and active for this environment."
                    : "Single-user demo mode is active because Clerk has been explicitly disabled or its keys are missing."}
                </p>
              </div>
            </div>
            <div className="rounded-[24px] border border-[var(--border)] bg-white px-4 py-4">
              <p className="text-sm font-medium text-[var(--muted)]">Plaid</p>
              <div className="mt-3 flex flex-wrap gap-3">
                <PlaidConnectButton mode={linkToken.mode} linkToken={linkToken.link_token} />
              </div>
            </div>
          </div>
        </SectionCard>

        <SectionCard eyebrow="Connected items" title="Sync and notification controls" action={<MarkAllReadButton />}>
          <div className="grid gap-3">
            {dashboard.plaid_items.map((item) => (
              <article key={item.id} className="rounded-[24px] border border-[var(--border)] bg-white px-4 py-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-lg font-semibold text-[var(--foreground)]">{item.institution_name}</p>
                    <p className="text-sm text-[var(--muted)]">Last synced {formatDateTime(item.last_synced_at)}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <StatusBadge tone={item.status === "healthy" ? "success" : "warning"}>{item.status}</StatusBadge>
                    <ManualSyncButton plaidItemId={item.id} />
                  </div>
                </div>
              </article>
            ))}
          </div>
        </SectionCard>
      </section>

      <section className="grid gap-4 lg:grid-cols-[1fr_1fr]">
        <SectionCard eyebrow="Notifications" title="Recent in-app events">
          <div className="grid gap-3">
            {notifications.slice(0, 8).map((notification) => (
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
              </article>
            ))}
          </div>
        </SectionCard>

        <SectionCard eyebrow="Deployment posture" title="What this build already supports">
          <div className="grid gap-3">
            <div className="rounded-[24px] border border-[var(--border)] bg-white px-4 py-4">
              <div className="flex items-center gap-3">
                <div className="rounded-2xl bg-[var(--accent-soft)] p-3 text-[var(--accent-strong)]">
                  <ShieldCheck className="h-5 w-5" />
                </div>
                <div>
                  <p className="font-semibold text-[var(--foreground)]">Server-side proxying</p>
                  <p className="text-sm text-[var(--muted)]">The browser talks to Next.js, and Next.js forwards authenticated requests to the Python API.</p>
                </div>
              </div>
            </div>
            <div className="rounded-[24px] border border-[var(--border)] bg-white px-4 py-4">
              <div className="flex items-center gap-3">
                <div className="rounded-2xl bg-[var(--accent-soft)] p-3 text-[var(--accent-strong)]">
                  <Sparkles className="h-5 w-5" />
                </div>
                <div>
                  <p className="font-semibold text-[var(--foreground)]">Demo-first onboarding</p>
                  <p className="text-sm text-[var(--muted)]">Without secrets, the app still opens with seeded balances, synced transactions, and notifications for end-to-end review.</p>
                </div>
              </div>
            </div>
          </div>
        </SectionCard>
      </section>
    </div>
  );
}
