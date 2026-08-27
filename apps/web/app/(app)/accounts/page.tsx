import type { Metadata } from "next";

import { listConnectionsWithStats } from "@/lib/data/connections";
import { ledgerCounts } from "@/lib/data/ledger";
import { listResumableSyncs } from "@/lib/data/plaid-sync";
import { requireUser } from "@/lib/data/users";
import { ConnectButton } from "./connect-button";
import { ConnectionsList } from "./connections-list";
import { SyncResume } from "./sync-resume";

export const metadata: Metadata = { title: "Accounts" };

export default async function AccountsPage() {
  await requireUser();
  const counts = await ledgerCounts();
  const resumable = await listResumableSyncs();
  const connections = await listConnectionsWithStats();
  const activeInstitutionIds = connections.flatMap((connection) =>
    connection.status === "active" && connection.institutionId ? [connection.institutionId] : [],
  );

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
      <ConnectButton activeInstitutionIds={activeInstitutionIds} />
      <ConnectionsList connections={connections} />
      <SyncResume connectionIds={resumable} />
    </>
  );
}
