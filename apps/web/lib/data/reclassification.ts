import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
import { and, asc, desc, eq, getTableColumns, inArray, isNotNull, or, sql } from "drizzle-orm";

import { categoryGroupsFor } from "@/lib/data/categories";
import {
  claimInferenceRun,
  failLiveInferenceRun,
  lockLiveInferenceRun,
} from "@/lib/data/classification-runs";
import { UUID_PATTERN } from "@/lib/crypto/credentials";
import { withRequestScope, type ScopedTx } from "@/lib/db/client";
import {
  classificationProposals,
  classificationRuns,
  transactions,
  transferPairs,
  users,
} from "@/lib/db/schema";
import {
  captureClassificationRequest,
} from "@/lib/llm/client";

export const RECLASSIFICATION_LIMIT = 40;
export const RECLASSIFICATION_EXPIRY_HOURS = 24;

export type ReclassificationPolicy =
  | "all_auto"
  | "low_confidence"
  | "low_or_medium_confidence";

type OperatorScope = {
  ownerClerkUserId: string;
  operatorActor: string;
};

export class ReclassificationInputError extends Error {}
export class ReclassificationNotFoundError extends Error {}
export class ReclassificationStateError extends Error {}
export class ReclassificationStaleError extends Error {}

type TaxonomyLeaf = { id: string; label: string };

type CandidateRow = {
  id: string;
  description: string;
  merchant: string | null;
  amountMinor: number;
  categoryId: string | null;
  categorySource: "user" | "auto" | null;
  categoryConfidence: "low" | "medium" | "high" | null;
  categoryReason: string | null;
  categoryRunId: string | null;
  categoryRevision: number;
  updatedAt: string;
};

type Candidate = CandidateRow & { categoryId: string; categorySource: "auto" };

type HashedRun = {
  id: string;
  requestedModel: string;
  promptVersion: string;
  assignmentSchemaVersion: string;
  taxonomyFingerprint: string;
  providerPolicyFingerprint: string;
};

type HashedProposal = {
  transactionId: string;
  proposedCategoryId: string;
  proposedConfidence: "low" | "medium" | "high";
  proposedReason: string;
  beforeCategoryId: string;
  beforeCategorySource: "user" | "auto";
  beforeCategoryConfidence: "low" | "medium" | "high" | null;
  beforeCategoryReason: string | null;
  beforeCategoryRunId: string | null;
  beforeCategoryRevision: number;
  beforeUpdatedAt: string;
};

const sha256 = (value: string): string => createHash("sha256").update(value).digest("hex");

export function taxonomyFingerprint(leaves: TaxonomyLeaf[]): string {
  return sha256(JSON.stringify(leaves));
}

export function proposalSetHash(run: HashedRun, proposals: HashedProposal[]): string {
  const projected = proposals.map((proposal) => ({
    transactionId: proposal.transactionId,
    proposedCategoryId: proposal.proposedCategoryId,
    proposedConfidence: proposal.proposedConfidence,
    proposedReason: proposal.proposedReason,
    beforeCategoryId: proposal.beforeCategoryId,
    beforeCategorySource: proposal.beforeCategorySource,
    beforeCategoryConfidence: proposal.beforeCategoryConfidence,
    beforeCategoryReason: proposal.beforeCategoryReason,
    beforeCategoryRunId: proposal.beforeCategoryRunId,
    beforeCategoryRevision: proposal.beforeCategoryRevision,
    beforeUpdatedAt: proposal.beforeUpdatedAt,
  }));
  projected.sort((a, b) => a.transactionId.localeCompare(b.transactionId));
  return sha256(JSON.stringify({ run: hashedRun(run), proposals: projected }));
}

const unpaired = sql`not exists (
  select 1 from ${transferPairs}
  where ${transferPairs.userId} = ${transactions.userId}
    and ${transferPairs.dismissedAt} is null
    and (${transferPairs.outflowTransactionId} = ${transactions.id}
      or ${transferPairs.inflowTransactionId} = ${transactions.id})
)`;

