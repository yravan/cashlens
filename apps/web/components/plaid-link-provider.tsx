"use client";

import { createContext, startTransition, useContext, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { usePlaidLink } from "react-plaid-link";

import type { LinkTokenResponse } from "@/lib/types";

type PlaidLinkProviderProps = {
  initialMode: "demo" | "live";
  initialLinkToken: string;
  children: React.ReactNode;
};

type PlaidLinkContextValue = {
  mode: "demo" | "live";
  pending: boolean;
  ready: boolean;
  errorMessage: string | null;
  connect: () => void;
};

const PlaidLinkContext = createContext<PlaidLinkContextValue | null>(null);

export function PlaidLinkProvider({
  initialMode,
  initialLinkToken,
  children,
}: PlaidLinkProviderProps) {
  const router = useRouter();
  const [mode, setMode] = useState<"demo" | "live">(initialMode);
  const [linkToken, setLinkToken] = useState(initialLinkToken);
  const [pending, setPending] = useState(false);
  const [launchRequested, setLaunchRequested] = useState(false);
  const [ready, setReady] = useState(initialMode === "demo");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const liveOpenRef = useRef<(() => void) | null>(null);

  async function requestFreshLinkToken() {
    const response = await fetch("/api/proxy/plaid/create-link-token", {
      method: "POST",
      headers: { "content-type": "application/json" },
    });

    if (!response.ok) {
      throw new Error(`Failed to create Plaid link token (${response.status})`);
    }

    const payload = (await response.json()) as LinkTokenResponse;
    setMode(payload.mode);
    setLinkToken(payload.link_token);
    setReady(payload.mode === "demo");
  }

  async function exchangePublicToken(publicToken: string) {
    setPending(true);
    setErrorMessage(null);
    try {
      const response = await fetch("/api/proxy/plaid/exchange-public-token", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ public_token: publicToken }),
      });

      if (!response.ok) {
        throw new Error(`Failed to exchange Plaid token (${response.status})`);
      }

      await requestFreshLinkToken();
      startTransition(() => router.refresh());
    } catch (error) {
      console.error(error);
      setErrorMessage("Plaid connected, but Cash Lens could not finish the handoff.");
    } finally {
      setPending(false);
    }
  }

  async function connectDemoInstitution() {
    setPending(true);
    setErrorMessage(null);
    try {
      const response = await fetch("/api/proxy/plaid/exchange-public-token", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          public_token: `demo-public-token-${Date.now()}`,
          institution_name: "Demo Sandbox Bank",
        }),
      });

      if (!response.ok) {
        throw new Error(`Failed to add demo institution (${response.status})`);
      }

      startTransition(() => router.refresh());
    } catch (error) {
      console.error(error);
      setErrorMessage("Cash Lens could not add the demo institution.");
    } finally {
      setPending(false);
    }
  }

  async function prepareLiveLaunch() {
    setPending(true);
    setLaunchRequested(true);
    setErrorMessage(null);

    try {
      await requestFreshLinkToken();
    } catch (error) {
      console.error(error);
      setLaunchRequested(false);
      setErrorMessage("Plaid could not initialize. Refresh and try again.");
    } finally {
      setPending(false);
    }
  }

  function connect() {
    if (pending) {
      return;
    }

    if (mode === "demo") {
      void connectDemoInstitution();
      return;
    }

    if (ready && liveOpenRef.current) {
      setErrorMessage(null);
      liveOpenRef.current();
      return;
    }

    void prepareLiveLaunch();
  }

  return (
    <PlaidLinkContext.Provider
      value={{
        mode,
        pending,
        ready: mode === "demo" ? !pending : ready,
        errorMessage,
        connect,
      }}
    >
      {mode === "live" ? (
        <LivePlaidLinkController
          launchRequested={launchRequested}
          onLaunchHandled={() => {
            setLaunchRequested(false);
          }}
          token={linkToken}
          onReadyChange={setReady}
          onRegisterOpen={(open) => {
            liveOpenRef.current = open;
          }}
          onSuccess={exchangePublicToken}
        />
      ) : null}
      {children}
    </PlaidLinkContext.Provider>
  );
}

export function usePlaidLinkContext() {
  const value = useContext(PlaidLinkContext);
  if (!value) {
    throw new Error("usePlaidLinkContext must be used within PlaidLinkProvider.");
  }
  return value;
}

type LivePlaidLinkControllerProps = {
  launchRequested: boolean;
  onLaunchHandled: () => void;
  token: string;
  onReadyChange: (ready: boolean) => void;
  onRegisterOpen: (open: (() => void) | null) => void;
  onSuccess: (publicToken: string) => void;
};

function LivePlaidLinkController({
  launchRequested,
  onLaunchHandled,
  token,
  onReadyChange,
  onRegisterOpen,
  onSuccess,
}: LivePlaidLinkControllerProps) {
  const { open, ready } = usePlaidLink({
    token,
    onSuccess: (publicToken: string) => {
      void onSuccess(publicToken);
    },
  });

  useEffect(() => {
    onReadyChange(ready);
  }, [onReadyChange, ready]);

  useEffect(() => {
    onRegisterOpen(() => open);
    return () => {
      onRegisterOpen(null);
    };
  }, [onRegisterOpen, open]);

  useEffect(() => {
    if (!launchRequested || !ready) {
      return;
    }

    open();
    onLaunchHandled();
  }, [launchRequested, onLaunchHandled, open, ready]);

  return null;
}
