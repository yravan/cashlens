"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  usePlaidLink,
  type PlaidLinkOnExit,
  type PlaidLinkOnSuccess,
} from "react-plaid-link";

type Status = { kind: "idle" | "busy" | "done" | "error"; text?: string };

function exchangeFailureText(body: { error?: string; message?: string | null } | null): string {
  if (body?.error === "already_connected") return "That institution is already connected.";
  if (body?.message) return body.message;
  return "Connecting failed — nothing was saved. Try again.";
}

async function importHistory(connectionId: string, connected: string, setStatus: (status: Status) => void) {
  let imported = 0;
  try {
    for (let attempt = 0; attempt < 40; attempt += 1) {
      setStatus({ kind: "busy", text: `${connected}. Importing transaction history… (${imported} so far)` });
      const response = await fetch(`/api/connections/${connectionId}/sync`, { method: "POST" });
      if (!response.ok) throw new Error();
      const step = await response.json();
      imported += step.added;
      if (step.backfillStatus === "complete") {
        setStatus({ kind: "done", text: `${connected}, ${imported} transactions imported.` });
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }
    setStatus({ kind: "done", text: `${connected}. History is still importing — check back shortly.` });
  } catch {
    setStatus({ kind: "error", text: `${connected}, but the history import was interrupted. It will resume on the next sync.` });
  }
}

export function ConnectButton() {
  const router = useRouter();
  const [linkToken, setLinkToken] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  const start = async () => {
    setStatus({ kind: "busy", text: "Opening Plaid Link…" });
    try {
      const response = await fetch("/api/plaid/link-token", { method: "POST" });
      if (!response.ok) throw new Error();
      setLinkToken((await response.json()).linkToken);
    } catch {
      setStatus({ kind: "error", text: "Could not start Plaid Link. Try again." });
    }
  };

  const onSuccess = useCallback<PlaidLinkOnSuccess>(
    async (publicToken) => {
      setLinkToken(null);
      setStatus({ kind: "busy", text: "Registering accounts…" });
      try {
        const response = await fetch("/api/plaid/exchange", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ publicToken }),
        });
        const body = await response.json().catch(() => null);
        if (!response.ok) {
          setStatus({ kind: "error", text: exchangeFailureText(body) });
          return;
        }
        const n = body.accounts.length;
        const institution = body.connection.institutionName ?? "your institution";
        const connected = `Connected ${institution} — ${n} account${n === 1 ? "" : "s"} registered`;
        router.refresh();
        await importHistory(body.connection.id, connected, setStatus);
        router.refresh();
      } catch {
        setStatus({ kind: "error", text: exchangeFailureText(null) });
      }
    },
    [router],
  );

  const onExit = useCallback<PlaidLinkOnExit>((error) => {
    setLinkToken(null);
    setStatus(
      error
        ? { kind: "error", text: error.display_message ?? "Connection was interrupted. Try again." }
        : { kind: "idle" },
    );
  }, []);

  const { open, ready } = usePlaidLink({ token: linkToken, onSuccess, onExit });

  useEffect(() => {
    if (linkToken && ready) open();
  }, [linkToken, ready, open]);

  return (
    <div className="mt-6">
      <button
        type="button"
        data-testid="connect-bank"
        onClick={start}
        disabled={status.kind === "busy"}
        className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
      >
        Connect a bank or card
      </button>
      {status.text && (
        <p
          data-testid="connect-status"
          className={`mt-3 text-sm ${status.kind === "error" ? "text-red-600 dark:text-red-400" : "text-zinc-500 dark:text-zinc-400"}`}
        >
          {status.text}
        </p>
      )}
    </div>
  );
}
