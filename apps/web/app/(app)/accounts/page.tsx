import type { Metadata } from "next";

import { ledgerCounts } from "@/lib/data/ledger";
import { requireUser } from "@/lib/data/users";

export const metadata: Metadata = { title: "Accounts" };

export default async function AccountsPage() {
  await requireUser();
  const counts = await ledgerCounts();

  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Accounts</h1>
      <p
        data-testid="accounts-count"
        className="mt-2 text-sm text-zinc-500 dark:text-zinc-400"
      >
        {counts.accounts === 1
          ? "1 account in the ledger"
          : `${counts.accounts} accounts in the ledger`}
      </p>
      <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
        The accounts overview lands here (leaf 6.3.1).
      </p>
    </>
  );
}
