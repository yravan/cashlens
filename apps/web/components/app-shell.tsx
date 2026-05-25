import { BellDot, CreditCard, LayoutDashboard, Settings, Wallet } from "lucide-react";

import { NavLink } from "@/components/nav-link";
import { UserPill } from "@/components/user-pill";

type AppShellProps = {
  authMode: "demo" | "clerk";
  children: React.ReactNode;
};

export function AppShell({ authMode, children }: AppShellProps) {
  return (
    <div className="mx-auto flex min-h-screen w-full max-w-[1600px] flex-col px-4 py-4 lg:flex-row lg:gap-4 lg:px-6 lg:py-6">
      <aside className="mb-4 rounded-[32px] border border-[var(--border)] bg-[var(--sidebar-bg)] p-5 shadow-[var(--card-shadow)] backdrop-blur lg:sticky lg:top-6 lg:mb-0 lg:flex lg:w-[280px] lg:flex-col lg:justify-between">
        <div>
          <div className="rounded-[26px] bg-[var(--accent-strong)] p-5 text-[var(--sidebar-foreground)]">
            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-white/70">Cash Lens</p>
            <h1 className="mt-3 text-3xl font-bold tracking-tight">See your real spending, not just your bank feed.</h1>
            <p className="mt-4 text-sm text-white/75">
              Ledger-first personal finance for accounts, sync status, notifications, and true spend.
            </p>
          </div>
          <nav className="mt-5 grid gap-2">
            <NavLink href="/dashboard" icon={<LayoutDashboard className="h-4 w-4" />} label="Dashboard" />
            <NavLink href="/accounts" icon={<Wallet className="h-4 w-4" />} label="Accounts" />
            <NavLink href="/transactions" icon={<CreditCard className="h-4 w-4" />} label="Transactions" />
            <NavLink href="/settings" icon={<Settings className="h-4 w-4" />} label="Settings" />
          </nav>
        </div>
        <div className="mt-6 flex items-center justify-between rounded-[24px] border border-white/50 bg-white/70 p-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--muted)]">Mode</p>
            <p className="mt-1 text-sm font-semibold text-[var(--foreground)]">{authMode === "demo" ? "Demo-ready" : "Clerk-authenticated"}</p>
          </div>
          <div className="rounded-2xl bg-[var(--accent-soft)] p-3 text-[var(--accent-strong)]">
            <BellDot className="h-5 w-5" />
          </div>
        </div>
      </aside>

      <div className="flex-1">
        <header className="mb-4 flex items-center justify-between rounded-[28px] border border-[var(--border)] bg-white/72 px-5 py-4 shadow-[var(--card-shadow)] backdrop-blur">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[var(--muted)]">Personal finance workspace</p>
            <h2 className="mt-1 text-xl font-bold tracking-tight text-[var(--foreground)]">Cash Lens MVP</h2>
          </div>
          <UserPill authMode={authMode} />
        </header>
        <main>{children}</main>
      </div>
    </div>
  );
}
