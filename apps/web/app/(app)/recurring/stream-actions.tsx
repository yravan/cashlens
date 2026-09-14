"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import type {
  RecurringDecision,
  RecurringOverviewStream,
  RecurringStatus,
} from "@/lib/data/recurring";

type Action = { label: string; status: RecurringDecision; muted?: true; afterCancelOnly?: true };

const ACTIONS: Record<RecurringStatus, Action[]> = {
  proposed: [
    { label: "Confirm", status: "confirmed" },
    { label: "Mark canceled", status: "canceled", muted: true },
    { label: "Not recurring", status: "dismissed", muted: true },
  ],
  confirmed: [
    { label: "Mark canceled", status: "canceled", muted: true },
    { label: "Not recurring", status: "dismissed", muted: true },
  ],
  canceled: [
    { label: "It's back", status: "confirmed" },
    { label: "Still canceled", status: "canceled", muted: true, afterCancelOnly: true },
    { label: "Not recurring", status: "dismissed", muted: true },
  ],
  dismissed: [{ label: "Mark recurring", status: "confirmed" }],
};

export function StreamActions({
  stream,
  chargedAfter,
}: {
  stream: RecurringOverviewStream;
  chargedAfter: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const decide = async (status: RecurringDecision) => {
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
    <div className="flex flex-wrap items-baseline gap-3 text-sm">
      {ACTIONS[stream.status]
        .filter((action) => chargedAfter || !action.afterCancelOnly)
        .map((action) => (
          <button
            key={action.label}
            type="button"
            onClick={() => decide(action.status)}
            disabled={busy}
            aria-label={`${action.label}: ${stream.name}`}
            className={
              action.muted
                ? "text-zinc-500 underline underline-offset-2 disabled:opacity-50 dark:text-zinc-400"
                : "font-medium underline underline-offset-2 disabled:opacity-50"
            }
          >
            {action.label}
          </button>
        ))}
    </div>
  );
}
