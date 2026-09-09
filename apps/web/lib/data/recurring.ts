import "server-only";
import { and, eq, isNull, sql } from "drizzle-orm";

import { UUID_PATTERN } from "@/lib/crypto/credentials";
import { requireUser } from "@/lib/data/users";
import { withRequestScope, type ScopedTx } from "@/lib/db/client";
import { recurringStreams, transactions, transferPairs } from "@/lib/db/schema";
import {
  detectRecurringStreams,
  type RecurringStream,
} from "@/lib/ledger/recurring-detection";

export type RecurringDecision = "confirmed" | "dismissed";
export type RecurringStatus = "proposed" | RecurringDecision;
export type RecurringOverviewStream = RecurringStream & { status: RecurringStatus };

export type StreamIdentity = Pick<
  RecurringStream,
  "accountId" | "currency" | "direction" | "normalizedName"
>;

export function parseStreamIdentity(body: unknown): StreamIdentity | null {
  const input = body as Partial<Record<keyof StreamIdentity, unknown>> | null;
  const { accountId, currency, direction, normalizedName } = input ?? {};
  if (typeof accountId !== "string" || !UUID_PATTERN.test(accountId)) return null;
  if (typeof currency !== "string" || !/^[A-Z]{3}$/.test(currency)) return null;
  if (direction !== "inflow" && direction !== "outflow") return null;
  if (
    typeof normalizedName !== "string" ||
    normalizedName.length === 0 ||
    normalizedName.length > 200 ||
    normalizedName !== normalizedName.trim()
  ) {
    return null;
  }
  return { accountId, currency, direction, normalizedName };
}

const identityKey = (identity: StreamIdentity) =>
  [identity.accountId, identity.currency, identity.direction, identity.normalizedName].join(":");

async function detectFor(tx: ScopedTx, userId: string): Promise<RecurringStream[]> {
  const rows = await tx
    .select({
      id: transactions.id,
      accountId: transactions.accountId,
      amountMinor: transactions.amountMinor,
      currency: transactions.currency,
      date: transactions.date,
      description: transactions.description,
      merchant: transactions.merchant,
      status: transactions.status,
    })
    .from(transactions)
    .where(and(eq(transactions.userId, userId), eq(transactions.status, "posted")));
  const pairs = await tx
    .select({
      outflowId: transferPairs.outflowTransactionId,
      inflowId: transferPairs.inflowTransactionId,
    })
    .from(transferPairs)
    .where(and(eq(transferPairs.userId, userId), isNull(transferPairs.dismissedAt)));
  const excluded = new Set(pairs.flatMap((pair) => [pair.outflowId, pair.inflowId]));
  return detectRecurringStreams(rows, excluded);
}

export async function recurringOverview(): Promise<{ streams: RecurringOverviewStream[] }> {
  const user = await requireUser();
  return withRequestScope(user.clerkUserId, async (tx) => {
    const detected = await detectFor(tx, user.id);
    const decisions = await tx
      .select({
        accountId: recurringStreams.accountId,
        currency: recurringStreams.currency,
        direction: recurringStreams.direction,
        normalizedName: recurringStreams.normalizedName,
        status: recurringStreams.status,
      })
      .from(recurringStreams)
      .where(eq(recurringStreams.userId, user.id));
    const decisionBy = new Map(decisions.map((row) => [identityKey(row), row.status]));
    return {
      streams: detected.map((stream) => ({
        ...stream,
        status: decisionBy.get(identityKey(stream)) ?? "proposed",
      })),
    };
  });
}

export type RecurringOverview = Awaited<ReturnType<typeof recurringOverview>>;

// Decisions attach only to currently-detected streams: recomputing first means
// a caller can never store intent for another user's account or a stream that
// does not exist (and the composite FK backstops account ownership anyway).
export async function setRecurringStatus(
  identity: StreamIdentity,
  status: RecurringDecision,
): Promise<boolean> {
  const user = await requireUser();
  return withRequestScope(user.clerkUserId, async (tx) => {
    const detected = await detectFor(tx, user.id);
    const target = identityKey(identity);
    if (!detected.some((stream) => identityKey(stream) === target)) return false;
    await tx
      .insert(recurringStreams)
      .values({ ...identity, userId: user.id, status })
      .onConflictDoUpdate({
        target: [
          recurringStreams.accountId,
          recurringStreams.currency,
          recurringStreams.direction,
          recurringStreams.normalizedName,
        ],
        set: { status, updatedAt: sql`now()` },
      });
    return true;
  });
}
