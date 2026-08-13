import type { Metadata } from "next";

import { ledgerCounts } from "@/lib/data/ledger";
import { requireUser } from "@/lib/data/users";

export const metadata: Metadata = { title: "Transactions" };

export default async function TransactionsPage() {
  await requireUser();
  const counts = await ledgerCounts();

  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Transactions</h1>
      <p
        data-testid="transactions-count"
        className="mt-2 text-sm text-zinc-500 dark:text-zinc-400"
      >
        {counts.transactions === 1
          ? "1 transaction in the ledger"
          : `${counts.transactions} transactions in the ledger`}
      </p>
      <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
        Transaction history lands here (leaf 3.6.1).
      </p>
    </>
  );
}
