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
        if (inflow.accountId === outflow.accountId) continue;
        if (excludedCombos.has(comboKey(outflow.id, inflow.id))) continue;
        const dateDistance = Math.abs(dayNumber(inflow.date) - dayNumber(outflow.date));
        if (dateDistance > TRANSFER_WINDOW_DAYS) continue;
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
