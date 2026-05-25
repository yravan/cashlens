import { type ReactNode } from "react";

type SummaryCardProps = {
  label: string;
  value: string;
  caption: string;
  accent?: string;
  icon: ReactNode;
};

export function SummaryCard({ label, value, caption, accent, icon }: SummaryCardProps) {
  return (
    <article className="rounded-[28px] border border-[var(--border)] bg-white/80 p-5 shadow-[var(--card-shadow)] backdrop-blur">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-[var(--muted)]">{label}</p>
          <p className="mt-2 text-3xl font-bold tracking-tight text-[var(--foreground)]">{value}</p>
        </div>
        <div
          className="flex h-12 w-12 items-center justify-center rounded-2xl text-[var(--accent-strong)]"
          style={{ background: accent ?? "var(--accent-soft)" }}
        >
          {icon}
        </div>
      </div>
      <p className="text-sm text-[var(--muted)]">{caption}</p>
    </article>
  );
}
