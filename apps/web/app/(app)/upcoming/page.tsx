import type { Metadata } from "next";
import Link from "next/link";

import { upcomingOverview, type UpcomingOverview } from "@/lib/data/recurring";
import { formatMinorUnits } from "@/lib/ledger/minor-units";
import { parseUpcomingQuery, type UpcomingOccurrence } from "@/lib/ledger/upcoming";
import { TransferMatch } from "../transactions/transfer-match";
import {
  AddObligation,
  EditObligation,
  EndObligation,
} from "./obligation-controls";

export const metadata: Metadata = { title: "Upcoming" };

const CADENCE_LABEL = {
  once: "One time",
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
const OVERLAP_WARNING = "Possible overlap — both are counted until matching is available.";
const occurrenceKey = (occurrence: UpcomingOccurrence) =>
  occurrence.source === "obligation"
    ? `${occurrence.obligationId}:${occurrence.date}`
    : `${occurrence.accountId}:${occurrence.currency}:${occurrence.direction}:${occurrence.normalizedName}:${occurrence.date}`;

function SourceBadge({ source }: { source: UpcomingOccurrence["source"] }) {
  return (
    <span className="inline-flex shrink-0 rounded-full border border-zinc-300 px-1.5 py-0.5 text-[0.68rem] font-semibold leading-none text-zinc-600 dark:border-zinc-700 dark:text-zinc-300">
      {source === "obligation" ? "Known" : "Predicted"}
    </span>
  );
}

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
                      <div
                        key={occurrenceKey(occurrence)}
                        data-testid="upcoming-calendar-occurrence"
                        className="mt-1 border-l-2 border-zinc-300 pl-1 dark:border-zinc-700"
                      >
                        <p className="truncate">
                          <span className="font-medium">
                            {occurrence.overdue ? "! " : ""}
                            {occurrence.name}
                          </span>{" "}
                          <span className="text-zinc-500 tabular-nums dark:text-zinc-400">
                            {signed(occurrence.amountMinor, occurrence.currency)}
                          </span>
                        </p>
                        <p className="mt-0.5">
                          <SourceBadge source={occurrence.source} />
                        </p>
                        {occurrence.possibleOverlap && (
                          <p className="mt-0.5 text-[0.65rem] leading-3 text-amber-700 dark:text-amber-300">
                            {OVERLAP_WARNING}
                          </p>
                        )}
                        {occurrence.overdue && (
                          <span className="sr-only">
                            {occurrence.source === "obligation"
                              ? " — Scheduled date passed"
                              : " — expected but not seen yet"}
                          </span>
                        )}
                      </div>
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
        <div className="flex items-center gap-2">
          {occurrence.source === "obligation" ? (
            <span className="text-sm font-medium">{occurrence.name}</span>
          ) : (
            <Link href={`/transactions?${query.toString()}`} className="text-sm font-medium underline-offset-4 hover:underline">
              {occurrence.name}
            </Link>
          )}
          <SourceBadge source={occurrence.source} />
        </div>
        <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
          {CADENCE_LABEL[occurrence.cadence]} · expected {shortDate(occurrence.date)}
          {occurrence.overdue && (
            <span className="font-medium text-red-700 dark:text-red-400">
              {occurrence.source === "obligation"
                ? " — Scheduled date passed"
                : " — not seen yet"}
            </span>
          )}
          {occurrence.source === "detected" && <> · last on {shortDate(occurrence.lastDate)}</>}
        </p>
        {occurrence.possibleOverlap && (
          <p className="mt-1 text-xs font-medium text-amber-700 dark:text-amber-300">
            {OVERLAP_WARNING}
          </p>
        )}
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
              <OccurrenceRow key={occurrenceKey(charge)} occurrence={charge} kind="charge" />
            ))}
          </ul>
        )}
        {section.deposits.length > 0 && (
          <>
            <h3 className="mt-4 text-sm font-medium">Expected to arrive</h3>
            <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
              {section.deposits.map((deposit) => (
                <OccurrenceRow key={occurrenceKey(deposit)} occurrence={deposit} kind="deposit" />
              ))}
            </ul>
          </>
        )}
      </div>
    </section>
  );
}

function KnownObligations({ overview }: { overview: UpcomingOverview }) {
  return (
    <section
      data-testid="known-obligations"
      aria-labelledby="known-obligations-heading"
      className="mt-12 border-t border-zinc-300 pt-6 dark:border-zinc-700"
    >
      <h2 id="known-obligations-heading" tabIndex={-1} className="text-lg font-medium tracking-tight">
        Known obligations
      </h2>
      <p className="mt-1 max-w-xl text-sm leading-6 text-zinc-500 dark:text-zinc-400">
        Bills and other outflows you have told Cash Lens to include in Upcoming.
      </p>
      {overview.accounts.length === 0 ? (
        <p className="mt-4 max-w-xl text-sm leading-6 text-zinc-500 dark:text-zinc-400">
          An account is required to add a known obligation.{" "}
          <Link href="/accounts" className="underline underline-offset-4">
            Go to Accounts
          </Link>
          .
        </p>
      ) : (
        <>
          {overview.obligations.length === 0 && (
            <p className="mt-4 max-w-xl text-sm leading-6 text-zinc-500 dark:text-zinc-400">
              Add rent, insurance, tuition, or another known charge.
            </p>
          )}
          <AddObligation accounts={overview.accounts} />
        </>
      )}
      {overview.obligations.length > 0 && (
        <ul className="mt-3 divide-y divide-zinc-200 border-y border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
          {overview.obligations.map((obligation) => (
            <li key={obligation.id} data-testid="obligation-card" className="py-4">
              <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium">{obligation.name}</p>
                  <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
                    {obligation.accountName} · {CADENCE_LABEL[obligation.cadence]} · starts {shortDate(obligation.startsOn)}
                    {obligation.endsOn && <> · ends {shortDate(obligation.endsOn)}</>}
                  </p>
                  <p className="mt-1 text-xs font-medium text-zinc-700 dark:text-zinc-300">
                    {obligation.nextOn
                      ? `Next ${shortDate(obligation.nextOn)}`
                      : "No future dates remain"}
                  </p>
                </div>
                <p className="font-mono text-sm font-medium tabular-nums">
                  {formatMinorUnits(obligation.amountMinor, obligation.currency)}
                </p>
              </div>
              <div className="flex flex-wrap items-start gap-3">
                <EditObligation accounts={overview.accounts} obligation={obligation} />
                <EndObligation obligation={obligation} />
              </div>
            </li>
          ))}
        </ul>
      )}
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
        Known charges and predicted recurring patterns appear here before they post. The amounts
        count in this Upcoming forecast, not your ledger totals. <Link href="/recurring" className="underline underline-offset-4">Manage recurring</Link>.
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
      {overview.trackedCount === 0 && overview.currencies.length === 0 ? (
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
                <Link href="/recurring" className="underline underline-offset-4">mark it canceled under Recurring</Link>.
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
      <KnownObligations overview={overview} />
    </>
  );
}
