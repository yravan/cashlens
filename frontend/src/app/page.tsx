import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Wallet, TrendingUp, Shield, Zap } from "lucide-react";

export default async function LandingPage() {
  const { userId } = await auth();
  if (userId) {
    redirect("/dashboard");
  }

  return (
    <div className="flex min-h-screen flex-col">
      {/* Nav */}
      <header className="border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4">
          <div className="flex items-center gap-2">
            <div className="flex size-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <Wallet className="size-5" />
            </div>
            <span className="text-xl font-bold tracking-tight">CashLens</span>
          </div>
          <nav className="flex items-center gap-3">
            <Link
              href="/sign-in"
              className="inline-flex h-9 items-center justify-center rounded-md px-4 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground"
            >
              Sign In
            </Link>
            <Link
              href="/sign-up"
              className="inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90"
            >
              Get Started
            </Link>
          </nav>
        </div>
      </header>

      {/* Hero */}
      <main className="flex flex-1 flex-col">
        <section className="flex flex-1 flex-col items-center justify-center px-4 py-20 text-center">
          <div className="mx-auto max-w-3xl space-y-6">
            <h1 className="text-4xl font-bold tracking-tight sm:text-5xl md:text-6xl">
              Your finances,
              <br />
              <span className="text-primary">crystal clear.</span>
            </h1>
            <p className="mx-auto max-w-xl text-lg text-muted-foreground">
              CashLens connects to your bank accounts and email receipts, then
              uses AI to categorize, track, and surface insights about your
              spending -- automatically.
            </p>
            <div className="flex items-center justify-center gap-4 pt-4">
              <Link
                href="/sign-up"
                className="inline-flex h-11 items-center justify-center rounded-md bg-primary px-8 text-base font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90"
              >
                Get Started Free
              </Link>
              <Link
                href="/sign-in"
                className="inline-flex h-11 items-center justify-center rounded-md border border-input bg-background px-8 text-base font-medium shadow-sm transition-colors hover:bg-accent hover:text-accent-foreground"
              >
                Sign In
              </Link>
            </div>
          </div>
        </section>

        {/* Feature cards */}
        <section className="border-t bg-muted/40 py-20">
          <div className="mx-auto grid max-w-5xl gap-8 px-4 md:grid-cols-3">
            <div className="rounded-xl border bg-card p-6 shadow-sm">
              <div className="mb-3 flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <TrendingUp className="size-5" />
              </div>
              <h3 className="mb-1 font-semibold">Auto Bank Sync</h3>
              <p className="text-sm text-muted-foreground">
                Connect your bank once. Transactions sync every few hours
                automatically via Teller or SimpleFIN.
              </p>
            </div>
            <div className="rounded-xl border bg-card p-6 shadow-sm">
              <div className="mb-3 flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Zap className="size-5" />
              </div>
              <h3 className="mb-1 font-semibold">AI Categorization</h3>
              <p className="text-sm text-muted-foreground">
                LLM-powered categorization learns your patterns and auto-tags
                every transaction.
              </p>
            </div>
            <div className="rounded-xl border bg-card p-6 shadow-sm">
              <div className="mb-3 flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Shield className="size-5" />
              </div>
              <h3 className="mb-1 font-semibold">Privacy First</h3>
              <p className="text-sm text-muted-foreground">
                Self-hosted. Your data stays on your server, encrypted at
                rest. No third-party analytics.
              </p>
            </div>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t py-6 text-center text-sm text-muted-foreground">
        CashLens &mdash; open-source personal finance
      </footer>
    </div>
  );
}
