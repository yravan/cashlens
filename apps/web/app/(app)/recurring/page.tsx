import type { Metadata } from "next";

import { recurringOverview, type RecurringOverviewStream } from "@/lib/data/recurring";
import { formatMinorUnits } from "@/lib/ledger/minor-units";
import {
  annualAmountMinor,
  chargedAfterCancel,
  priceIncreased,
  type AnnualTotal,
} from "@/lib/ledger/subscriptions";
import { TransferMatch } from "../transactions/transfer-match";
import { StreamActions } from "./stream-actions";

export const metadata: Metadata = { title: "Recurring" };

const CADENCE_LABEL = {
  weekly: "Weekly",
  biweekly: "Every 2 weeks",
  monthly: "Monthly",
  annual: "Yearly",
} as const;

const CONFIDENCE_LABEL = {
  high: "on schedule every time",
  medium: "some variation",
} as const;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const shortDate = (iso: string) =>
  `${MONTHS[Number(iso.slice(5, 7)) - 1]} ${Number(iso.slice(8, 10))}, ${iso.slice(0, 4)}`;

const signed = (minor: number, currency: string) =>
  `${minor > 0 ? "+" : ""}${formatMinorUnits(minor, currency)}`;

function StreamRow({ stream }: { stream: RecurringOverviewStream }) {
  const canceledOn = chargedAfterCancel(stream) ? stream.decidedOn : null;
  return (
    <li
      data-testid="recurring-stream"
      className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2 py-4"
    >
      <div className="min-w-0">
        <p className="text-sm font-medium">{stream.name}</p>
        <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
          {CADENCE_LABEL[stream.cadence]} · last on {shortDate(stream.lastDate)} ·{" "}
          {stream.occurrences} occurrences, {CONFIDENCE_LABEL[stream.confidence]}
        </p>
        {priceIncreased(stream) && (
          <p data-testid="price-increase" className="mt-1 text-xs font-medium text-amber-700 dark:text-amber-400">
            Price up · last {signed(stream.lastAmountMinor, stream.currency)}, usually{" "}
            {signed(stream.typicalAmountMinor, stream.currency)}
          </p>
        )}
        {canceledOn && (
          <p data-testid="charged-after-cancel" className="mt-1 text-xs font-medium text-amber-700 dark:text-amber-400">
            Charged {shortDate(stream.lastDate)}, after you marked it canceled on {shortDate(canceledOn)}
          </p>
        )}
      </div>
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <p data-testid="stream-amount" className="font-mono text-sm font-medium tabular-nums">
          {signed(stream.typicalAmountMinor, stream.currency)}
        </p>
        <p data-testid="stream-annual" className="font-mono text-xs tabular-nums text-zinc-500 dark:text-zinc-400">
          {signed(annualAmountMinor(stream), stream.currency)}/yr
        </p>
        <StreamActions stream={stream} chargedAfter={canceledOn !== null} />
      </div>
    </li>
  );
}

function AnnualSummary({ annual }: { annual: AnnualTotal[] }) {
  if (annual.length === 0) return null;
  return (
    <section
      aria-labelledby="annual"
      data-testid="recurring-annual"
      className="mt-6 border-y border-zinc-200 py-4 dark:border-zinc-800"
    >
      <h2 id="annual" className="text-sm font-medium">
        Per year
      </h2>
      <ul className="mt-2 space-y-1">
        {annual.map((total) => (
          <li
            key={total.currency}
            data-testid={`annual-${total.currency}`}
            className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-sm"
          >
            <span className="text-zinc-500 dark:text-zinc-400">{total.currency}</span>
            <span>
              <span data-testid="annual-out" className="font-mono font-medium tabular-nums">
                {signed(total.outMinor, total.currency)}
              </span>{" "}
              in charges
            </span>
            <span>
              <span data-testid="annual-in" className="font-mono font-medium tabular-nums">
                {signed(total.inMinor, total.currency)}
              </span>{" "}
              in deposits
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-2 max-w-xl text-xs leading-5 text-zinc-500 dark:text-zinc-400">
        Counts streams to review and confirmed. Canceled and dismissed are left out.
      </p>
    </section>
  );
}

function StreamSection({
  id,
  heading,
  note,
  streams,
}: {
  id: string;
  heading: string;
  note?: string;
  streams: RecurringOverviewStream[];
}) {
  if (streams.length === 0) return null;
  return (
    <section aria-labelledby={id} data-testid={`recurring-${id}`} className="mt-8">
      <h2 id={id} className="text-lg font-medium tracking-tight">
        {heading}
      </h2>
      {note && <p className="mt-1 max-w-xl text-sm leading-6 text-zinc-500 dark:text-zinc-400">{note}</p>}
      <ul className="mt-2 divide-y divide-zinc-200 dark:divide-zinc-800">
        {streams.map((stream) => (
          <StreamRow
            key={`${stream.accountId}:${stream.currency}:${stream.direction}:${stream.normalizedName}`}
            stream={stream}
          />
        ))}
      </ul>
    </section>
  );
}

export default async function RecurringPage() {
  const { streams, annual } = await recurringOverview();
  const by = (status: RecurringOverviewStream["status"]) =>
    streams.filter((stream) => stream.status === status);

  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Recurring</h1>
      <TransferMatch />
      <p className="mt-2 max-w-xl text-sm leading-6 text-zinc-500 dark:text-zinc-400">
        Charges and deposits that repeat on a steady cadence — subscriptions, bills, paychecks —
        detected from your posted history. Internal transfers never count.
      </p>
      {streams.length === 0 ? (
        <p data-testid="recurring-empty" className="mt-8 max-w-xl border-y border-zinc-200 py-6 text-sm leading-6 text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
          Nothing recurring detected yet. A charge appears here once it repeats three times on a
          weekly, biweekly, monthly, or yearly rhythm.
        </p>
      ) : (
        <>
          <AnnualSummary annual={annual} />
          <StreamSection
            id="proposed"
            heading="To review"
            note="Detected from your history. Confirm the real ones; dismiss anything that only looks recurring."
            streams={by("proposed")}
          />
          <StreamSection id="confirmed" heading="Confirmed" streams={by("confirmed")} />
          <StreamSection
            id="canceled"
            heading="Canceled"
            note="Marked canceled. Left out of Upcoming and the yearly total; a charge dated after the cancel day is flagged here."
            streams={by("canceled")}
          />
          <StreamSection
            id="dismissed"
            heading="Dismissed"
            note="Kept out of your recurring list. Mark one recurring if that was a mistake."
            streams={by("dismissed")}
          />
        </>
      )}
    </>
  );
}
