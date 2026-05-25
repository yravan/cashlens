"use client";

import { Loader2, Link2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { usePlaidLink } from "react-plaid-link";
import { startTransition, useState } from "react";

type PlaidConnectButtonProps = {
  mode: "demo" | "live";
  linkToken: string;
};

export function PlaidConnectButton({ mode, linkToken }: PlaidConnectButtonProps) {
  if (mode === "demo") {
    return <DemoPlaidConnectButton />;
  }

  return <LivePlaidConnectButton linkToken={linkToken} />;
}

function DemoPlaidConnectButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function exchangePublicToken() {
    setPending(true);
    try {
      await fetch("/api/proxy/plaid/exchange-public-token", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          public_token: `demo-public-token-${Date.now()}`,
          institution_name: "Demo Sandbox Bank",
        }),
      });
      startTransition(() => router.refresh());
    } finally {
      setPending(false);
    }
  }

  return (
    <button
      type="button"
      onClick={() => void exchangePublicToken()}
      disabled={pending}
      className="inline-flex items-center gap-2 rounded-full bg-[var(--accent-strong)] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-60"
    >
      {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />}
      {pending ? "Connecting" : "Add demo institution"}
    </button>
  );
}

function LivePlaidConnectButton({ linkToken }: { linkToken: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function exchangePublicToken(publicToken: string) {
    setPending(true);
    try {
      await fetch("/api/proxy/plaid/exchange-public-token", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ public_token: publicToken }),
      });
      startTransition(() => router.refresh());
    } finally {
      setPending(false);
    }
  }

  const { open, ready } = usePlaidLink({
    token: linkToken,
    onSuccess: (publicToken: string) => {
      void exchangePublicToken(publicToken);
    },
  });

  return (
    <button
      type="button"
      onClick={() => open()}
      disabled={pending || !ready}
      className="inline-flex items-center gap-2 rounded-full bg-[var(--accent-strong)] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-60"
    >
      {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />}
      {pending ? "Connecting" : "Connect with Plaid"}
    </button>
  );
}
