export const MIN_OCCURRENCES = 3;

export type RecurringCadence = "weekly" | "biweekly" | "monthly" | "annual";
export type RecurringDirection = "inflow" | "outflow";
export type RecurringConfidence = "high" | "medium";

export type RecurringRow = {
  id: string;
  accountId: string;
  amountMinor: number;
  currency: string;
  date: string;
  description: string;
  merchant: string | null;
  status: "pending" | "posted";
};

export type RecurringStream = {
  accountId: string;
  currency: string;
  direction: RecurringDirection;
  normalizedName: string;
  name: string;
  cadence: RecurringCadence;
  typicalAmountMinor: number;
  lastAmountMinor: number;
  firstDate: string;
  lastDate: string;
  occurrences: number;
  confidence: RecurringConfidence;
};

// A gap in the base window is one cadence step; a gap in the doubled window is
// one missed occurrence (two jittered steps merged). Windows and their doubles
// stay pairwise disjoint, so a gap never reads two ways for the same cadence.
const CADENCE_WINDOWS: { cadence: RecurringCadence; lo: number; hi: number }[] = [
  { cadence: "weekly", lo: 5, hi: 9 },
  { cadence: "biweekly", lo: 11, hi: 17 },
  { cadence: "monthly", lo: 26, hi: 35 },
  { cadence: "annual", lo: 330, hi: 400 },
];

// Amount bands around the median, as exact rationals (numerator/denominator —
// integer math, so the boundary is exact): within 1/4 keeps an occurrence in
// the stream (variable bills drift); within 3/40 (7.5%, Actual Budget's approx
// threshold) counts as amount-stable.
const ACCEPT = { num: 1, den: 4 };
const STABLE = { num: 3, den: 40 };

const withinBand = (amount: number, typical: number, band: { num: number; den: number }) =>
  band.den * Math.abs(amount - typical) <= band.num * Math.abs(typical);

const median = (sorted: readonly number[]): number => {
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]
    : Math.trunc((sorted[mid - 1] + sorted[mid]) / 2);
};

const dayNumber = (date: string) => Date.parse(`${date}T00:00:00Z`) / 86_400_000;

