import type { Metadata } from "next";

import { requireUser } from "@/lib/data/users";

export const metadata: Metadata = { title: "Accounts" };

export default async function AccountsPage() {
  await requireUser();

  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Accounts</h1>
      <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
        The accounts overview lands here (leaf 6.3.1).
      </p>
    </>
  );
}
