import { isIsoDate } from "./history-query";
import {
  nextExpectedDate,
  type RecurringCadence,
  type RecurringDirection,
  type RecurringStream,
} from "./recurring-detection";
import { tracked, type StreamStatus } from "./subscriptions";

export type UpcomingInput = RecurringStream & { status: StreamStatus };

export type UpcomingObligationInput = {
  obligationId: string;
  accountId: string;
  currency: string;
  name: string;
  amountMinor: number;
  cadence: RecurringCadence | "once";
  startsOn: string;
  endsOn: string | null;
  endedAt: Date | null;
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

export type UpcomingDetectedOccurrence = UpcomingStream & {
  source: "detected";
  date: string;
  overdue: boolean;
  possibleOverlap: boolean;
};

export type UpcomingObligationOccurrence = {
  source: "obligation";
  obligationId: string;
  accountId: string;
  currency: string;
  direction: "outflow";
  name: string;
  cadence: UpcomingObligationInput["cadence"];
  amountMinor: number;
  date: string;
  overdue: boolean;
  possibleOverlap: boolean;
};

export type UpcomingOccurrence = UpcomingDetectedOccurrence | UpcomingObligationOccurrence;

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

export type ParsedUpcomingQuery = { ok: true; query: { on: string | null } } | { ok: false };

export function parseUpcomingQuery(
  params: Record<string, string | string[] | undefined>,
): ParsedUpcomingQuery {
  let on: string | null = null;
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue;
    if (key !== "on" || Array.isArray(value)) return { ok: false };
    if (value === "") continue;
    if (!isIsoDate(value)) return { ok: false };
    on = value;
  }
  return { ok: true, query: { on } };
}

