"use client";

import { Loader2, RefreshCcw } from "lucide-react";
import { startTransition, useState } from "react";
import { useRouter } from "next/navigation";

type ManualSyncButtonProps = {
  plaidItemId: number;
};

export function ManualSyncButton({ plaidItemId }: ManualSyncButtonProps) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function handleClick() {
    setPending(true);
    try {
      await fetch(`/api/proxy/plaid/sync-item/${plaidItemId}`, { method: "POST" });
      startTransition(() => router.refresh());
    } finally {
      setPending(false);
    }
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={pending}
      data-testid="manual-sync-button"
      className="inline-flex items-center gap-2 rounded-full border border-[var(--border)] bg-white px-4 py-2 text-sm font-semibold text-[var(--foreground)] transition hover:border-[var(--accent)] hover:text-[var(--accent-strong)] disabled:cursor-not-allowed disabled:opacity-60"
    >
      {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCcw className="h-4 w-4" />}
      {pending ? "Syncing" : "Manual sync"}
    </button>
  );
}