const policyPredicate = (policy: ReclassificationPolicy) => {
  if (policy === "all_auto") return sql`true`;
  if (policy === "low_confidence") return eq(transactions.categoryConfidence, "low");
  return or(
    eq(transactions.categoryConfidence, "low"),
    eq(transactions.categoryConfidence, "medium"),
  )!;
};

const eligible = (ownerUserId: string, policy: ReclassificationPolicy) =>
  and(
    eq(transactions.userId, ownerUserId),
    eq(transactions.categorySource, "auto"),
    isNotNull(transactions.categoryId),
    policyPredicate(policy),
    unpaired,
  );

function validateScope(scope: OperatorScope): void {
  if (scope.ownerClerkUserId.trim().length < 1 || scope.ownerClerkUserId.length > 200) {
    throw new ReclassificationInputError("owner Clerk user id must be between 1 and 200 characters");
  }
  if (scope.operatorActor.trim().length < 1 || scope.operatorActor.length > 200) {
    throw new ReclassificationInputError("operator actor must be between 1 and 200 characters");
  }
}

function validateRunId(runId: string): void {
  if (!UUID_PATTERN.test(runId)) throw new ReclassificationNotFoundError("run not found");
}

function validateHash(hash: string): void {
  if (!/^[0-9a-f]{64}$/.test(hash)) {
    throw new ReclassificationInputError("approval hash must be a lowercase SHA-256 digest");
  }
}

function sameHash(left: string | null, right: string): boolean {
  if (!left || !/^[0-9a-f]{64}$/.test(left)) return false;
  return timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
}

async function ownerFor(tx: ScopedTx, clerkUserId: string) {
  const [owner] = await tx
    .select({ id: users.id })
    .from(users)
    .where(eq(users.clerkUserId, clerkUserId));
  if (!owner) throw new ReclassificationNotFoundError("owner not found");
  return owner;
}

async function taxonomyFor(tx: ScopedTx, ownerUserId: string): Promise<TaxonomyLeaf[]> {
  const groups = await categoryGroupsFor(tx, ownerUserId);
  return groups.flatMap((group) =>
    group.categories.map((leaf) => ({ id: leaf.id, label: `${group.name} > ${leaf.name}` })),
  );
}

const candidateSelection = {
  id: transactions.id,
  description: transactions.description,
  merchant: transactions.merchant,
  amountMinor: transactions.amountMinor,
  categoryId: transactions.categoryId,
  categorySource: transactions.categorySource,
  categoryConfidence: transactions.categoryConfidence,
  categoryReason: transactions.categoryReason,
  categoryRunId: transactions.categoryRunId,
  categoryRevision: transactions.categoryRevision,
  updatedAt: sql<string>`${transactions.updatedAt}::text`,
};

function candidateFrom(row: CandidateRow): Candidate {
  if (!row.categoryId || row.categorySource !== "auto") {
    throw new ReclassificationStaleError("candidate is no longer automatically categorized");
  }
  return { ...row, categoryId: row.categoryId, categorySource: "auto" };
}

function candidateIfEligible(row: CandidateRow): Candidate | null {
  return row.categoryId && row.categorySource === "auto"
    ? { ...row, categoryId: row.categoryId, categorySource: "auto" }
    : null;
}

function sameCandidate(left: Candidate, right: Candidate): boolean {
  return left.id === right.id
    && left.description === right.description
    && left.merchant === right.merchant
    && left.amountMinor === right.amountMinor
    && left.categoryId === right.categoryId
    && left.categorySource === right.categorySource
    && left.categoryConfidence === right.categoryConfidence
    && left.categoryReason === right.categoryReason
    && left.categoryRunId === right.categoryRunId
    && left.categoryRevision === right.categoryRevision
    && left.updatedAt === right.updatedAt;
}

