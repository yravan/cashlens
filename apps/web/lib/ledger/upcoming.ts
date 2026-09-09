import { isRealDate } from "./history-query";
import {
  nextExpectedDate,
  type RecurringCadence,
  type RecurringDirection,
  type RecurringStream,
} from "./recurring-detection";

export type UpcomingInput = RecurringStream & {
  status: "proposed" | "confirmed" | "dismissed";
};

export type UpcomingStream = {
  accountId: string;
  currency: string;
  direction: RecurringDirection;
  normalizedName: string;
  name: string;
  cadence: RecurringCadence;
  amountMinor: number;
  lastDate: string;
};

export type UpcomingOccurrence = UpcomingStream & { date: string; overdue: boolean };

export type UpcomingCurrency = {
  currency: string;
  toLeaveMinor: number;
  toArriveMinor: number;
  charges: UpcomingOccurrence[];
  deposits: UpcomingOccurrence[];
};

export type UpcomingProjection = {
  monthEnd: string;
  currencies: UpcomingCurrency[];
  stale: UpcomingStream[];
};

export const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export type ParsedUpcomingQuery = { ok: true; query: { on: string | null } } | { ok: false };

export function parseUpcomingQuery(
  params: Record<string, string | string[] | undefined>,
): ParsedUpcomingQuery {
  let on: string | null = null;
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue;
    if (key !== "on" || Array.isArray(value)) return { ok: false };
    if (value === "") continue;
    if (!ISO_DATE.test(value) || !isRealDate(value)) return { ok: false };
    on = value;
  }
  return { ok: true, query: { on } };
}

export function monthEndOf(date: string): string {
  const [year, month] = date.split("-").map(Number);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${date.slice(0, 7)}-${String(lastDay).padStart(2, "0")}`;
}

// A stream projects while at most one expected date has been missed — the
// detector's own missed-occurrence tolerance. Two misses by the reference date
// mean the pattern stopped: stale, out of the list and the totals.
export function projectUpcoming(
  streams: readonly UpcomingInput[],
  reference: string,
): UpcomingProjection {
  const monthEnd = monthEndOf(reference);
  const stale: UpcomingStream[] = [];
  const listed: UpcomingOccurrence[] = [];
  for (const stream of streams) {
    if (stream.status === "dismissed") continue;
    const base: UpcomingStream = {
      accountId: stream.accountId,
      currency: stream.currency,
      direction: stream.direction,
      normalizedName: stream.normalizedName,
      name: stream.name,
      cadence: stream.cadence,
      amountMinor: stream.typicalAmountMinor,
      lastDate: stream.lastDate,
    };
    const first = nextExpectedDate(stream.lastDate, stream.cadence);
    let next = first;
    if (first < reference) {
      next = nextExpectedDate(first, stream.cadence);
      if (next < reference) {
        stale.push(base);
        continue;
      }
      listed.push({ ...base, date: first, overdue: true });
    }
    for (; next <= monthEnd; next = nextExpectedDate(next, stream.cadence)) {
      listed.push({ ...base, date: next, overdue: false });
    }
  }

  listed.sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      a.name.localeCompare(b.name) ||
      a.accountId.localeCompare(b.accountId) ||
      a.normalizedName.localeCompare(b.normalizedName),
  );
  const byCurrency = new Map<string, UpcomingCurrency>();
  for (const occurrence of listed) {
    const section = byCurrency.get(occurrence.currency) ?? {
      currency: occurrence.currency,
      toLeaveMinor: 0,
      toArriveMinor: 0,
      charges: [],
      deposits: [],
    };
    byCurrency.set(occurrence.currency, section);
    if (occurrence.direction === "outflow") {
      section.toLeaveMinor += occurrence.amountMinor;
      section.charges.push(occurrence);
    } else {
      section.toArriveMinor += occurrence.amountMinor;
      section.deposits.push(occurrence);
    }
  }

  return {
    monthEnd,
    currencies: [...byCurrency.values()].sort((a, b) => a.currency.localeCompare(b.currency)),
    stale: stale.sort(
      (a, b) =>
        b.lastDate.localeCompare(a.lastDate) ||
        a.name.localeCompare(b.name) ||
        a.accountId.localeCompare(b.accountId),
    ),
  };
}
