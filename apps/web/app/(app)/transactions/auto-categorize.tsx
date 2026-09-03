"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

const MAX_ATTEMPTS = 12;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const retryAfterMs = (response: Response) => {
  const seconds = Number(response.headers.get("retry-after"));
  return (Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds, 60) : 5) * 1000;
};

// The engine writes only NULL category_id rows, so re-firing this loop — from a
// second tab, a refresh, or a fast back-and-forth — can never clobber user work.
export function AutoCategorize() {
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      for (let attempt = 0; attempt < MAX_ATTEMPTS && !cancelled; attempt += 1) {
        const response = await fetch("/api/transactions/categorize", { method: "POST" });
        if (cancelled) return;
        if (response.status === 429) {
          await sleep(retryAfterMs(response));
          continue;
        }
        if (!response.ok) return;
        const step: { categorized: number; remaining: number } = await response.json();
        if (step.categorized > 0 && !cancelled) router.refresh();
        if (step.remaining === 0 || step.categorized === 0) return;
      }
    })().catch(() => {
      // an unreachable provider must not break the page; the backlog waits
    });
    return () => {
      cancelled = true;
    };
  }, [router]);

  return null;
}