const hashedRun = (run: HashedRun): HashedRun => ({
  id: run.id,
  requestedModel: run.requestedModel,
  promptVersion: run.promptVersion,
  assignmentSchemaVersion: run.assignmentSchemaVersion,
  taxonomyFingerprint: run.taxonomyFingerprint,
  providerPolicyFingerprint: run.providerPolicyFingerprint,
});

const hashedProposalSelection = {
  transactionId: classificationProposals.transactionId,
  proposedCategoryId: classificationProposals.proposedCategoryId,
  proposedConfidence: classificationProposals.proposedConfidence,
  proposedReason: classificationProposals.proposedReason,
  beforeCategoryId: classificationProposals.beforeCategoryId,
  beforeCategorySource: classificationProposals.beforeCategorySource,
  beforeCategoryConfidence: classificationProposals.beforeCategoryConfidence,
  beforeCategoryReason: classificationProposals.beforeCategoryReason,
  beforeCategoryRunId: classificationProposals.beforeCategoryRunId,
  beforeCategoryRevision: classificationProposals.beforeCategoryRevision,
  beforeUpdatedAt: sql<string>`${classificationProposals.beforeUpdatedAt}::text`,
};

export type ProposeReclassificationResult =
  | { status: "no_candidates"; attempted: 0; proposed: 0; skipped: 0 }
  | {
      status: "proposed";
      runId: string;
      approvalHash: string;
      requestedModel: string;
      taxonomyFingerprint: string;
      attempted: number;
      proposed: number;
      skipped: number;
      providerInputTokens: number | null;
      providerOutputTokens: number | null;
    };

