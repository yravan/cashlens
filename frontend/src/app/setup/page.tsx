"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Building2,
  Mail,
  CheckCircle,
  Loader2,
  ArrowRight,
  SkipForward,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useApiClient } from "@/lib/api";

type OnboardingStatus = {
  has_bank_connection: boolean;
  has_gmail: boolean;
  accounts_count: number;
  transactions_count: number;
  setup_complete: boolean;
};

export default function SetupPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { apiFetch } = useApiClient();

  const [currentStep, setCurrentStep] = useState(1);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [status, setStatus] = useState<OnboardingStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const tellerScriptLoaded = useRef(false);

  // Fetch onboarding status on mount
  const fetchStatus = useCallback(async () => {
    try {
      const data = await apiFetch("/api/onboarding/status");
      setStatus(data);
      return data;
    } catch {
      // If API fails, assume fresh start
      return null;
    } finally {
      setLoading(false);
    }
  }, [apiFetch]);

  useEffect(() => {
    fetchStatus().then((data) => {
      if (!data) return;

      // Resume at correct step based on status
      if (data.has_bank_connection && data.has_gmail) {
        setCurrentStep(3);
      } else if (data.has_bank_connection) {
        // Check if gmail was just connected
        if (searchParams.get("gmail") === "connected") {
          setCurrentStep(3);
        } else {
          setCurrentStep(2);
        }
      } else {
        setCurrentStep(1);
      }
    });
  }, [fetchStatus, searchParams]);

  // Handle gmail=connected query param
  useEffect(() => {
    if (searchParams.get("gmail") === "connected") {
      fetchStatus().then((data) => {
        if (data?.has_bank_connection) {
          setCurrentStep(3);
        }
      });
    }
  }, [searchParams, fetchStatus]);

  // Load Teller Connect script dynamically
  useEffect(() => {
    if (tellerScriptLoaded.current) return;
    const script = document.createElement("script");
    script.src = "https://cdn.teller.io/connect/connect.js";
    script.async = true;
    script.onload = () => {
      tellerScriptLoaded.current = true;
    };
    document.head.appendChild(script);
  }, []);

  const handleTellerConnect = useCallback(() => {
    const TellerConnect = (window as unknown as Record<string, unknown>)
      .TellerConnect as {
      setup: (config: Record<string, unknown>) => { open: () => void };
    } | undefined;

    if (!TellerConnect) {
      setError("Teller Connect is still loading. Please try again.");
      return;
    }

    const appId = process.env.NEXT_PUBLIC_TELLER_APP_ID;
    const environment = process.env.NEXT_PUBLIC_TELLER_ENV || "sandbox";

    if (!appId) {
      setError("Teller App ID is not configured.");
      return;
    }

    setError(null);
    setConnecting(true);

    const tellerConnect = TellerConnect.setup({
      applicationId: appId,
      environment: environment,
      onSuccess: async (enrollment: { accessToken: string; institution: { name: string } }) => {
        try {
          await apiFetch(
            `/api/ingestion/connect/teller?access_token=${encodeURIComponent(enrollment.accessToken)}&institution_name=${encodeURIComponent(enrollment.institution?.name || "")}`,
            { method: "POST" }
          );
          await fetchStatus();
          setCurrentStep(2);
        } catch (err) {
          setError(
            err instanceof Error ? err.message : "Failed to save bank connection"
          );
        } finally {
          setConnecting(false);
        }
      },
      onExit: () => {
        setConnecting(false);
      },
      onFailure: (failure: { message: string }) => {
        setError(failure.message || "Teller connection failed");
        setConnecting(false);
      },
    });

    tellerConnect.open();
  }, [apiFetch, fetchStatus]);

  const handleGmailConnect = useCallback(async () => {
    setConnecting(true);
    setError(null);
    try {
      const data = await apiFetch("/api/auth/gmail");
      // Redirect the user to the Google OAuth consent screen
      window.location.href = data.authorization_url;
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to start Gmail connection"
      );
      setConnecting(false);
    }
  }, [apiFetch]);

  const handleSkipGmail = useCallback(() => {
    setCurrentStep(3);
  }, []);

  const handleGoToDashboard = useCallback(() => {
    router.push("/dashboard");
  }, [router]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="size-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const steps = [
    { label: "Bank", icon: Building2 },
    { label: "Gmail", icon: Mail },
    { label: "Done", icon: CheckCircle },
  ];

  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-4 py-12">
      <div className="mb-8 text-center">
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
          Set up CashLens
        </h1>
        <p className="mt-2 text-muted-foreground">
          Connect your accounts to get started
        </p>
      </div>

      {/* Step indicators */}
      <div className="mb-10 flex items-center gap-0">
        {steps.map((step, i) => {
          const stepNum = i + 1;
          const isActive = stepNum === currentStep;
          const isComplete = stepNum < currentStep;
          return (
            <div key={step.label} className="flex items-center">
              <div className="flex flex-col items-center">
                <div
                  className={`flex size-10 items-center justify-center rounded-full border-2 transition-colors ${
                    isComplete
                      ? "border-primary bg-primary text-primary-foreground"
                      : isActive
                        ? "border-primary bg-background text-primary"
                        : "border-muted-foreground/30 bg-background text-muted-foreground/50"
                  }`}
                >
                  {isComplete ? (
                    <CheckCircle className="size-5" />
                  ) : (
                    <step.icon className="size-5" />
                  )}
                </div>
                <span
                  className={`mt-1.5 text-xs font-medium ${
                    isActive || isComplete
                      ? "text-foreground"
                      : "text-muted-foreground/50"
                  }`}
                >
                  {step.label}
                </span>
              </div>
              {i < steps.length - 1 && (
                <div
                  className={`mx-3 mb-5 h-0.5 w-16 transition-colors sm:w-24 ${
                    isComplete ? "bg-primary" : "bg-muted-foreground/20"
                  }`}
                />
              )}
            </div>
          );
        })}
      </div>

      {/* Step content */}
      <div className="w-full max-w-lg">
        {currentStep === 1 && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Building2 className="size-5 text-primary" />
                Connect Your Bank
              </CardTitle>
              <CardDescription>
                Link your bank account to automatically sync transactions.
                CashLens uses Teller for secure, read-only access to your
                financial data.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {error && (
                <div className="rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                  {error}
                </div>
              )}
              <Button
                size="lg"
                className="w-full"
                onClick={handleTellerConnect}
                disabled={connecting}
              >
                {connecting ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    Connecting...
                  </>
                ) : (
                  <>
                    <Building2 className="size-4" />
                    Connect Bank Account
                  </>
                )}
              </Button>
              <p className="text-center text-xs text-muted-foreground">
                Your credentials are encrypted and never stored. CashLens only
                has read-only access.
              </p>
            </CardContent>
          </Card>
        )}

        {currentStep === 2 && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Mail className="size-5 text-primary" />
                Connect Gmail (Optional)
              </CardTitle>
              <CardDescription>
                Let CashLens scan your email for receipts and order
                confirmations to automatically match with transactions.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {error && (
                <div className="rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                  {error}
                </div>
              )}
              <Button
                size="lg"
                className="w-full"
                onClick={handleGmailConnect}
                disabled={connecting}
              >
                {connecting ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    Connecting...
                  </>
                ) : (
                  <>
                    <Mail className="size-4" />
                    Connect Gmail
                  </>
                )}
              </Button>
              <Button
                variant="ghost"
                size="lg"
                className="w-full"
                onClick={handleSkipGmail}
                disabled={connecting}
              >
                <SkipForward className="size-4" />
                Skip for now
              </Button>
              <p className="text-center text-xs text-muted-foreground">
                Read-only access. CashLens will only look for purchase
                receipts and order confirmations.
              </p>
            </CardContent>
          </Card>
        )}

        {currentStep === 3 && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <CheckCircle className="size-5 text-green-600 dark:text-green-400" />
                You&apos;re all set!
              </CardTitle>
              <CardDescription>
                CashLens is now connected and syncing your financial data.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid grid-cols-2 gap-4">
                <div className="rounded-lg border bg-muted/50 p-4 text-center">
                  <p className="text-2xl font-bold tabular-nums">
                    {status?.accounts_count ?? 0}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Accounts synced
                  </p>
                </div>
                <div className="rounded-lg border bg-muted/50 p-4 text-center">
                  <p className="text-2xl font-bold tabular-nums">
                    {status?.transactions_count ?? 0}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Transactions imported
                  </p>
                </div>
              </div>
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-sm">
                  <CheckCircle className="size-4 text-green-600 dark:text-green-400" />
                  Bank connected
                </div>
                <div className="flex items-center gap-2 text-sm">
                  {status?.has_gmail ? (
                    <CheckCircle className="size-4 text-green-600 dark:text-green-400" />
                  ) : (
                    <SkipForward className="size-4 text-muted-foreground" />
                  )}
                  {status?.has_gmail ? "Gmail connected" : "Gmail skipped"}
                </div>
              </div>
              <Button
                size="lg"
                className="w-full"
                onClick={handleGoToDashboard}
              >
                Go to Dashboard
                <ArrowRight className="size-4" />
              </Button>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
