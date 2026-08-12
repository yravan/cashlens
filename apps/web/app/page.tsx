import { UserButton } from "@clerk/nextjs";
import { auth, currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";

export default async function Home() {
  // Defense in depth: the proxy already gates this route, but middleware is
  // never the authorization layer (CVE-2025-29927) — re-check at the resource.
  const { isAuthenticated } = await auth();
  if (!isAuthenticated) redirect("/sign-in");

  const user = await currentUser();
  const email = user?.primaryEmailAddress?.emailAddress ?? "";

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
      <h1 className="text-3xl font-semibold tracking-tight">Cash Lens</h1>
      <p className="text-zinc-600 dark:text-zinc-400">
        Signed in as <span data-testid="signed-in-email">{email}</span>
      </p>
      <UserButton />
      <p className="text-sm text-zinc-400 dark:text-zinc-500">
        The dashboard arrives with the app shell (leaf 1.2.1).
      </p>
    </main>
  );
}