export async function proposeReclassification(input: OperatorScope & {
  maxRows: number;
  policy: ReclassificationPolicy;
}): Promise<ProposeReclassificationResult> {
  validateScope(input);
  if (!Number.isInteger(input.maxRows) || input.maxRows < 1 || input.maxRows > RECLASSIFICATION_LIMIT) {
    throw new ReclassificationInputError("max rows must be an integer between 1 and 40");
  }
  if (!["all_auto", "low_confidence", "low_or_medium_confidence"].includes(input.policy)) {
    throw new ReclassificationInputError("unknown reclassification policy");
  }

  const preflight = await withRequestScope(input.ownerClerkUserId, async (tx) => {
    const owner = await ownerFor(tx, input.ownerClerkUserId);
    const [row] = await tx
      .select({ id: transactions.id })
      .from(transactions)
      .where(eligible(owner.id, input.policy))
      .limit(1);
    return Boolean(row);
  });
  if (!preflight) return { status: "no_candidates", attempted: 0, proposed: 0, skipped: 0 };

  const request = captureClassificationRequest();
  const admitted = await withRequestScope(input.ownerClerkUserId, async (tx) => {
    const owner = await ownerFor(tx, input.ownerClerkUserId);
    const leaves = await taxonomyFor(tx, owner.id);
    if (leaves.length === 0) throw new ReclassificationStateError("owner has no assignable categories");
    const fingerprint = taxonomyFingerprint(leaves);
    const runId = await claimInferenceRun(tx, {
      ownerUserId: owner.id,
      kind: "automatic_reclassification",
      operatorActor: input.operatorActor,
      expiresAt: new Date(Date.now() + RECLASSIFICATION_EXPIRY_HOURS * 60 * 60 * 1_000),
      requestedModel: request.requestedModel,
      promptVersion: request.promptVersion,
      assignmentSchemaVersion: request.assignmentSchemaVersion,
      taxonomyFingerprint: fingerprint,
      providerPolicyFingerprint: request.providerPolicyFingerprint,
      batchSize: input.maxRows,
    });
    const selected = await tx
      .select(candidateSelection)
      .from(transactions)
      .where(eligible(owner.id, input.policy))
      .orderBy(desc(transactions.date), desc(transactions.createdAt), desc(transactions.id))
      .limit(input.maxRows);
    if (selected.length === 0) {
      await tx
        .update(classificationRuns)
        .set({ status: "cancelled", updatedAt: sql`clock_timestamp()` })
        .where(and(eq(classificationRuns.id, runId), eq(classificationRuns.status, "inferring")));
      return { ownerUserId: owner.id, runId: null, leaves, fingerprint, batch: [] as Candidate[] };
    }
    await tx
      .update(classificationRuns)
      .set({ attempted: selected.length })
      .where(and(eq(classificationRuns.id, runId), eq(classificationRuns.status, "inferring")));
    return {
      ownerUserId: owner.id,
      runId,
      leaves,
      fingerprint,
      batch: selected.map(candidateFrom),
    };
  });
  if (!admitted.runId) return { status: "no_candidates", attempted: 0, proposed: 0, skipped: 0 };
  const runId = admitted.runId;

  const failRun = () => withRequestScope(input.ownerClerkUserId, (tx) =>
    failLiveInferenceRun(tx, admitted.ownerUserId, runId));

  let result: Awaited<ReturnType<typeof request.classify>>;
  try {
    result = await request.classify(
      admitted.batch.map((row) => ({
        description: row.description,
        merchant: row.merchant,
        direction: row.amountMinor >= 0 ? "in" : "out",
      })),
      admitted.leaves.map((leaf) => leaf.label),
    );
  } catch (error) {
    await failRun();
    throw error;
  }

  const finalized = await withRequestScope(input.ownerClerkUserId, async (tx) => {
    if (!(await lockLiveInferenceRun(tx, admitted.ownerUserId, runId))) return null;
    const currentLeaves = await taxonomyFor(tx, admitted.ownerUserId);
    await tx
      .select({ id: transactions.id })
      .from(transactions)
      .where(and(
        eq(transactions.userId, admitted.ownerUserId),
        inArray(transactions.id, admitted.batch.map((row) => row.id)),
      ))
      .orderBy(asc(transactions.id))
      .for("update");
    if (!(await lockLiveInferenceRun(tx, admitted.ownerUserId, runId))) {
      await tx
        .update(classificationRuns)
        .set({ status: "expired", updatedAt: sql`clock_timestamp()` })
        .where(and(
          eq(classificationRuns.id, runId),
          eq(classificationRuns.status, "inferring"),
          sql`${classificationRuns.inferenceLeaseUntil} <= clock_timestamp()`,
        ));
      return null;
    }
    const currentRows = await tx
      .select(candidateSelection)
      .from(transactions)
      .where(
        and(
          eq(transactions.userId, admitted.ownerUserId),
          inArray(transactions.id, admitted.batch.map((row) => row.id)),
          unpaired,
        ),
      )
      .orderBy(desc(transactions.date), desc(transactions.createdAt), desc(transactions.id))
      .for("update");
    const beforeById = new Map(admitted.batch.map((row) => [row.id, row]));
    const snapshotsMatch = currentRows.length === admitted.batch.length
      && currentRows.every((row) => {
        const current = candidateIfEligible(row);
        const before = beforeById.get(row.id);
        return Boolean(current && before && sameCandidate(current, before));
      });
    if (taxonomyFingerprint(currentLeaves) !== admitted.fingerprint || !snapshotsMatch) {
      await tx
        .update(classificationRuns)
        .set({ status: "failed", updatedAt: sql`clock_timestamp()` })
        .where(and(eq(classificationRuns.id, runId), eq(classificationRuns.status, "inferring")));
      return { stale: true as const };
    }

    const values = result.assignments.map((assignment) => {
      const before = admitted.batch[assignment.item];
      const proposed = admitted.leaves[assignment.category];
      return {
        runId,
        ownerUserId: admitted.ownerUserId,
        transactionId: before.id,
        proposedCategoryId: proposed.id,
        proposedConfidence: assignment.confidence,
        proposedReason: assignment.reason,
        beforeCategoryId: before.categoryId,
        beforeCategorySource: before.categorySource,
        beforeCategoryConfidence: before.categoryConfidence,
        beforeCategoryReason: before.categoryReason,
        beforeCategoryRunId: before.categoryRunId,
        beforeCategoryRevision: before.categoryRevision,
        beforeUpdatedAt: before.updatedAt,
      };
    });
    if (values.length > 0) await tx.insert(classificationProposals).values(values);
    const proposals = await tx
      .select(hashedProposalSelection)
      .from(classificationProposals)
      .where(and(
        eq(classificationProposals.ownerUserId, admitted.ownerUserId),
        eq(classificationProposals.runId, runId),
      ));
    const runIdentity = {
      id: runId,
      requestedModel: request.requestedModel,
      promptVersion: request.promptVersion,
      assignmentSchemaVersion: request.assignmentSchemaVersion,
      taxonomyFingerprint: admitted.fingerprint,
      providerPolicyFingerprint: request.providerPolicyFingerprint,
    };
    const approvalHash = proposalSetHash(runIdentity, proposals as HashedProposal[]);
    await tx
      .update(classificationRuns)
      .set({
        status: "proposed",
        responseModel: result.metadata.responseModel,
        proposalSetHash: approvalHash,
        proposed: proposals.length,
        skipped: admitted.batch.length - proposals.length,
        providerInputTokens: result.metadata.providerInputTokens,
        providerOutputTokens: result.metadata.providerOutputTokens,
        providerGenerationId: result.metadata.providerGenerationId,
        updatedAt: sql`clock_timestamp()`,
      })
      .where(and(eq(classificationRuns.id, runId), eq(classificationRuns.status, "inferring")));
    return { stale: false as const, approvalHash, proposals: proposals.length };
  });
  if (!finalized || finalized.stale) {
    throw new ReclassificationStaleError("reclassification snapshot changed before proposal completion");
  }
  return {
    status: "proposed",
    runId,
    approvalHash: finalized.approvalHash,
    requestedModel: request.requestedModel,
    taxonomyFingerprint: admitted.fingerprint,
    attempted: admitted.batch.length,
    proposed: finalized.proposals,
    skipped: admitted.batch.length - finalized.proposals,
    providerInputTokens: result.metadata.providerInputTokens,
    providerOutputTokens: result.metadata.providerOutputTokens,
  };
}

