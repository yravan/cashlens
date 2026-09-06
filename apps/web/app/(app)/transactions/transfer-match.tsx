"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// Dismissed combinations are remembered server-side, so re-firing this pass —
// from a second tab, a refresh, a sync — can never undo an unlink.
export function TransferMatch() {
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const response = await fetch("/api/transfers/match", { method: "POST" });
      if (cancelled || !response.ok) return;
      const step: { paired: number; dissolved: number } = await response.json();
      if (step.paired > 0 || step.dissolved > 0) router.refresh();
    })().catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [router]);

  return null;
}
