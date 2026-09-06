"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function TransferUnlink({ pairId, label }: { pairId: string; label: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const unlink = async () => {
    setBusy(true);
    try {
      const response = await fetch(`/api/transfers/${pairId}/unlink`, { method: "POST" });
      if (response.ok || response.status === 404) router.refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      onClick={unlink}
      disabled={busy}
      aria-label={`Not a transfer: ${label}`}
      className="underline underline-offset-2 disabled:opacity-50"
    >
      Not a transfer
    </button>
  );
}