type StoredRun = typeof classificationRuns.$inferSelect;

async function lockedRun(
  tx: ScopedTx,
  ownerUserId: string,
  runId: string,
): Promise<StoredRun> {
  const [run] = await tx
    .select({
      ...getTableColumns(classificationRuns),
    })
    .from(classificationRuns)
    .where(and(eq(classificationRuns.id, runId), eq(classificationRuns.ownerUserId, ownerUserId)))
    .for("update");
  if (!run || run.kind !== "automatic_reclassification") {
    throw new ReclassificationNotFoundError("run not found");
  }
  return run;
}

async function proposalExpired(tx: ScopedTx, ownerUserId: string, runId: string): Promise<boolean> {
  const [fresh] = await tx
    .select({ expired: sql<boolean>`${classificationRuns.expiresAt} <= clock_timestamp()` })
    .from(classificationRuns)
    .where(and(eq(classificationRuns.id, runId), eq(classificationRuns.ownerUserId, ownerUserId)));
  return !fresh || fresh.expired;
}

async function storedProposals(tx: ScopedTx, ownerUserId: string, runId: string) {
  return tx
    .select({
      id: classificationProposals.id,
      state: classificationProposals.state,
      appliedCategoryRevision: classificationProposals.appliedCategoryRevision,
      appliedUpdatedAt: sql<string | null>`${classificationProposals.appliedUpdatedAt}::text`,
      ...hashedProposalSelection,
    })
    .from(classificationProposals)
    .where(and(
      eq(classificationProposals.ownerUserId, ownerUserId),
      eq(classificationProposals.runId, runId),
    ))
    .orderBy(classificationProposals.transactionId)
    .for("update");
}

