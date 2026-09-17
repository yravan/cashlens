import "server-only";
import { and, asc, eq, isNull, sql } from "drizzle-orm";

import { UUID_PATTERN } from "@/lib/crypto/credentials";
import { activeObligationsFor } from "@/lib/data/obligations";
import { requireUser } from "@/lib/data/users";
import { withRequestScope, type ScopedTx } from "@/lib/db/client";
import { accounts, recurringStreams, transactions, transferPairs } from "@/lib/db/schema";
import {
  detectRecurringStreams,
  type RecurringStream,
} from "@/lib/ledger/recurring-detection";
import { isIsoDate } from "@/lib/ledger/history-query";
import {
  annualTotals,
  tracked,
  type AnnualTotal,
  type StreamStatus,
} from "@/lib/ledger/subscriptions";
import { nextObligationDate, projectUpcoming } from "@/lib/ledger/upcoming";

export type RecurringDecision = Exclude<StreamStatus, "proposed">;
export type RecurringStatus = StreamStatus;
export type RecurringOverviewStream = RecurringStream & {
  status: RecurringStatus;
  decidedOn: string | null;
};

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

async function recurringOverviewFor(
  tx: ScopedTx,
  userId: string,
): Promise<{ streams: RecurringOverviewStream[]; annual: AnnualTotal[] }> {
  const detected = await detectFor(tx, userId);
  const decisions = await tx
    .select({
      accountId: recurringStreams.accountId,
      currency: recurringStreams.currency,
      direction: recurringStreams.direction,
      normalizedName: recurringStreams.normalizedName,
      status: recurringStreams.status,
      updatedAt: recurringStreams.updatedAt,
    })
    .from(recurringStreams)
    .where(eq(recurringStreams.userId, userId));
  const decisionBy = new Map(decisions.map((row) => [identityKey(row), row]));
  const streams: RecurringOverviewStream[] = detected.map((stream) => {
    const decision = decisionBy.get(identityKey(stream));
    return {
      ...stream,
      status: decision?.status ?? "proposed",
      decidedOn: decision ? decision.updatedAt.toISOString().slice(0, 10) : null,
    };
  });
  return { streams, annual: annualTotals(streams) };
}

export async function recurringOverview(): Promise<{
  streams: RecurringOverviewStream[];
  annual: AnnualTotal[];
}> {
  const user = await requireUser();
  return withRequestScope(user.clerkUserId, (tx) => recurringOverviewFor(tx, user.id));
}

export type RecurringOverview = Awaited<ReturnType<typeof recurringOverview>>;

export async function upcomingOverview(reference: string) {
  if (!isIsoDate(reference)) {
    throw new Error("upcoming reference must be a real ISO date");
  }
  const user = await requireUser();
  return withRequestScope(user.clerkUserId, async (tx) => {
    const { streams } = await recurringOverviewFor(tx, user.id);
    const obligations = await activeObligationsFor(tx, user.id);
    const ownedAccounts = await tx
      .select({ id: accounts.id, name: accounts.name, currency: accounts.currency })
      .from(accounts)
      .where(eq(accounts.userId, user.id))
      .orderBy(asc(accounts.name), asc(accounts.id));
    const trackedCount = streams.filter((stream) => tracked(stream.status)).length;
    return {
      reference,
      trackedCount,
      accounts: ownedAccounts,
      obligations: obligations.map((obligation) => ({
        id: obligation.obligationId,
        accountId: obligation.accountId,
        accountName: obligation.accountName,
        name: obligation.name,
        amountMinor: obligation.amountMinor,
        currency: obligation.currency,
        cadence: obligation.cadence,
        startsOn: obligation.startsOn,
        endsOn: obligation.endsOn,
        nextOn: nextObligationDate(obligation, reference),
      })),
      ...projectUpcoming(streams, reference, obligations),
    };
  });
}

export type UpcomingOverview = Awaited<ReturnType<typeof upcomingOverview>>;

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
