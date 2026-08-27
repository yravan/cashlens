"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  usePlaidLink,
  type PlaidLinkOnExit,
  type PlaidLinkOnSuccess,
} from "react-plaid-link";

import { pollSync } from "./sync-poll";

type Status = { kind: "idle" | "busy" | "done" | "error"; text?: string };

function exchangeFailureText(body: { error?: string; message?: string | null } | null): string {
  if (body?.error === "already_connected") return "That institution is already connected.";
  if (body?.message) return body.message;
  return "Connecting failed — nothing was saved. Try again.";
}

async function importHistory(connectionId: string, connected: string, setStatus: (status: Status) => void) {
  let imported = 0;
  const importing = () =>
    setStatus({ kind: "busy", text: `${connected}. Importing transaction history… (${imported} so far)` });
  try {
    importing();
    const finished = await pollSync(connectionId, {
      idleMs: 1500,
      onStep: (step) => {
        imported += step.added;
        importing();
      },
    });
    setStatus({
      kind: "done",
      text: finished
        ? `${connected}, ${imported} transactions imported.`
        : `${connected}. History is still importing — check back shortly.`,
    });
  } catch {
    setStatus({ kind: "error", text: `${connected}, but the history import was interrupted. It will resume next time you open Accounts.` });
  }
}

type PendingDuplicate = { publicToken: string; institution: string };

export function ConnectButton({ activeInstitutionIds = [] }: { activeInstitutionIds?: string[] }) {
  const router = useRouter();
  const [linkToken, setLinkToken] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [duplicate, setDuplicate] = useState<PendingDuplicate | null>(null);

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

  const exchange = useCallback(
    async (publicToken: string) => {
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

  // Link already created the item at the bank, so backing out must burn it
  // server-side — dropping the token would leave an orphan item at Plaid.
  const cancelDuplicate = async () => {
    const abandoned = duplicate;
    setDuplicate(null);
    setStatus({ kind: "idle" });
    if (abandoned) {
      await fetch("/api/plaid/abandon", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ publicToken: abandoned.publicToken }),
      }).catch(() => {});
    }
  };

  const onSuccess = useCallback<PlaidLinkOnSuccess>(
    async (publicToken, metadata) => {
      setLinkToken(null);
      if (!publicToken) {
        setStatus({ kind: "error", text: "Connection was interrupted. Try again." });
        return;
      }
      const institution = metadata.institution;
      if (institution?.institution_id && activeInstitutionIds.includes(institution.institution_id)) {
        setStatus({ kind: "idle" });
        setDuplicate({ publicToken, institution: institution.name ?? "This institution" });
        return;
      }
      await exchange(publicToken);
    },
    [exchange, activeInstitutionIds],
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
      {duplicate && (
        <div
          data-testid="duplicate-warning"
          className="mt-3 max-w-md rounded-md border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-700 dark:bg-amber-950"
        >
          <p>
            {duplicate.institution} is already connected. Connect it again anyway? The same
            accounts would import twice.
          </p>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              data-testid="duplicate-continue"
              onClick={() => {
                const confirmed = duplicate;
                setDuplicate(null);
                if (confirmed) void exchange(confirmed.publicToken);
              }}
              className="rounded-md bg-zinc-900 px-3 py-1.5 font-medium text-white transition-colors hover:bg-zinc-700 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
            >
              Connect anyway
            </button>
            <button
              type="button"
              data-testid="duplicate-cancel"
              onClick={cancelDuplicate}
              className="rounded-md border border-zinc-300 px-3 py-1.5 font-medium transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
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