function assertProposalSet(run: StoredRun, proposals: HashedProposal[], suppliedHash: string): void {
  if (run.proposed < 1
    || proposals.length !== run.proposed
    || proposals.some((proposal) => proposal.beforeCategorySource !== "auto")) {
    throw new ReclassificationStateError("proposal set is incomplete");
  }
  const rebuilt = proposalSetHash(hashedRun(run), proposals);
  if (!sameHash(run.proposalSetHash, suppliedHash) || !sameHash(rebuilt, suppliedHash)) {
    throw new ReclassificationStateError("proposal set hash does not match");
  }
}

export async function applyReclassification(input: OperatorScope & {
  runId: string;
  approvalHash: string;
}) {
  validateScope(input);
  validateRunId(input.runId);
  validateHash(input.approvalHash);

  return withRequestScope(input.ownerClerkUserId, async (tx) => {
    const owner = await ownerFor(tx, input.ownerClerkUserId);
    const run = await lockedRun(tx, owner.id, input.runId);
    if (run.operatorActor !== input.operatorActor || run.status !== "proposed") {
      throw new ReclassificationStateError("run is not an unexpired proposal for this operator");
    }
    const proposals = await storedProposals(tx, owner.id, run.id);
    assertProposalSet(run, proposals as HashedProposal[], input.approvalHash);
    if (proposals.some((proposal) => proposal.state !== "proposed")) {
      throw new ReclassificationStateError("proposal set has already been consumed");
    }
    const leaves = await taxonomyFor(tx, owner.id);
    if (taxonomyFingerprint(leaves) !== run.taxonomyFingerprint) {
      throw new ReclassificationStateError("taxonomy changed after proposal creation");
    }
    const leafIds = new Set(leaves.map((leaf) => leaf.id));
    if (proposals.some((proposal) => !leafIds.has(proposal.proposedCategoryId))) {
      throw new ReclassificationStateError("proposal contains a non-leaf category");
    }
    await tx
      .select({ id: transactions.id })
      .from(transactions)
      .where(and(
        eq(transactions.userId, owner.id),
        inArray(transactions.id, proposals.map((proposal) => proposal.transactionId)),
      ))
      .orderBy(asc(transactions.id))
      .for("update");
    if (await proposalExpired(tx, owner.id, run.id)) {
      throw new ReclassificationStateError("run is not an unexpired proposal for this operator");
    }

    let applied = 0;
    let conflicted = 0;
    for (const proposal of proposals) {
      const [updated] = await tx
        .update(transactions)
        .set({
          categoryId: proposal.proposedCategoryId,
          categorySource: "auto",
          categoryConfidence: proposal.proposedConfidence,
          categoryReason: proposal.proposedReason,
          categoryRunId: run.id,
          categoryRevision: sql`${transactions.categoryRevision} + 1`,
          updatedAt: sql`clock_timestamp()`,
        })
        .where(and(
          eq(transactions.id, proposal.transactionId),
          eq(transactions.userId, owner.id),
          eq(transactions.categorySource, "auto"),
          sql`${transactions.categoryId} is not distinct from ${proposal.beforeCategoryId}::uuid`,
          sql`${transactions.categoryConfidence} is not distinct from ${proposal.beforeCategoryConfidence}`,
          sql`${transactions.categoryReason} is not distinct from ${proposal.beforeCategoryReason}`,
          sql`${transactions.categoryRunId} is not distinct from ${proposal.beforeCategoryRunId}::uuid`,
          eq(transactions.categoryRevision, proposal.beforeCategoryRevision),
          sql`${transactions.updatedAt} = ${proposal.beforeUpdatedAt}::timestamptz`,
          unpaired,
        ))
        .returning({
          revision: transactions.categoryRevision,
          updatedAt: sql<string>`${transactions.updatedAt}::text`,
        });
      if (updated) {
        applied += 1;
        await tx
          .update(classificationProposals)
          .set({
            state: "applied",
            appliedCategoryRevision: updated.revision,
            appliedUpdatedAt: updated.updatedAt,
            appliedAt: sql`clock_timestamp()`,
            updatedAt: sql`clock_timestamp()`,
          })
          .where(and(
            eq(classificationProposals.id, proposal.id),
            eq(classificationProposals.state, "proposed"),
          ));
      } else {
        conflicted += 1;
        await tx
          .update(classificationProposals)
          .set({
            state: "conflicted",
            conflictedAt: sql`clock_timestamp()`,
            updatedAt: sql`clock_timestamp()`,
          })
          .where(and(
            eq(classificationProposals.id, proposal.id),
            eq(classificationProposals.state, "proposed"),
          ));
      }
    }
    const status = conflicted === 0 ? "applied" : "partially_applied";
    await tx
      .update(classificationRuns)
      .set({
        status,
        applied,
        conflicted,
        approvedAt: sql`clock_timestamp()`,
        appliedAt: sql`clock_timestamp()`,
        updatedAt: sql`clock_timestamp()`,
      })
      .where(and(eq(classificationRuns.id, run.id), eq(classificationRuns.status, "proposed")));
    return { runId: run.id, status, applied, conflicted };
  });
}

