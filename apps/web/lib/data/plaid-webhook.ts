import "server-only";
import { and, eq, sql } from "drizzle-orm";

import { advanceSyncFor } from "@/lib/data/plaid-sync";
import { withPlaidItemScope } from "@/lib/db/client";
import { connections, users } from "@/lib/db/schema";
import { errorClass, logEvent } from "@/lib/log";
import { verifyPlaidWebhook, WebhookVerificationError } from "@/lib/plaid/webhook";

const MAX_BODY_BYTES = 256 * 1024;
// Legacy stream Plaid keeps sending alongside /transactions/sync; documented no-ops.
const LEGACY_TRANSACTIONS_CODES = new Set([
  "INITIAL_UPDATE",
  "HISTORICAL_UPDATE",
  "DEFAULT_UPDATE",
  "TRANSACTIONS_REMOVED",
  "RECURRING_TRANSACTIONS_UPDATE",
]);

const ok = () => Response.json({});

const boundedText = (value: unknown): string | null =>
  typeof value === "string" && value.length > 0 && value.length <= 512 ? value : null;

type ItemOwner = { connectionId: string; user: { id: string; clerkUserId: string } };

// The verified item id unlocks exactly its connection rows; each owning user's
// id, set as a request-local setting, then unlocks exactly that user's clerk id
// (webhook RLS policies — no SECURITY DEFINER, no elevated role).
async function ownersOfItem(itemId: string): Promise<ItemOwner[]> {
  return withPlaidItemScope(itemId, async (tx) => {
    const rows = await tx
      .select({ connectionId: connections.id, userId: connections.userId })
      .from(connections)
      .where(
        and(
          eq(connections.provider, "plaid"),
          eq(connections.providerItemId, itemId),
          eq(connections.status, "active"),
        ),
      );
    const owners: ItemOwner[] = [];
    for (const row of rows) {
      await tx.execute(sql`select set_config('app.plaid_webhook_user_id', ${row.userId}, true)`);
      const [owner] = await tx
        .select({ clerkUserId: users.clerkUserId })
        .from(users)
        .where(eq(users.id, row.userId));
      if (owner) {
        owners.push({ connectionId: row.connectionId, user: { id: row.userId, clerkUserId: owner.clerkUserId } });
      }
    }
    return owners;
  });
}

async function syncItem(itemId: string): Promise<void> {
  const owners = await ownersOfItem(itemId);
  if (owners.length === 0) {
    logEvent("plaid_webhook.unknown_item", {});
    return;
  }
  for (const owner of owners) {
    try {
      const step = await advanceSyncFor(owner.user, owner.connectionId);
      if (step && !step.drained) {
        logEvent("plaid_webhook.partial_drain", { connectionId: owner.connectionId });
      }
    } catch (error) {
      // Swallowed on purpose: the stored cursor is unharmed and a non-200 here
      // would only feed Plaid's rejection circuit breaker.
      logEvent("plaid_webhook.sync_failed", {
        connectionId: owner.connectionId,
        errorClass: errorClass(error),
      });
    }
  }
}

export async function handlePlaidWebhook(
  rawBody: string,
  verificationJwt: string | null,
): Promise<Response> {
  if (Buffer.byteLength(rawBody, "utf8") > MAX_BODY_BYTES) {
    return Response.json({ error: "too_large" }, { status: 413 });
  }

  let stale: boolean;
  try {
    ({ stale } = await verifyPlaidWebhook(rawBody, verificationJwt));
  } catch (error) {
    if (error instanceof WebhookVerificationError) {
      logEvent("plaid_webhook.rejected", { reason: error.message });
      return Response.json({ error: "unverified" }, { status: 401 });
    }
    throw error;
  }
  if (stale) {
    logEvent("plaid_webhook.stale", {});
    return ok();
  }

  let body: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(rawBody);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error();
    body = parsed as Record<string, unknown>;
  } catch {
    logEvent("plaid_webhook.unparseable", {});
    return ok();
  }

  const type = boundedText(body.webhook_type);
  const code = boundedText(body.webhook_code);
  const itemId = boundedText(body.item_id);

  if (type === "TRANSACTIONS" && code === "SYNC_UPDATES_AVAILABLE" && itemId) {
    await syncItem(itemId);
    return ok();
  }
  if (type === "TRANSACTIONS" && code && LEGACY_TRANSACTIONS_CODES.has(code)) {
    return ok();
  }
  if (type === "ITEM" && code === "NEW_ACCOUNTS_AVAILABLE") {
    // Seam: surfacing newly-visible accounts is 2.1.5/2.1.6 territory.
    logEvent("plaid_webhook.new_accounts_available", {});
    return ok();
  }
  logEvent("plaid_webhook.ignored", { type, code });
  return ok();
}
