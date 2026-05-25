"use client";

import { CheckCheck, Loader2 } from "lucide-react";
import { startTransition, useState } from "react";
import { useRouter } from "next/navigation";

export function MarkAllReadButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function handleClick() {
    setPending(true);
    try {
      await fetch("/api/proxy/notifications/read-all", { method: "PATCH" });
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
      className="inline-flex items-center gap-2 rounded-full border border-[var(--border)] bg-white px-4 py-2 text-sm font-semibold text-[var(--foreground)] transition hover:border-[var(--accent)] hover:text-[var(--accent-strong)] disabled:cursor-not-allowed disabled:opacity-60"
    >
      {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCheck className="h-4 w-4" />}
      {pending ? "Saving" : "Mark all read"}
    </button>
  );
}
