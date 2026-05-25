type SectionCardProps = {
  title: string;
  eyebrow?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
};

export function SectionCard({ title, eyebrow, action, children }: SectionCardProps) {
  return (
    <section className="rounded-[32px] border border-[var(--border)] bg-white/76 p-6 shadow-[var(--card-shadow)] backdrop-blur">
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          {eyebrow ? <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[var(--muted)]">{eyebrow}</p> : null}
          <h2 className="mt-2 text-2xl font-bold tracking-tight text-[var(--foreground)]">{title}</h2>
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}
