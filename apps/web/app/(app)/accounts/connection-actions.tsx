"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { usePlaidLink, type PlaidLinkOnExit, type PlaidLinkOnSuccess } from "react-plaid-link";

import { pollSync } from "./sync-poll";

export type ActionableConnection = {
  id: string;
  name: string;
  status: "active" | "disconnected";
  repairable: boolean;
  accounts: number;
  transactions: number;
};

const dangerButton =
  "rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-red-500 disabled:opacity-50";
const quietButton =
  "rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium transition-colors hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800";

export function ConnectionActions({ connection }: { connection: ActionableConnection }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [purge, setPurge] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [repairToken, setRepairToken] = useState<string | null>(null);

  const finishRepair = useCallback<PlaidLinkOnSuccess>(async () => {
    setRepairToken(null);
    setNotice("Reconnected. Catching up…");
    try {
      await fetch(`/api/connections/${connection.id}/repaired`, { method: "POST" });
      await pollSync(connection.id, { idleMs: 1500 });
      setNotice(null);
    } catch {
      setNotice("Reconnected. Imports will catch up shortly.");
    }
    setBusy(false);
    router.refresh();
  }, [connection.id, router]);

  const abandonRepair = useCallback<PlaidLinkOnExit>((error) => {
    setRepairToken(null);
    setBusy(false);
    setNotice(error ? "Reconnecting was interrupted — try again." : null);
  }, []);

  const { open, ready } = usePlaidLink({
    token: repairToken,
    onSuccess: finishRepair,
    onExit: abandonRepair,
  });
  useEffect(() => {
    if (repairToken && ready) open();
  }, [repairToken, ready, open]);

  const startRepair = async () => {
    setBusy(true);
    setNotice("Opening the bank's sign-in…");
    try {
      const response = await fetch(`/api/connections/${connection.id}/repair-token`, {
        method: "POST",
      });
      if (response.status === 410) {
        setNotice("The bank revoked this connection — connect it again from scratch.");
        setBusy(false);
        router.refresh();
        return;
      }
      if (!response.ok) throw new Error();
      setNotice(null);
      setRepairToken((await response.json()).linkToken);
    } catch {
      setNotice("Could not start reconnecting. Try again.");
      setBusy(false);
    }
  };

  const disconnect = async () => {
    setBusy(true);
    setNotice(purge ? "Disconnecting and deleting data…" : "Disconnecting…");
    try {
      const response = await fetch(`/api/connections/${connection.id}/disconnect`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ purge }),
      });
      if (!response.ok) throw new Error();
      setNotice(null);
      setConfirming(false);
      setBusy(false);
      router.refresh();
    } catch {
      setNotice("Couldn't revoke access at Plaid — nothing was changed. Try again.");
      setBusy(false);
    }
  };

  const alreadyGone = connection.status === "disconnected";
  const consequence = `${connection.accounts} account${connection.accounts === 1 ? "" : "s"} and ${connection.transactions} imported transaction${connection.transactions === 1 ? "" : "s"}`;

  return (
    <div className="mt-3">
      {!confirming && (
        <div className="flex gap-2">
          {connection.repairable && (
            <button
              type="button"
              data-testid="repair-connection"
              onClick={startRepair}
              disabled={busy}
              className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
            >
              Reconnect
            </button>
          )}
          <button
            type="button"
            data-testid={alreadyGone ? "purge-connection" : "disconnect-connection"}
            onClick={() => {
              setPurge(alreadyGone);
              setNotice(null);
              setConfirming(true);
            }}
            disabled={busy}
            className={quietButton}
          >
            {alreadyGone ? "Delete imported data" : "Disconnect"}
          </button>
        </div>
      )}
      {confirming && (
        <div
          data-testid="disconnect-confirm"
          className="rounded-md border border-red-200 bg-red-50 p-3 dark:border-red-900 dark:bg-red-950"
        >
          <p className="text-sm">
            {alreadyGone
              ? `Permanently delete ${connection.name}'s ${consequence}? This cannot be undone.`
              : `Disconnect ${connection.name}? Imports stop and Cash Lens's access at the bank is revoked.`}
          </p>
          {!alreadyGone && (
            <label className="mt-2 flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                data-testid="purge-checkbox"
                checked={purge}
                onChange={(event) => setPurge(event.target.checked)}
                className="mt-0.5"
              />
              <span>
                Also permanently delete its {consequence}. Unchecked, the data stays in the ledger.
              </span>
            </label>
          )}
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              data-testid="confirm-disconnect"
              onClick={disconnect}
              disabled={busy}
              className={dangerButton}
            >
              {alreadyGone ? "Delete data" : purge ? "Disconnect and delete" : "Disconnect"}
            </button>
            <button type="button" onClick={() => setConfirming(false)} disabled={busy} className={quietButton}>
              Cancel
            </button>
          </div>
        </div>
      )}
      {notice && (
        <p data-testid="connection-notice" className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
          {notice}
        </p>
      )}
    </div>
  );
}