export async function rollbackReclassification(input: OperatorScope & {
  runId: string;
  confirm: true;
}) {
  validateScope(input);
  validateRunId(input.runId);
  if (input.confirm !== true) {
    throw new ReclassificationInputError("rollback requires explicit confirmation");
  }

  return withRequestScope(input.ownerClerkUserId, async (tx) => {
    const owner = await ownerFor(tx, input.ownerClerkUserId);
    const run = await lockedRun(tx, owner.id, input.runId);
    if (run.operatorActor !== input.operatorActor
      || (run.status !== "applied" && run.status !== "partially_applied")) {
      throw new ReclassificationStateError("run is not rollbackable for this operator");
    }
    const proposals = await storedProposals(tx, owner.id, run.id);
    if (run.proposed < 1 || proposals.length !== run.proposed) {
      throw new ReclassificationStateError("proposal set is incomplete");
    }
    const rebuiltHash = proposalSetHash(hashedRun(run), proposals);
    if (!sameHash(run.proposalSetHash, rebuiltHash)
      || proposals.some((row) => row.beforeCategorySource !== "auto"
        || (row.state !== "applied" && row.state !== "conflicted"))) {
      throw new ReclassificationStateError("proposal set is not a completed apply result");
    }

    const appliedProposals = proposals.filter((row) => row.state === "applied");
    if (appliedProposals.length > 0) {
      await tx
        .select({ id: transactions.id })
        .from(transactions)
        .where(and(
          eq(transactions.userId, owner.id),
          inArray(transactions.id, appliedProposals.map((proposal) => proposal.transactionId)),
        ))
        .orderBy(asc(transactions.id))
        .for("update");
    }
    let rolledBack = 0;
    let rollbackConflicts = 0;
    for (const proposal of appliedProposals) {
      if (proposal.appliedCategoryRevision === null || proposal.appliedUpdatedAt === null) {
        throw new ReclassificationStateError("applied proposal has no complete database snapshot");
      }
      const [updated] = await tx
        .update(transactions)
        .set({
          categoryId: proposal.beforeCategoryId,
          categorySource: proposal.beforeCategorySource,
          categoryConfidence: proposal.beforeCategoryConfidence,
          categoryReason: proposal.beforeCategoryReason,
          categoryRunId: proposal.beforeCategoryRunId,
          categoryRevision: sql`${transactions.categoryRevision} + 1`,
          updatedAt: sql`clock_timestamp()`,
        })
        .where(and(
          eq(transactions.id, proposal.transactionId),
          eq(transactions.userId, owner.id),
          eq(transactions.categorySource, "auto"),
          eq(transactions.categoryId, proposal.proposedCategoryId),
          eq(transactions.categoryConfidence, proposal.proposedConfidence),
          eq(transactions.categoryReason, proposal.proposedReason),
          eq(transactions.categoryRunId, run.id),
          eq(transactions.categoryRevision, proposal.appliedCategoryRevision),
          sql`${transactions.updatedAt} = ${proposal.appliedUpdatedAt}::timestamptz`,
          unpaired,
        ))
        .returning({ id: transactions.id });
      if (updated) {
        rolledBack += 1;
        await tx
          .update(classificationProposals)
          .set({
            state: "rolled_back",
            rolledBackAt: sql`clock_timestamp()`,
            updatedAt: sql`clock_timestamp()`,
          })
          .where(and(
            eq(classificationProposals.id, proposal.id),
            eq(classificationProposals.state, "applied"),
          ));
      } else {
        rollbackConflicts += 1;
        await tx
          .update(classificationProposals)
          .set({
            state: "rollback_conflict",
            conflictedAt: sql`clock_timestamp()`,
            updatedAt: sql`clock_timestamp()`,
          })
          .where(and(
            eq(classificationProposals.id, proposal.id),
            eq(classificationProposals.state, "applied"),
          ));
      }
    }
    const status = rollbackConflicts === 0 ? "rolled_back" : "partially_rolled_back";
    await tx
      .update(classificationRuns)
      .set({
        status,
        conflicted: run.conflicted + rollbackConflicts,
        updatedAt: sql`clock_timestamp()`,
      })
      .where(and(
        eq(classificationRuns.id, run.id),
        or(eq(classificationRuns.status, "applied"), eq(classificationRuns.status, "partially_applied")),
      ));
    return { runId: run.id, status, rolledBack, conflicted: rollbackConflicts };
  });
}

