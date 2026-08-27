import { listConnections } from "@/lib/data/connections";
import { LOGIN_REPAIR_CODES, WARNING_REPAIR_CODES } from "@/lib/data/plaid";

export type Connection = Awaited<ReturnType<typeof listConnections>>[number];

type Tone = "ok" | "attention" | "muted";

export function presentation(connection: Connection): {
  label: string;
  tone: Tone;
  detail: string | null;
  repairable: boolean;
} {
  const { status, backfillStatus, providerError } = connection;
  if (status === "disconnected") {
    return {
      label: "Disconnected",
      tone: "muted",
      detail:
        providerError === "USER_PERMISSION_REVOKED"
          ? "Access was revoked from the bank's side. Connect it again to resume imports."
          : null,
      repairable: false,
    };
  }
  if (providerError) {
    const lapsing = WARNING_REPAIR_CODES.has(providerError);
    return {
      label: "Needs attention",
      tone: "attention",
      detail: lapsing
        ? "The bank's access approval expires soon. Reconnect to keep imports flowing."
        : "The bank needs you to sign in again before imports can continue.",
      repairable: lapsing || LOGIN_REPAIR_CODES.has(providerError),
    };
  }
  if (backfillStatus === "in_progress") {
    return { label: "Importing history", tone: "ok", detail: null, repairable: false };
  }
  return { label: "Connected", tone: "ok", detail: null, repairable: false };
}

const badgeTone: Record<Tone, string> = {
  ok: "border-zinc-200 text-zinc-600 dark:border-zinc-700 dark:text-zinc-300",
  attention: "border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-400",
  muted: "border-zinc-200 text-zinc-400 dark:border-zinc-800 dark:text-zinc-500",
};

export async function ConnectionsList() {
  const connections = await listConnections();
  if (connections.length === 0) return null;

  return (
    <section className="mt-8">
      <h2 className="text-lg font-medium tracking-tight">Connections</h2>
      <ul className="mt-3 space-y-3">
        {connections.map((connection) => {
          const shown = presentation(connection);
          return (
            <li
              key={connection.id}
              data-testid={`connection-${connection.id}`}
              className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800"
            >
              <div className="flex items-center justify-between gap-4">
                <span className="text-sm font-medium">
                  {connection.institutionName ?? "Bank connection"}
                </span>
                <span
                  data-testid="connection-status"
                  className={`rounded-full border px-2.5 py-0.5 text-xs ${badgeTone[shown.tone]}`}
                >
                  {shown.label}
                </span>
              </div>
              {shown.detail && (
                <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">{shown.detail}</p>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
