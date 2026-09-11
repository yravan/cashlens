import "server-only";
import { and, eq, lte, sql } from "drizzle-orm";

import { type ScopedTx } from "@/lib/db/client";
import { classificationRuns } from "@/lib/db/schema";

export const INFERENCE_LEASE_SECONDS = 90;

export class InferenceBusyError extends Error {
  constructor(readonly retryAfterSeconds: number) {
    super("classification inference is already running");
  }
}

type RunIdentity = {
  ownerUserId: string;
  requestedModel: string;
  promptVersion: string;
  assignmentSchemaVersion: string;
  taxonomyFingerprint: string;
  providerPolicyFingerprint: string;
  batchSize: number;
} & (
  | { kind: "automatic_initial"; operatorActor?: never; expiresAt?: never }
  | { kind: "automatic_reclassification"; operatorActor: string; expiresAt: Date }
);

const retryAfter = (seconds: unknown): number =>
  Math.max(1, Math.min(INFERENCE_LEASE_SECONDS, Number(seconds) || 1));

async function activeRun(tx: ScopedTx, ownerUserId: string) {
  const [locked] = await tx
    .select({ id: classificationRuns.id })
    .from(classificationRuns)
    .where(
      and(
        eq(classificationRuns.ownerUserId, ownerUserId),
        eq(classificationRuns.status, "inferring"),
      ),
    )
    .for("update");
  if (!locked) return undefined;
  // Evaluate the lease only after the row lock; clock_timestamp() must reflect
  // time spent waiting for another transaction to release that lock.
  const [run] = await tx
    .select({
      id: classificationRuns.id,
      expired: sql<boolean>`${classificationRuns.inferenceLeaseUntil} <= clock_timestamp()`,
      retryAfterSeconds: sql<number>`ceil(extract(epoch from
        (${classificationRuns.inferenceLeaseUntil} - clock_timestamp())))::int`,
    })
    .from(classificationRuns)
    .where(
      and(
        eq(classificationRuns.id, locked.id),
        eq(classificationRuns.status, "inferring"),
      ),
    );
  return run;
}

export async function claimInferenceRun(
  tx: ScopedTx,
  identity: RunIdentity,
): Promise<string> {
  const active = await activeRun(tx, identity.ownerUserId);
  if (active && !active.expired) {
    throw new InferenceBusyError(retryAfter(active.retryAfterSeconds));
  }
  if (active) {
    await tx
      .update(classificationRuns)
      .set({ status: "expired", updatedAt: sql`clock_timestamp()` })
      .where(
        and(
          eq(classificationRuns.id, active.id),
          eq(classificationRuns.status, "inferring"),
          lte(classificationRuns.inferenceLeaseUntil, sql`clock_timestamp()`),
        ),
      );
  }

  const [claimed] = await tx
    .insert(classificationRuns)
    .values({
      ...identity,
      status: "inferring",
      inferenceLeaseUntil: sql`clock_timestamp() + ${INFERENCE_LEASE_SECONDS} * interval '1 second'`,
    })
    .onConflictDoNothing()
    .returning({ id: classificationRuns.id });
  if (claimed) return claimed.id;

  const winner = await activeRun(tx, identity.ownerUserId);
  throw new InferenceBusyError(retryAfter(winner?.retryAfterSeconds));
}

export async function lockLiveInferenceRun(
  tx: ScopedTx,
  ownerUserId: string,
  runId: string,
): Promise<boolean> {
  const [locked] = await tx
    .select({ id: classificationRuns.id })
    .from(classificationRuns)
    .where(
      and(
        eq(classificationRuns.id, runId),
        eq(classificationRuns.ownerUserId, ownerUserId),
        eq(classificationRuns.status, "inferring"),
      ),
    )
    .for("update");
  if (!locked) return false;
  // Keep this current-time check separate from the locking statement so a
  // deadline crossed while blocked cannot finalize from a stale projection.
  const [live] = await tx
    .select({ id: classificationRuns.id })
    .from(classificationRuns)
    .where(
      and(
        eq(classificationRuns.id, locked.id),
        eq(classificationRuns.status, "inferring"),
        sql`${classificationRuns.inferenceLeaseUntil} > clock_timestamp()`,
      ),
    );
  return Boolean(live);
}

export async function failLiveInferenceRun(
  tx: ScopedTx,
  ownerUserId: string,
  runId: string,
): Promise<void> {
  if (!(await lockLiveInferenceRun(tx, ownerUserId, runId))) return;
  await tx
    .update(classificationRuns)
    .set({ status: "failed", updatedAt: sql`clock_timestamp()` })
    .where(
      and(
        eq(classificationRuns.id, runId),
        eq(classificationRuns.ownerUserId, ownerUserId),
        eq(classificationRuns.status, "inferring"),
      ),
    );
}
