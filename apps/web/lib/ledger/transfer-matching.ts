export const TRANSFER_WINDOW_DAYS = 4;

export type MatchableRow = {
  id: string;
  accountId: string;
  amountMinor: number;
  currency: string;
  date: string;
  status: "pending" | "posted";
};

export type TransferPairCandidate = { outflowId: string; inflowId: string };

export const comboKey = (outflowId: string, inflowId: string) => `${outflowId}:${inflowId}`;

const dayNumber = (date: string) => Date.parse(`${date}T00:00:00Z`) / 86_400_000;

// The whole rule, in one place: the matcher builds edges from it and the engine
// re-checks live pairs against it, so a re-synced half can never drift out of
// the rule and stay paired.
export function pairDistance(
  outflow: MatchableRow | undefined,
  inflow: MatchableRow | undefined,
): number | null {
  if (!outflow || !inflow) return null;
  if (outflow.status !== "posted" || inflow.status !== "posted") return null;
  if (outflow.amountMinor >= 0 || inflow.amountMinor !== -outflow.amountMinor) return null;
  if (outflow.currency !== inflow.currency) return null;
  if (outflow.accountId === inflow.accountId) return null;
  const distance = Math.abs(dayNumber(inflow.date) - dayNumber(outflow.date));
  return distance <= TRANSFER_WINDOW_DAYS ? distance : null;
}

type Edge = TransferPairCandidate & { dateDistance: number; outflowDate: string };

export function matchTransferPairs(
  rows: readonly MatchableRow[],
  excludedCombos: ReadonlySet<string> = new Set(),
): TransferPairCandidate[] {
  const byMagnitude = new Map<string, { outs: MatchableRow[]; ins: MatchableRow[] }>();
  for (const row of rows) {
    if (row.status !== "posted" || row.amountMinor === 0) continue;
    const key = `${row.currency}:${Math.abs(row.amountMinor)}`;
    const group = byMagnitude.get(key) ?? { outs: [], ins: [] };
    (row.amountMinor < 0 ? group.outs : group.ins).push(row);
    byMagnitude.set(key, group);
  }

  const edges: Edge[] = [];
  for (const { outs, ins } of byMagnitude.values()) {
    for (const outflow of outs) {
      for (const inflow of ins) {
        const dateDistance = pairDistance(outflow, inflow);
        if (dateDistance === null) continue;
        if (excludedCombos.has(comboKey(outflow.id, inflow.id))) continue;
        edges.push({
          outflowId: outflow.id,
          inflowId: inflow.id,
          dateDistance,
          outflowDate: outflow.date,
        });
      }
    }
  }
  edges.sort(
    (a, b) =>
      a.dateDistance - b.dateDistance ||
      a.outflowDate.localeCompare(b.outflowDate) ||
      a.outflowId.localeCompare(b.outflowId) ||
      a.inflowId.localeCompare(b.inflowId),
  );

  const used = new Set<string>();
  const pairs: TransferPairCandidate[] = [];
  for (const edge of edges) {
    if (used.has(edge.outflowId) || used.has(edge.inflowId)) continue;
    used.add(edge.outflowId);
    used.add(edge.inflowId);
    pairs.push({ outflowId: edge.outflowId, inflowId: edge.inflowId });
  }
  return pairs;
}
