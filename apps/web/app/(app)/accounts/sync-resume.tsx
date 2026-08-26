"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function retryAfterMs(response: Response): number {
  const seconds = Number(response.headers.get("retry-after"));
  return (Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds, 60) : 5) * 1000;
}

// Silent self-heal: drives stalled or stale connections forward from their
// stored cursor whenever the accounts page is opened. Overlap with any other
// trigger is safe — the engine's cursor compare-and-set lets one run win.
export function SyncResume({ connectionIds }: { connectionIds: string[] }) {
  const router = useRouter();
  const key = connectionIds.join(",");

  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    (async () => {
      let progressed = false;
      for (const connectionId of key.split(",")) {
        for (let attempt = 0; attempt < 40 && !cancelled; attempt += 1) {
          let step;
          try {
            const response = await fetch(`/api/connections/${connectionId}/sync`, {
              method: "POST",
            });
            if (response.status === 429) {
              await sleep(retryAfterMs(response));
              continue;
            }
            if (!response.ok) break;
            step = await response.json();
          } catch {
            break;
          }
          progressed ||= step.added + step.modified + step.removed > 0;
          if (step.drained && step.backfillStatus === "complete") break;
          await sleep(1000);
        }
      }
      if (progressed && !cancelled) router.refresh();
    })();
    return () => {
      cancelled = true;
    };
  }, [key, router]);

  return null;
}
