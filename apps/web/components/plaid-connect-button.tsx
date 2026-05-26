"use client";

import { Loader2, Link2 } from "lucide-react";

import { usePlaidLinkContext } from "@/components/plaid-link-provider";

export function PlaidConnectButton() {
  const { connect, environment, errorMessage, mode, pending, ready } = usePlaidLinkContext();
  const sandboxMode = mode === "live" && environment === "sandbox";

  return (
    <div className="grid gap-2">
      <button
        type="button"
        onClick={connect}
        disabled={pending}
        data-testid="plaid-connect-button"
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
      {sandboxMode ? (
        <div className="rounded-[20px] border border-[var(--border)] bg-[var(--accent-soft)]/70 px-3 py-3 text-xs leading-5 text-[var(--foreground)]">
          <p className="font-semibold">Plaid sandbox test guide</p>
          <p className="mt-1">
            Cash Lens now prefills Plaid&apos;s seeded sandbox phone number. If Link asks again, use{" "}
            <span className="font-semibold">415-555-0010</span>.
          </p>
          <p className="mt-1">
            Verification code: <span className="font-semibold">123456</span>
          </p>
          <p className="mt-1">
            Test institution: <span className="font-semibold">First Platypus Bank</span>
          </p>
          <p className="mt-1">
            Username: <span className="font-semibold">user_good</span> and password:{" "}
            <span className="font-semibold">pass_good</span>
          </p>
          <p className="mt-1 text-[var(--muted)]">
            Real phone numbers are rejected by Plaid in sandbox returning-user flows.
          </p>
        </div>
      ) : null}
      {errorMessage ? <p className="text-xs text-[var(--warning)]">{errorMessage}</p> : null}
    </div>
  );
}
