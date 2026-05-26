"use client";

import { Loader2, Link2 } from "lucide-react";

import { usePlaidLinkContext } from "@/components/plaid-link-provider";

export function PlaidConnectButton() {
  const { connect, errorMessage, mode, pending, ready } = usePlaidLinkContext();

  return (
    <div className="grid gap-2">
      <button
        type="button"
        onClick={connect}
        disabled={pending}
        className="inline-flex items-center gap-2 rounded-full bg-[var(--accent-strong)] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />}
        {pending
          ? mode === "live"
            ? "Preparing Plaid"
            : "Connecting"
          : mode === "demo"
            ? "Add demo institution"
            : ready
              ? "Connect with Plaid"
              : "Launch Plaid"}
      </button>
      {errorMessage ? <p className="text-xs text-[var(--warning)]">{errorMessage}</p> : null}
    </div>
  );
}
