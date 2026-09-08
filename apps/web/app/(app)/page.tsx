import type { Metadata } from "next";

import { cashFlowSummary } from "@/lib/data/ledger";
import { CashFlow } from "./cash-flow";
import { TransferMatch } from "./transactions/transfer-match";

export const metadata: Metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  const summary = await cashFlowSummary();

  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
      {(summary.currencies.length > 0 || summary.transferRows > 0) && <TransferMatch />}
      <p className="mt-2 max-w-xl text-sm leading-6 text-zinc-500 dark:text-zinc-400">
        True spend by calendar month, from posted transactions. Transfers between your own
        accounts — card payments, savings moves — never count.
      </p>
      <CashFlow summary={summary} />
    </>
  );
}
