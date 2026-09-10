import type { Metadata } from "next";
import Link from "next/link";

import { upcomingOverview, type UpcomingOverview } from "@/lib/data/recurring";
import { formatMinorUnits } from "@/lib/ledger/minor-units";
import { parseUpcomingQuery, type UpcomingOccurrence } from "@/lib/ledger/upcoming";
import { TransferMatch } from "../transactions/transfer-match";

export const metadata: Metadata = { title: "Upcoming" };

const CADENCE_LABEL = {
  weekly: "Weekly",
  biweekly: "Every 2 weeks",
  monthly: "Monthly",
  annual: "Yearly",
} as const;

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const monthOf = (iso: string) => MONTHS[Number(iso.slice(5, 7)) - 1];
const monthName = (iso: string) => `${monthOf(iso)} ${iso.slice(0, 4)}`;
const shortDate = (iso: string) =>
  `${monthOf(iso).slice(0, 3)} ${Number(iso.slice(8, 10))}, ${iso.slice(0, 4)}`;
const signed = (minor: number, currency: string) =>
  `${minor > 0 ? "+" : ""}${formatMinorUnits(minor, currency)}`;

function calendarWeeks(reference: string, monthEnd: string): (number | null)[][] {
  const [year, month] = reference.split("-").map(Number);
  const cells: (number | null)[] = [
    ...Array.from({ length: new Date(Date.UTC(year, month - 1, 1)).getUTCDay() }, () => null),
    ...Array.from({ length: Number(monthEnd.slice(8, 10)) }, (_, day) => day + 1),
  ];
  while (cells.length % 7) cells.push(null);
  const weeks: (number | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

function MonthCalendar({ overview }: { overview: UpcomingOverview }) {
  const byDay = new Map<number, UpcomingOccurrence[]>();
  for (const section of overview.currencies) {
    for (const occurrence of [...section.charges, ...section.deposits]) {
      if (occurrence.date.slice(0, 7) !== overview.reference.slice(0, 7)) continue;
      const day = Number(occurrence.date.slice(8, 10));
      byDay.set(day, [...(byDay.get(day) ?? []), occurrence]);
    }
  }
  if (byDay.size === 0) return null;
  const referenceDay = Number(overview.reference.slice(8, 10));

  return (
    <div className="mt-6 overflow-x-auto">
      <table data-testid="upcoming-calendar" className="w-full min-w-[36rem] table-fixed border-collapse text-left">
        <caption className="pb-2 text-left text-sm font-medium">{monthName(overview.reference)}</caption>
        <thead>
          <tr>
            {WEEKDAYS.map((weekday) => (
              <th key={weekday} scope="col" className="border border-zinc-200 px-1.5 py-1 text-xs font-medium text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
                <span aria-hidden="true">{weekday.slice(0, 3)}</span>
                <span className="sr-only">{weekday}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {calendarWeeks(overview.reference, overview.monthEnd).map((week, index) => (
            <tr key={index}>
              {week.map((day, weekday) =>
                day === null ? (
                  <td key={weekday} className="border border-zinc-200 dark:border-zinc-800" />
                ) : (
                  <td key={weekday} className="h-16 border border-zinc-200 px-1.5 py-1 align-top text-xs dark:border-zinc-800">
                    <span className={day === referenceDay ? "inline-block rounded bg-zinc-900 px-1 font-semibold text-white dark:bg-zinc-100 dark:text-zinc-900" : "text-zinc-500 dark:text-zinc-400"}>
                      {day}
                      {day === referenceDay && <span className="sr-only"> — the day this view is projected from</span>}
                    </span>
                    {(byDay.get(day) ?? []).map((occurrence) => (
                      <p key={`${occurrence.accountId}:${occurrence.currency}:${occurrence.direction}:${occurrence.normalizedName}`} className="mt-0.5 truncate">
                        <span className="font-medium">{occurrence.overdue ? "! " : ""}{occurrence.name}</span>{" "}
                        <span className="text-zinc-500 tabular-nums dark:text-zinc-400">{signed(occurrence.amountMinor, occurrence.currency)}</span>
                        {occurrence.overdue && <span className="sr-only"> — expected but not seen yet</span>}
                      </p>
                    ))}
                  </td>
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function OccurrenceRow({ occurrence, kind }: { occurrence: UpcomingOccurrence; kind: "charge" | "deposit" }) {
  const query = new URLSearchParams({ account: occurrence.accountId, q: occurrence.name });
  return (
    <li data-testid={`upcoming-${kind}`} className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 py-3">
      <div className="min-w-0">
        <Link href={`/transactions?${query.toString()}`} className="text-sm font-medium underline-offset-4 hover:underline">
          {occurrence.name}
        </Link>
        <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
          {CADENCE_LABEL[occurrence.cadence]} · expected {shortDate(occurrence.date)}
          {occurrence.overdue && (
            <span className="font-medium text-red-700 dark:text-red-400"> — not seen yet</span>
          )}{" "}
          · last on {shortDate(occurrence.lastDate)}
        </p>
      </div>
      <p className="font-mono text-sm font-medium tabular-nums">
        {signed(occurrence.amountMinor, occurrence.currency)}
      </p>
    </li>
  );
}

function CurrencySection({ section, monthLabel }: { section: UpcomingOverview["currencies"][number]; monthLabel: string }) {
  return (
    <section
      data-testid={`upcoming-currency-${section.currency}`}
      aria-labelledby={`upcoming-heading-${section.currency}`}
      className="mt-8 grid gap-3 md:grid-cols-[8rem_minmax(0,1fr)]"
    >
      <h2 id={`upcoming-heading-${section.currency}`} className="pt-4 text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500 dark:text-zinc-400">
        {section.currency}
      </h2>
      <div>
        <div className="flex flex-wrap items-baseline gap-x-8 gap-y-2 border-t border-zinc-300 py-4 dark:border-zinc-700">
          <div>
            <p className="text-xs font-medium tracking-wide text-zinc-500 dark:text-zinc-400">
              Still to leave in {monthLabel}
            </p>
            <p data-testid="upcoming-to-leave" className="mt-0.5 font-mono text-lg font-semibold tabular-nums">
              {formatMinorUnits(section.toLeaveMinor, section.currency)}
            </p>
          </div>
          {section.toArriveMinor !== 0 && (
            <div>
              <p className="text-xs font-medium tracking-wide text-zinc-500 dark:text-zinc-400">Expected in</p>
              <p data-testid="upcoming-to-arrive" className="mt-0.5 font-mono text-lg font-semibold tabular-nums">
                {signed(section.toArriveMinor, section.currency)}
              </p>
            </div>
          )}
        </div>
        {section.charges.length > 0 && (
          <ul className="divide-y divide-zinc-200 border-t border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
            {section.charges.map((charge) => (
              <OccurrenceRow key={`${charge.accountId}:${charge.direction}:${charge.normalizedName}:${charge.date}`} occurrence={charge} kind="charge" />
            ))}
          </ul>
        )}
        {section.deposits.length > 0 && (
          <>
            <h3 className="mt-4 text-sm font-medium">Expected to arrive</h3>
            <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
              {section.deposits.map((deposit) => (
                <OccurrenceRow key={`${deposit.accountId}:${deposit.direction}:${deposit.normalizedName}:${deposit.date}`} occurrence={deposit} kind="deposit" />
              ))}
            </ul>
          </>
        )}
      </div>
    </section>
  );
}

export default async function UpcomingPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const parsed = parseUpcomingQuery(await searchParams);

  const heading = (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Upcoming</h1>
      <p className="mt-2 max-w-xl text-sm leading-6 text-zinc-500 dark:text-zinc-400">
        Predicted next charges from your recurring patterns — nothing here is posted yet, and
        nothing here counts in your totals. <Link href="/recurring" className="underline underline-offset-4">Manage recurring</Link>.
      </p>
    </>
  );

  if (!parsed.ok) {
    return (
      <>
        {heading}
        <p data-testid="filter-error" role="status" className="mt-2 max-w-xl text-sm leading-6 text-red-600 dark:text-red-400">
          That date isn&apos;t valid — use a real day as <code>on=YYYY-MM-DD</code>, and nothing
          else filters this page.
        </p>
      </>
    );
  }

  const reference = parsed.query.on ?? new Date().toISOString().slice(0, 10);
  const overview = await upcomingOverview(reference);
  const monthLabel = monthOf(reference);

  return (
    <>
      {heading}
      <TransferMatch />
      {parsed.query.on !== null && (
        <p data-testid="upcoming-pinned" className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
          Projected as of {shortDate(parsed.query.on)} ·{" "}
          <Link href="/upcoming" className="underline underline-offset-4">Back to today</Link>
        </p>
      )}
      {overview.trackedCount === 0 ? (
        <p data-testid="upcoming-empty" className="mt-8 max-w-xl border-y border-zinc-200 py-6 text-sm leading-6 text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
          Nothing to project yet. Once a charge repeats three times on a steady rhythm it shows
          up under <Link href="/recurring" className="underline underline-offset-4">Recurring</Link>, and its next dates land here.
        </p>
      ) : (
        <>
          <MonthCalendar overview={overview} />
          {overview.currencies.length === 0 && (
            <p data-testid="upcoming-quiet" className="mt-8 max-w-xl border-y border-zinc-200 py-6 text-sm leading-6 text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
              No expected charges between {shortDate(reference)} and the end of {monthLabel}.
            </p>
          )}
          {overview.currencies.map((section) => (
            <CurrencySection key={section.currency} section={section} monthLabel={monthLabel} />
          ))}
          {overview.stale.length > 0 && (
            <section data-testid="upcoming-stale" aria-labelledby="upcoming-stale-heading" className="mt-10">
              <h2 id="upcoming-stale-heading" className="text-lg font-medium tracking-tight">
                Gone quiet
              </h2>
              <p className="mt-1 max-w-xl text-sm leading-6 text-zinc-500 dark:text-zinc-400">
                These recurring items have missed two or more expected dates, so they no longer
                project — and they are left out of the totals above. If one was canceled,{" "}
                <Link href="/recurring" className="underline underline-offset-4">dismiss it under Recurring</Link>.
              </p>
              <ul className="mt-2 divide-y divide-zinc-200 dark:divide-zinc-800">
                {overview.stale.map((stream) => (
                  <li key={`${stream.accountId}:${stream.currency}:${stream.direction}:${stream.normalizedName}`} data-testid="upcoming-stale-stream" className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 py-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium">{stream.name}</p>
                      <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
                        {CADENCE_LABEL[stream.cadence]} · nothing since {shortDate(stream.lastDate)}
                      </p>
                    </div>
                    <p className="font-mono text-sm tabular-nums text-zinc-500 dark:text-zinc-400">
                      {signed(stream.amountMinor, stream.currency)}
                    </p>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </>
  );
}
