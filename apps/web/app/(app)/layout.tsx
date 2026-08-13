import { UserButton } from "@clerk/nextjs";
import { currentUser } from "@clerk/nextjs/server";
import Link from "next/link";

import { PrimaryNav, TabBar } from "./nav";

export default async function AppShellLayout({ children }: LayoutProps<"/">) {
  const email =
    (await currentUser())?.primaryEmailAddress?.emailAddress ?? "";

  return (
    <>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-white focus:px-3 focus:py-2 focus:text-sm focus:shadow-md dark:focus:bg-zinc-900"
      >
        Skip to content
      </a>
      <header className="sticky top-0 z-40 border-b border-zinc-200 bg-white/90 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/90">
        <div className="mx-auto flex h-14 max-w-5xl items-center gap-6 px-4 md:px-6">
          <Link href="/" className="text-base font-semibold tracking-tight">
            Cash Lens
          </Link>
          <PrimaryNav />
          <div className="ml-auto flex items-center gap-3">
            <span
              data-testid="signed-in-email"
              className="hidden text-sm text-zinc-500 md:inline dark:text-zinc-400"
            >
              {email}
            </span>
            <UserButton />
          </div>
        </div>
      </header>
      <main
        id="main"
        className="mx-auto w-full max-w-5xl flex-1 px-4 py-6 pb-24 md:px-6 md:pb-8"
      >
        {children}
      </main>
      <TabBar />
    </>
  );
}
