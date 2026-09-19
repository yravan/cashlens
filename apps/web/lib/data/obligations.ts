import "server-only";

import { and, eq, isNull, sql } from "drizzle-orm";
import { bigint, char, date, pgTable, text, uuid } from "drizzle-orm/pg-core";

import { UUID_PATTERN } from "@/lib/crypto/credentials";
import { requireUser } from "@/lib/data/users";
import { withRequestScope, type ScopedTx } from "@/lib/db/client";
import {
  accounts,
  scheduledObligationCadence,
  scheduledObligations,
} from "@/lib/db/schema";
import type { ObligationInput } from "@/lib/ledger/obligations";
import type { UpcomingObligationInput } from "@/lib/ledger/upcoming";

export type ObligationMutationError = "account_not_found" | "obligation_not_found";
export type ObligationMutation =
  | { obligationId: string }
  | Record<string, never>
  | { error: ObligationMutationError };

const scheduledObligationInsert = pgTable("scheduled_obligations", {
  userId: uuid("user_id").notNull(),
  accountId: uuid("account_id").notNull(),
  name: text("name").notNull(),
  amountMinor: bigint("amount_minor", { mode: "number" }).notNull(),
  currency: char("currency", { length: 3 }).notNull(),
  cadence: scheduledObligationCadence("cadence").notNull(),
  startsOn: date("starts_on").notNull(),
  endsOn: date("ends_on"),
});

function isAccountReferenceError(error: unknown): boolean {
  const cause = (error as { cause?: { code?: string; constraint?: string } }).cause;
  return (
    cause?.code === "23503" &&
    cause.constraint === "scheduled_obligations_account_user_fk"
  );
}

export function activeObligationsFor(
  tx: ScopedTx,
  userId: string,
): Promise<UpcomingObligationInput[]> {
  return tx
    .select({
      obligationId: scheduledObligations.id,
      accountId: scheduledObligations.accountId,
      name: scheduledObligations.name,
      amountMinor: scheduledObligations.amountMinor,
      currency: scheduledObligations.currency,
      cadence: scheduledObligations.cadence,
      startsOn: scheduledObligations.startsOn,
      endsOn: scheduledObligations.endsOn,
      endedAt: scheduledObligations.endedAt,
    })
    .from(scheduledObligations)
    .where(
      and(
        eq(scheduledObligations.userId, userId),
        isNull(scheduledObligations.endedAt),
      ),
    );
}

export async function createObligation(
  input: ObligationInput,
): Promise<{ obligationId: string } | { error: "account_not_found" }> {
  const user = await requireUser();
  if (!UUID_PATTERN.test(input.accountId)) return { error: "account_not_found" };

  try {
    return await withRequestScope(user.clerkUserId, async (tx) => {
      const [account] = await tx
        .select({ id: accounts.id })
        .from(accounts)
        .where(and(eq(accounts.id, input.accountId), eq(accounts.userId, user.id)));
      if (!account) return { error: "account_not_found" as const };

      const [created] = await tx
        .insert(scheduledObligationInsert)
        .values({
          userId: user.id,
          accountId: account.id,
          name: input.name,
          amountMinor: input.amountMinor,
          currency: input.currency,
          cadence: input.cadence,
          startsOn: input.startsOn,
          endsOn: input.endsOn,
        })
        .returning({ obligationId: scheduledObligations.id });
      return created;
    });
  } catch (error) {
    if (isAccountReferenceError(error)) return { error: "account_not_found" };
    throw error;
  }
}

export async function editObligation(
  obligationId: string,
  input: ObligationInput,
): Promise<Record<string, never> | { error: "obligation_not_found" | "account_not_found" }> {
  const user = await requireUser();
  if (!UUID_PATTERN.test(obligationId)) return { error: "obligation_not_found" };

  try {
    return await withRequestScope(
      user.clerkUserId,
      async (
        tx,
      ): Promise<
        Record<string, never> | { error: "obligation_not_found" | "account_not_found" }
      > => {
        const obligationPredicate = and(
          eq(scheduledObligations.id, obligationId),
          eq(scheduledObligations.userId, user.id),
          isNull(scheduledObligations.endedAt),
        );
        const [obligation] = await tx
          .select({ id: scheduledObligations.id })
          .from(scheduledObligations)
          .where(obligationPredicate);
        if (!obligation) return { error: "obligation_not_found" as const };
        if (!UUID_PATTERN.test(input.accountId)) return { error: "account_not_found" as const };

        const [account] = await tx
          .select({ id: accounts.id })
          .from(accounts)
          .where(and(eq(accounts.id, input.accountId), eq(accounts.userId, user.id)));
        if (!account) return { error: "account_not_found" as const };

        const [updated] = await tx
          .update(scheduledObligations)
          .set({
            accountId: account.id,
            name: input.name,
            amountMinor: input.amountMinor,
            currency: input.currency,
            cadence: input.cadence,
            startsOn: input.startsOn,
            endsOn: input.endsOn,
            updatedAt: sql`now()`,
          })
          .where(obligationPredicate)
          .returning({ id: scheduledObligations.id });
        return updated ? {} : { error: "obligation_not_found" as const };
      },
    );
  } catch (error) {
    if (isAccountReferenceError(error)) return { error: "account_not_found" };
    throw error;
  }
}

export async function endObligation(
  obligationId: string,
): Promise<Record<string, never> | { error: "obligation_not_found" }> {
  const user = await requireUser();
  if (!UUID_PATTERN.test(obligationId)) return { error: "obligation_not_found" };

  return withRequestScope(
    user.clerkUserId,
    async (tx): Promise<Record<string, never> | { error: "obligation_not_found" }> => {
      const ownObligation = and(
        eq(scheduledObligations.id, obligationId),
        eq(scheduledObligations.userId, user.id),
      );
      const [ended] = await tx
        .update(scheduledObligations)
        .set({ endedAt: sql`now()`, updatedAt: sql`now()` })
        .where(and(ownObligation, isNull(scheduledObligations.endedAt)))
        .returning({ id: scheduledObligations.id });
      if (ended) return {};

      const [existing] = await tx
        .select({ id: scheduledObligations.id })
        .from(scheduledObligations)
        .where(ownObligation);
      return existing ? {} : { error: "obligation_not_found" as const };
    },
  );
}