// Grouping survives the descriptor noise that varies per charge: a trailing
// *-reference containing digits ("AMZN MKTP US*RT4KZ8"), then any trailing
// digit-bearing tokens ("#204", "866-579-7172"). Digit-only names ("7-ELEVEN")
// keep their tokens rather than normalize to nothing.
export function normalizeRecurringName(raw: string): string {
  const upper = raw
    .toUpperCase()
    .replace(/\*[^\s*]*\d[^\s*]*$/, "")
    .replace(/[^A-Z0-9&.'\- ]+/g, " ");
  const tokens = upper.split(/\s+/).filter(Boolean);
  let end = tokens.length;
  while (end > 0 && /\d/.test(tokens[end - 1])) end -= 1;
  return (end > 0 ? tokens.slice(0, end) : tokens).join(" ");
}

export function nextExpectedDate(lastDate: string, cadence: RecurringCadence): string {
  const [year, month, day] = lastDate.split("-").map(Number);
  if (cadence === "weekly" || cadence === "biweekly") {
    const next = new Date(Date.UTC(year, month - 1, day + (cadence === "weekly" ? 7 : 14)));
    return next.toISOString().slice(0, 10);
  }
  const nextYear = cadence === "annual" ? year + 1 : year + (month === 12 ? 1 : 0);
  const nextMonth = cadence === "annual" ? month : (month % 12) + 1;
  const monthLength = new Date(Date.UTC(nextYear, nextMonth, 0)).getUTCDate();
  const clamped = Math.min(day, monthLength);
  return `${nextYear}-${String(nextMonth).padStart(2, "0")}-${String(clamped).padStart(2, "0")}`;
}

type Occurrence = { date: string; amountMinor: number };

function classifyCadence(
  dates: readonly string[],
): { cadence: RecurringCadence; skips: number } | null {
  const gaps: number[] = [];
  for (let i = 1; i < dates.length; i += 1) {
    gaps.push(dayNumber(dates[i]) - dayNumber(dates[i - 1]));
  }
  let best: { cadence: RecurringCadence; skips: number; base: number } | null = null;
  for (const { cadence, lo, hi } of CADENCE_WINDOWS) {
    const base = gaps.filter((gap) => gap >= lo && gap <= hi).length;
    const skips = gaps.filter((gap) => gap >= 2 * lo && gap <= 2 * hi).length;
    if (base + skips !== gaps.length || base < skips || base === 0) continue;
    if (best === null || base > best.base) best = { cadence, skips, base };
  }
  return best && { cadence: best.cadence, skips: best.skips };
}

type GroupIdentity = {
  accountId: string;
  currency: string;
  direction: RecurringDirection;
  normalizedName: string;
};

function toStream(group: GroupIdentity, members: readonly RecurringRow[]): RecurringStream | null {
  const byDate = new Map<string, number>();
  for (const row of members) {
    byDate.set(row.date, (byDate.get(row.date) ?? 0) + row.amountMinor);
  }
  let occurrences: Occurrence[] = [...byDate]
    .map(([date, amountMinor]) => ({ date, amountMinor }))
    .sort((a, b) => a.date.localeCompare(b.date));
  if (occurrences.length < MIN_OCCURRENCES) return null;

  const amountsOf = (list: Occurrence[]) =>
    list.map((occurrence) => occurrence.amountMinor).sort((a, b) => a - b);
  let typical = median(amountsOf(occurrences));
  const kept = occurrences.filter((occurrence) =>
    withinBand(occurrence.amountMinor, typical, ACCEPT),
  );
  const dropped = occurrences.length - kept.length;
  if (dropped > 0) {
    if (kept.length < MIN_OCCURRENCES) return null;
    typical = median(amountsOf(kept));
    if (!kept.every((occurrence) => withinBand(occurrence.amountMinor, typical, ACCEPT))) {
      return null;
    }
    occurrences = kept;
  }

  const classified = classifyCadence(occurrences.map((occurrence) => occurrence.date));
  if (classified === null) return null;

  const amountStable = occurrences.every((occurrence) =>
    withinBand(occurrence.amountMinor, typical, STABLE),
  );

  const merchantCounts = new Map<string, number>();
  for (const row of members) {
    const merchant = row.merchant?.trim();
    if (merchant) merchantCounts.set(merchant, (merchantCounts.get(merchant) ?? 0) + 1);
  }
  let name = group.normalizedName;
  let nameCount = 0;
  for (const [merchant, seen] of merchantCounts) {
    if (seen > nameCount || (seen === nameCount && merchant < name)) {
      name = merchant;
      nameCount = seen;
    }
  }

  return {
    ...group,
    name,
    cadence: classified.cadence,
    typicalAmountMinor: typical,
    lastAmountMinor: occurrences[occurrences.length - 1].amountMinor,
    firstDate: occurrences[0].date,
    lastDate: occurrences[occurrences.length - 1].date,
    occurrences: occurrences.length,
    confidence: classified.skips === 0 && dropped === 0 && amountStable ? "high" : "medium",
  };
}

export function detectRecurringStreams(
  rows: readonly RecurringRow[],
  excludedIds: ReadonlySet<string> = new Set(),
): RecurringStream[] {
  const groups = new Map<string, GroupIdentity & { members: RecurringRow[] }>();
  for (const row of rows) {
    if (row.status !== "posted" || row.amountMinor === 0 || excludedIds.has(row.id)) continue;
    const normalizedName = normalizeRecurringName(row.merchant?.trim() || row.description);
    if (normalizedName === "") continue;
    const direction: RecurringDirection = row.amountMinor > 0 ? "inflow" : "outflow";
    const key = [row.accountId, row.currency, direction, normalizedName].join(":");
    const group = groups.get(key) ?? {
      accountId: row.accountId,
      currency: row.currency,
      direction,
      normalizedName,
      members: [],
    };
    group.members.push(row);
    groups.set(key, group);
  }

  const streams: RecurringStream[] = [];
  for (const { members, ...group } of groups.values()) {
    const stream = toStream(group, members);
    if (stream) streams.push(stream);
  }
  return streams.sort(
    (a, b) =>
      b.lastDate.localeCompare(a.lastDate) ||
      a.normalizedName.localeCompare(b.normalizedName) ||
      a.accountId.localeCompare(b.accountId) ||
      a.currency.localeCompare(b.currency) ||
      a.direction.localeCompare(b.direction),
  );
}
