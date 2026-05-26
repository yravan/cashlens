import Link from "next/link";
import { SignIn } from "@clerk/nextjs";
import { ArrowRight } from "lucide-react";

import { clerkEnabled } from "@/lib/runtime";

export default async function SignInPage() {
  if (clerkEnabled) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4 py-10">
        <div className="rounded-[32px] border border-[var(--border)] bg-white/82 p-6 shadow-[var(--card-shadow)] backdrop-blur">
          <SignIn
            path="/sign-in"
            routing="path"
            fallbackRedirectUrl="/dashboard"
            signUpFallbackRedirectUrl="/dashboard"
          />
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="max-w-xl rounded-[32px] border border-[var(--border)] bg-white/82 p-8 shadow-[var(--card-shadow)] backdrop-blur">
        <p className="text-xs font-semibold uppercase tracking-[0.28em] text-[var(--muted)]">Demo mode</p>
        <h1 className="mt-3 text-4xl font-bold tracking-tight text-[var(--foreground)]">The app is ready to explore right away.</h1>
        <p className="mt-4 text-base leading-7 text-[var(--muted)]">
          Clerk is optional in local development. Until Clerk is enabled for this environment, Cash Lens uses a seeded
          single-user demo workspace so you can review the full MVP flow immediately.
        </p>
        <Link
          href="/dashboard"
          className="mt-6 inline-flex items-center gap-2 rounded-full bg-[var(--accent-strong)] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[var(--accent)]"
        >
          Continue to dashboard
          <ArrowRight className="h-4 w-4" />
        </Link>
      </div>
    </div>
  );
}
