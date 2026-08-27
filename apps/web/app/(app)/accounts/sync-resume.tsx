"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

import { pollSync } from "./sync-poll";

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
        try {
          await pollSync(connectionId, {
            idleMs: 1000,
            stopped: () => cancelled,
            onStep: (step) => {
              progressed ||= step.added + step.modified + step.removed > 0;
            },
          });
        } catch {
          // one unreachable connection must not stall the others
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
