import {
  STABLE,
  withinBand,
  type RecurringCadence,
  type RecurringStream,
} from "./recurring-detection";

export type StreamStatus = "proposed" | "confirmed" | "dismissed" | "canceled";

export const tracked = (status: StreamStatus) => status === "proposed" || status === "confirmed";

export const CYCLES_PER_YEAR: Record<RecurringCadence, number> = {
  weekly: 52,
  biweekly: 26,
  monthly: 12,
  annual: 1,
};

export const annualAmountMinor = (stream: Pick<RecurringStream, "cadence" | "typicalAmountMinor">) =>
  stream.typicalAmountMinor * CYCLES_PER_YEAR[stream.cadence];

export type AnnualTotal = { currency: string; outMinor: number; inMinor: number };

export function annualTotals(
  streams: readonly (Pick<RecurringStream, "currency" | "direction" | "cadence" | "typicalAmountMinor"> & {
    status: StreamStatus;
  })[],
): AnnualTotal[] {
  const byCurrency = new Map<string, AnnualTotal>();
  for (const stream of streams) {
    if (!tracked(stream.status)) continue;
    const total = byCurrency.get(stream.currency) ?? {
      currency: stream.currency,
      outMinor: 0,
      inMinor: 0,
    };
    byCurrency.set(stream.currency, total);
    if (stream.direction === "outflow") total.outMinor += annualAmountMinor(stream);
    else total.inMinor += annualAmountMinor(stream);
  }
  return [...byCurrency.values()].sort((a, b) => a.currency.localeCompare(b.currency));
}

export const priceIncreased = (
  stream: Pick<RecurringStream, "direction" | "typicalAmountMinor" | "lastAmountMinor">,
) =>
  stream.direction === "outflow" &&
  stream.lastAmountMinor < stream.typicalAmountMinor &&
  !withinBand(stream.lastAmountMinor, stream.typicalAmountMinor, STABLE);

export const chargedAfterCancel = (stream: {
  status: StreamStatus;
  decidedOn: string | null;
  lastDate: string;
}) => stream.status === "canceled" && stream.decidedOn !== null && stream.lastDate > stream.decidedOn;