export function monthEndOf(date: string): string {
  const [year, month] = date.split("-").map(Number);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${date.slice(0, 7)}-${String(lastDay).padStart(2, "0")}`;
}

function monthlyDate(startsOn: string, year: number, month: number): string {
  const anchor = Number(startsOn.slice(8, 10));
  const day = Math.min(anchor, new Date(Date.UTC(year, month + 1, 0)).getUTCDate());
  return `${String(year).padStart(4, "0")}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function annualDate(startsOn: string, year: number): string {
  const month = Number(startsOn.slice(5, 7));
  const anchor = Number(startsOn.slice(8, 10));
  const day = Math.min(anchor, new Date(Date.UTC(year, month, 0)).getUTCDate());
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

const DAY_MS = 86_400_000;
const dayNumber = (date: string) => Date.parse(`${date}T00:00:00Z`) / DAY_MS;
const dateFromDayNumber = (day: number) => new Date(day * DAY_MS).toISOString().slice(0, 10);

// A stream projects while at most one expected date has been missed — the
// detector's own missed-occurrence tolerance. Two misses by the reference date
// mean the pattern stopped: stale, out of the list and the totals.
export function projectUpcoming(
  streams: readonly UpcomingInput[],
  reference: string,
  obligations: readonly UpcomingObligationInput[] = [],
): UpcomingProjection {
  const monthEnd = monthEndOf(reference);
  const stale: UpcomingStream[] = [];
  const listed: UpcomingOccurrence[] = [];
  for (const stream of streams) {
    if (!tracked(stream.status)) continue;
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
    const anchorDay =
      stream.cadence === "monthly" || stream.cadence === "annual"
        ? Number(stream.lastDate.slice(8, 10))
        : undefined;
    const advance = (date: string) => nextExpectedDate(date, stream.cadence, anchorDay);
    const first = advance(stream.lastDate);
    let next = first;
    if (first < reference) {
      next = advance(first);
      if (next < reference) {
        stale.push(base);
        continue;
      }
      listed.push({
        ...base,
        source: "detected",
        date: first,
        overdue: true,
        possibleOverlap: false,
      });
    }
    for (; next <= monthEnd; next = advance(next)) {
      listed.push({
        ...base,
        source: "detected",
        date: next,
        overdue: false,
        possibleOverlap: false,
      });
    }
  }
  for (const obligation of obligations) {
    if (obligation.endedAt !== null || obligation.startsOn > monthEnd) continue;

    const occurrence = (date: string, overdue: boolean) => ({
      source: "obligation" as const,
      obligationId: obligation.obligationId,
      accountId: obligation.accountId,
      currency: obligation.currency,
      direction: "outflow" as const,
      name: obligation.name,
      cadence: obligation.cadence,
      amountMinor: -obligation.amountMinor,
      date,
      overdue,
      possibleOverlap: false,
    });
    if (obligation.cadence === "monthly") {
      const referenceYear = Number(reference.slice(0, 4));
      const referenceMonth = Number(reference.slice(5, 7)) - 1;
      const startMonth =
        Number(obligation.startsOn.slice(0, 4)) * 12 +
        Number(obligation.startsOn.slice(5, 7)) -
        1;
      const referenceMonthIndex = referenceYear * 12 + referenceMonth;
      if (referenceMonthIndex < startMonth) continue;

      const current = monthlyDate(obligation.startsOn, referenceYear, referenceMonth);
      const referencePrevious = dateFromDayNumber(dayNumber(reference) - 1);
      const passedLimit =
        obligation.endsOn !== null && obligation.endsOn < referencePrevious
          ? obligation.endsOn
          : referencePrevious;
      const limitYear = Number(passedLimit.slice(0, 4));
      const limitMonth = Number(passedLimit.slice(5, 7)) - 1;
      let passed = monthlyDate(obligation.startsOn, limitYear, limitMonth);
      if (passed > passedLimit) {
        passed = monthlyDate(
          obligation.startsOn,
          limitMonth === 0 ? limitYear - 1 : limitYear,
          limitMonth === 0 ? 11 : limitMonth - 1,
        );
      }
      if (passed >= obligation.startsOn) {
        listed.push(occurrence(passed, true));
      }
      if (
        current >= reference &&
        current >= obligation.startsOn &&
        (obligation.endsOn === null || current <= obligation.endsOn)
      ) {
        listed.push(occurrence(current, false));
      }
      continue;
    }
    if (obligation.cadence === "annual") {
      const referenceYear = Number(reference.slice(0, 4));
      const current = annualDate(obligation.startsOn, referenceYear);
      const referencePrevious = dateFromDayNumber(dayNumber(reference) - 1);
      const passedLimit =
        obligation.endsOn !== null && obligation.endsOn < referencePrevious
          ? obligation.endsOn
          : referencePrevious;
      const limitYear = Number(passedLimit.slice(0, 4));
      let passed = annualDate(obligation.startsOn, limitYear);
      if (passed > passedLimit) passed = annualDate(obligation.startsOn, limitYear - 1);
      if (passed >= obligation.startsOn) {
        listed.push(occurrence(passed, true));
      }
      if (
        current >= reference &&
        current >= obligation.startsOn &&
        current <= monthEnd &&
        (obligation.endsOn === null || current <= obligation.endsOn)
      ) {
        listed.push(occurrence(current, false));
      }
      continue;
    }
    if (obligation.cadence === "weekly" || obligation.cadence === "biweekly") {
      const interval = obligation.cadence === "weekly" ? 7 : 14;
      const startDay = dayNumber(obligation.startsOn);
      const referenceDay = dayNumber(reference);
      const endDay = obligation.endsOn === null ? Number.POSITIVE_INFINITY : dayNumber(obligation.endsOn);
      const visibleEndDay = Math.min(dayNumber(monthEnd), endDay);
      const step = Math.max(0, Math.floor((referenceDay - startDay) / interval));
      const atOrAfterReference =
        startDay + step * interval < referenceDay
          ? startDay + (step + 1) * interval
          : startDay + step * interval;
      const passedStep = Math.floor((Math.min(referenceDay - 1, endDay) - startDay) / interval);
      if (passedStep >= 0) {
        listed.push(occurrence(dateFromDayNumber(startDay + passedStep * interval), true));
      }
      for (let day = atOrAfterReference; day <= visibleEndDay; day += interval) {
        listed.push(occurrence(dateFromDayNumber(day), false));
      }
      continue;
    }
    listed.push(occurrence(obligation.startsOn, obligation.startsOn < reference));
  }

  const overlapKey = (occurrence: UpcomingOccurrence) =>
    JSON.stringify([
      occurrence.accountId,
      occurrence.currency,
      occurrence.date,
      Math.abs(occurrence.amountMinor),
    ]);
  const detectedOverlapKeys = new Set(
    listed.filter((occurrence) => occurrence.source === "detected").map(overlapKey),
  );
  const obligationOverlapKeys = new Set(
    listed.filter((occurrence) => occurrence.source === "obligation").map(overlapKey),
  );
  for (const occurrence of listed) {
    occurrence.possibleOverlap =
      (occurrence.source === "detected" ? obligationOverlapKeys : detectedOverlapKeys).has(
        overlapKey(occurrence),
      );
  }

  const compareSourceIdentity = (a: UpcomingOccurrence, b: UpcomingOccurrence) => {
    if (a.source === "detected" && b.source === "detected") {
      return (
        a.normalizedName.localeCompare(b.normalizedName) || a.cadence.localeCompare(b.cadence)
      );
    }
    if (a.source === "obligation" && b.source === "obligation") {
      return a.obligationId.localeCompare(b.obligationId);
    }
    return 0;
  };
  listed.sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      a.name.localeCompare(b.name) ||
      a.accountId.localeCompare(b.accountId) ||
      a.source.localeCompare(b.source) ||
      compareSourceIdentity(a, b),
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
