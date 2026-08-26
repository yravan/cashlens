export type SyncStep = {
  backfillStatus: string;
  drained: boolean;
  added: number;
  modified: number;
  removed: number;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const retryAfterMs = (response: Response) => {
  const seconds = Number(response.headers.get("retry-after"));
  return (Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds, 60) : 5) * 1000;
};

type Poll = { idleMs: number; onStep?: (step: SyncStep) => void; stopped?: () => boolean };

// Drives one connection from its stored cursor until a run comes back drained
// and complete; false means the attempt budget or `stopped` ran out first. A
// non-429 failure throws — each caller decides whether that is worth showing.
export async function pollSync(connectionId: string, { idleMs, onStep, stopped }: Poll) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (stopped?.()) return false;
    const response = await fetch(`/api/connections/${connectionId}/sync`, { method: "POST" });
    if (response.status === 429) {
      await sleep(retryAfterMs(response));
      continue;
    }
    if (!response.ok) throw new Error("sync request failed");
    const step: SyncStep = await response.json();
    onStep?.(step);
    if (step.drained && step.backfillStatus === "complete") return true;
    await sleep(idleMs);
  }
  return false;
}
