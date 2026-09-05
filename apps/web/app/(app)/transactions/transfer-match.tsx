"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// One idempotent pass per visit: pairs anything new, dissolves anything stale.
// Dismissed combinations are remembered server-side, so re-firing never undoes
// an unlink; a failure just waits for the next visit or sync.
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
