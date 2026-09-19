"use client";

import { useRef, useState } from "react";
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
  const [error, setError] = useState<string | null>(null);
  const [lastDecision, setLastDecision] = useState<RecurringDecision | null>(null);
  const submittingRef = useRef(false);

  const decide = async (status: RecurringDecision) => {
    if (submittingRef.current) return;
    submittingRef.current = true;
    setBusy(true);
    setError(null);
    setLastDecision(status);
    try {
      const { accountId, currency, direction, normalizedName } = stream;
      const response = await fetch("/api/recurring/streams", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ accountId, currency, direction, normalizedName, status }),
      });
      if (response.ok || response.status === 404) {
        router.refresh();
      } else {
        setError("Couldn’t save that change. Try again.");
      }
    } catch {
      setError("The change may have succeeded. Try again.");
    } finally {
      submittingRef.current = false;
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
      {error && (
        <div className="basis-full flex flex-wrap items-baseline gap-3">
          <p role="alert" className="text-red-600 dark:text-red-400">
            {error}
          </p>
          <button
            type="button"
            onClick={() => lastDecision && decide(lastDecision)}
            disabled={busy || lastDecision === null}
            className="font-medium underline underline-offset-2 disabled:opacity-50"
          >
            Retry
          </button>
        </div>
      )}
    </div>
  );
}
