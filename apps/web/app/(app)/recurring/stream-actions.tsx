"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import type { RecurringOverviewStream } from "@/lib/data/recurring";

export function StreamActions({ stream }: { stream: RecurringOverviewStream }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const decide = async (status: "confirmed" | "dismissed") => {
    setBusy(true);
    try {
      const { accountId, currency, direction, normalizedName } = stream;
      const response = await fetch("/api/recurring/streams", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ accountId, currency, direction, normalizedName, status }),
      });
      if (response.ok || response.status === 404) router.refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex items-baseline gap-3 text-sm">
      {stream.status !== "confirmed" && (
        <button
          type="button"
          onClick={() => decide("confirmed")}
          disabled={busy}
          aria-label={`${stream.status === "dismissed" ? "Mark recurring" : "Confirm"}: ${stream.name}`}
          className="font-medium underline underline-offset-2 disabled:opacity-50"
        >
          {stream.status === "dismissed" ? "Mark recurring" : "Confirm"}
        </button>
      )}
      {stream.status !== "dismissed" && (
        <button
          type="button"
          onClick={() => decide("dismissed")}
          disabled={busy}
          aria-label={`Not recurring: ${stream.name}`}
          className="text-zinc-500 underline underline-offset-2 disabled:opacity-50 dark:text-zinc-400"
        >
          Not recurring
        </button>
      )}
    </div>
  );
}