export async function reclassificationRunSummary(input: OperatorScope & { runId: string }) {
  validateScope(input);
  validateRunId(input.runId);
  return withRequestScope(input.ownerClerkUserId, async (tx) => {
    const owner = await ownerFor(tx, input.ownerClerkUserId);
    const [run] = await tx
      .select({
        id: classificationRuns.id,
        status: classificationRuns.status,
        requestedModel: classificationRuns.requestedModel,
        responseModel: classificationRuns.responseModel,
        promptVersion: classificationRuns.promptVersion,
        assignmentSchemaVersion: classificationRuns.assignmentSchemaVersion,
        taxonomyFingerprint: classificationRuns.taxonomyFingerprint,
        providerPolicyFingerprint: classificationRuns.providerPolicyFingerprint,
        proposalSetHash: classificationRuns.proposalSetHash,
        attempted: classificationRuns.attempted,
        proposed: classificationRuns.proposed,
        applied: classificationRuns.applied,
        skipped: classificationRuns.skipped,
        conflicted: classificationRuns.conflicted,
        providerInputTokens: classificationRuns.providerInputTokens,
        providerOutputTokens: classificationRuns.providerOutputTokens,
        operatorActor: classificationRuns.operatorActor,
      })
      .from(classificationRuns)
      .where(and(eq(classificationRuns.id, input.runId), eq(classificationRuns.ownerUserId, owner.id)));
    if (!run || run.operatorActor !== input.operatorActor) {
      throw new ReclassificationNotFoundError("run not found");
    }
    return {
      id: run.id,
      status: run.status,
      requestedModel: run.requestedModel,
      responseModel: run.responseModel,
      promptVersion: run.promptVersion,
      assignmentSchemaVersion: run.assignmentSchemaVersion,
      taxonomyFingerprint: run.taxonomyFingerprint,
      providerPolicyFingerprint: run.providerPolicyFingerprint,
      proposalSetHash: run.proposalSetHash,
      attempted: run.attempted,
      proposed: run.proposed,
      applied: run.applied,
      skipped: run.skipped,
      conflicted: run.conflicted,
      providerInputTokens: run.providerInputTokens,
      providerOutputTokens: run.providerOutputTokens,
    };
  });
}
