import { and, eq, sql } from "drizzle-orm";
import { beforeEach, expect, test } from "vitest";

import { autoCategorizeBatch, InferenceBusyError } from "@/lib/data/auto-categorize";
import { listCategoryGroups, setTransactionCategory } from "@/lib/data/categories";
import { updateManualTransaction } from "@/lib/data/manual-transactions";
import {
  applyReclassification,
  proposeReclassification,
  ReclassificationNotFoundError,
  ReclassificationStaleError,
  ReclassificationStateError,
  reclassificationRunSummary,
  rollbackReclassification,
} from "@/lib/data/reclassification";
import { requireUser } from "@/lib/data/users";
import { withRequestScope, type ScopedTx } from "@/lib/db/client";
import {
  accounts,
  categories,
  classificationProposals,
  classificationRuns,
  transactions,
  transferPairs,
  users,
} from "@/lib/db/schema";
import { DEFAULT_CATEGORIES } from "@/lib/ledger/default-categories";
import { fakeClerkUserId, withAuth } from "../harness/clerk";
import { adminDb } from "../harness/db";
import {
  classificationRequests,
  failNextClassification,
  onceBeforeClassificationResponse,
  primeClassification,
  resetOpenRouterSubstitute,
} from "../harness/openrouter";

beforeEach(resetOpenRouterSubstitute);

const OPERATOR = "ops:test-reclassification";
const LABELS = DEFAULT_CATEGORIES.flatMap(({ group, categories: names }) =>
  names.map((name) => `${group} > ${name}`),
);

const labelIndex = (name: string) => {
  const index = LABELS.findIndex((label) => label.endsWith(`> ${name}`));
  if (index < 0) throw new Error(`no default leaf named ${name}`);
  return index;
};

type Fixture = Awaited<ReturnType<typeof fixture>>;

async function fixture(clerkUserId = fakeClerkUserId()) {
  const user = await withAuth(clerkUserId, () => requireUser());
  const groups = await withAuth(clerkUserId, () => listCategoryGroups());
  const leaf = (name: string) => {
    const found = groups.flatMap((group) => group.categories).find((row) => row.name === name);
    if (!found) throw new Error(`missing leaf ${name}`);
    return found.id;
  };
  const [account] = await adminDb()
    .insert(accounts)
    .values({
      userId: user.id,
      name: "Reclassification Checking",
      type: "depository",
      currency: "USD",
      source: "manual",
    })
    .returning({ id: accounts.id });
  return { clerkUserId, user, account, leaf };
}

async function addTransaction(
  owner: Fixture,
  values: Partial<typeof transactions.$inferInsert> & { description: string },
) {
  const [row] = await adminDb()
    .insert(transactions)
    .values({
      userId: owner.user.id,
      accountId: owner.account.id,
      amountMinor: -1299,
      currency: "USD",
      date: "2026-09-10",
      status: "posted",
      source: "manual",
      ...values,
    })
    .returning({ id: transactions.id });
  return row.id;
}

const addAuto = (owner: Fixture, description = "STALE AUTOMATIC VENDOR") =>
  addTransaction(owner, {
    description,
    categoryId: owner.leaf("Miscellaneous"),
    categorySource: "auto",
    categoryConfidence: "low",
    categoryReason: "Original automatic choice",
    categoryRevision: 7,
  });

const propose = async (owner: Fixture, category = "Groceries") => {
  primeClassification([
    { item: 0, category: labelIndex(category), confidence: "high", reason: "Replacement choice" },
  ]);
  const result = await proposeReclassification({
    ownerClerkUserId: owner.clerkUserId,
    operatorActor: OPERATOR,
    maxRows: 1,
    policy: "all_auto",
  });
  if (result.status !== "proposed") throw new Error("expected a proposal run");
  return result;
};

async function categoryState(transactionId: string) {
  const [row] = await adminDb()
    .select({
      categoryId: transactions.categoryId,
      source: transactions.categorySource,
      confidence: transactions.categoryConfidence,
      reason: transactions.categoryReason,
      runId: transactions.categoryRunId,
      revision: transactions.categoryRevision,
      updatedAt: sql<string>`${transactions.updatedAt}::text`,
    })
    .from(transactions)
    .where(eq(transactions.id, transactionId));
  return row;
}

async function waitUntil(predicate: () => Promise<boolean>, message: string): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  throw new Error(message);
}

async function waitForBlocking(pid: number, message: string): Promise<void> {
  await waitUntil(async () => {
    const result = await adminDb().execute(sql`
      select exists (
        select 1 from pg_stat_activity where ${pid} = any(pg_blocking_pids(pid))
      ) as blocking
    `);
    return Boolean((result.rows[0] as { blocking: boolean }).blocking);
  }, message);
}

async function waitUntilBlocked(pid: number, message: string, clerkUserId: string): Promise<void> {
  await waitUntil(async () => withRequestScope(clerkUserId, async (tx) => {
    const result = await tx.execute(sql`
      select cardinality(pg_blocking_pids(pid)) > 0 as blocked
      from pg_stat_activity where pid = ${pid}
    `);
    return Boolean((result.rows[0] as { blocked?: boolean } | undefined)?.blocked);
  }), message);
}

async function holdDbLock(acquire: (tx: ScopedTx) => Promise<unknown>) {
  let signalReady!: (pid: number) => void;
  let signalRelease = () => {};
  const ready = new Promise<number>((resolve) => { signalReady = resolve; });
  const releaseSignal = new Promise<void>((resolve) => { signalRelease = resolve; });
  const completion = adminDb().transaction(async (tx) => {
    const result = await tx.execute(sql`select pg_backend_pid() as pid`);
    const pid = Number((result.rows[0] as { pid: number }).pid);
    await acquire(tx);
    signalReady(pid);
    await releaseSignal;
  });
  const pid = await ready;
  let released = false;
  return {
    pid,
    release: async () => {
      if (!released) {
        released = true;
        signalRelease();
      }
      await completion;
    },
  };
}

async function startDbOperation(operation: (tx: ScopedTx) => Promise<unknown>) {
  let signalStarted!: (pid: number) => void;
  const started = new Promise<number>((resolve) => { signalStarted = resolve; });
  const completion = adminDb().transaction(async (tx) => {
    const result = await tx.execute(sql`select pg_backend_pid() as pid`);
    signalStarted(Number((result.rows[0] as { pid: number }).pid));
    await operation(tx);
  });
  return { pid: await started, completion };
}

test("proposal is automatic-only, confidence-bounded, unpaired, durable, and ledger-read-only", async () => {
  const owner = await fixture();
  const selected = await addAuto(owner, "LOW AUTO");
  const high = await addTransaction(owner, {
    description: "HIGH AUTO",
    date: "2026-09-09",
    categoryId: owner.leaf("Restaurants & Bars"),
    categorySource: "auto",
    categoryConfidence: "high",
    categoryReason: "Original high choice",
  });
  const manual = await addTransaction(owner, {
    description: "MANUAL",
    categoryId: owner.leaf("Coffee Shops"),
    categorySource: "user",
  });
  const legacy = await addTransaction(owner, {
    description: "LEGACY",
    categoryId: owner.leaf("Gifts"),
    categorySource: null,
  });
  const paired = await addAuto(owner, "PAIRED AUTO");
  const counterpart = await addTransaction(owner, { description: "PAIR COUNTERPART", amountMinor: 1299 });
  await adminDb().insert(transferPairs).values({
    userId: owner.user.id,
    outflowTransactionId: paired,
    inflowTransactionId: counterpart,
  });
  await adminDb().execute(sql`
    update transactions
    set updated_at = '2026-09-10 12:34:56.123456+00'::timestamptz
    where id = ${selected}
  `);
  const before = await Promise.all([selected, high, manual, legacy, paired].map(categoryState));

  primeClassification([
    { item: 0, category: labelIndex("Groceries"), confidence: "medium", reason: "New choice" },
  ]);
  const result = await proposeReclassification({
    ownerClerkUserId: owner.clerkUserId,
    operatorActor: OPERATOR,
    maxRows: 40,
    policy: "low_confidence",
  });

  expect(result).toMatchObject({ status: "proposed", attempted: 1, proposed: 1, skipped: 0 });
  expect(classificationRequests).toHaveLength(1);
  expect(await Promise.all([selected, high, manual, legacy, paired].map(categoryState))).toEqual(before);
  const proposals = await adminDb()
    .select({
      transactionId: classificationProposals.transactionId,
      beforeUpdatedAt: sql<string>`${classificationProposals.beforeUpdatedAt}::text`,
      beforeRevision: classificationProposals.beforeCategoryRevision,
    })
    .from(classificationProposals);
  expect(proposals).toEqual([{
    transactionId: selected,
    beforeUpdatedAt: before[0].updatedAt,
    beforeRevision: 7,
  }]);
  expect(proposals[0].beforeUpdatedAt).toContain(".123456");
  expect(JSON.stringify(await reclassificationRunSummary({
    ownerClerkUserId: owner.clerkUserId,
    operatorActor: OPERATOR,
    runId: result.status === "proposed" ? result.runId : "",
  }))).not.toContain("LOW AUTO");
});

test("apply uses the exact stored proposal without a model read and rollback restores the before tuple", async () => {
  const owner = await fixture();
  const transactionId = await addAuto(owner);
  const [priorRun] = await adminDb()
    .insert(classificationRuns)
    .values({
      ownerUserId: owner.user.id,
      kind: "automatic_initial",
      status: "succeeded",
      requestedModel: "prior/model",
      promptVersion: "prior-prompt",
      assignmentSchemaVersion: "prior-schema",
      taxonomyFingerprint: "a".repeat(64),
      providerPolicyFingerprint: "b".repeat(64),
      batchSize: 1,
      attempted: 1,
      applied: 1,
      inferenceLeaseUntil: sql`clock_timestamp()`,
    })
    .returning({ id: classificationRuns.id });
  await adminDb().execute(sql`
    update transactions
    set category_run_id = ${priorRun.id},
        updated_at = '2026-09-10 12:34:56.654321+00'::timestamptz
    where id = ${transactionId}
  `);
  const before = await categoryState(transactionId);
  expect(before.runId).toBe(priorRun.id);
  expect(before.updatedAt).toContain(".654321");
  const proposed = await propose(owner, "Groceries");
  const requestsAfterProposal = classificationRequests.length;
  const savedModel = process.env.LLM_MODEL;
  process.env.LLM_MODEL = "different/model-that-must-not-be-read";
  try {
    await expect(applyReclassification({
      ownerClerkUserId: owner.clerkUserId,
      operatorActor: OPERATOR,
      runId: proposed.runId,
      approvalHash: proposed.approvalHash,
    })).resolves.toEqual({
      runId: proposed.runId,
      status: "applied",
      applied: 1,
      conflicted: 0,
    });
    expect(classificationRequests).toHaveLength(requestsAfterProposal);

    const applied = await categoryState(transactionId);
    expect(applied).toMatchObject({
      categoryId: owner.leaf("Groceries"),
      source: "auto",
      confidence: "high",
      reason: "Replacement choice",
      runId: proposed.runId,
      revision: before.revision + 1,
    });
    const [audit] = await adminDb()
      .select({
        revision: classificationProposals.appliedCategoryRevision,
        updatedAt: sql<string>`${classificationProposals.appliedUpdatedAt}::text`,
      })
      .from(classificationProposals);
    expect(audit).toEqual({ revision: applied.revision, updatedAt: applied.updatedAt });

    await expect(rollbackReclassification({
      ownerClerkUserId: owner.clerkUserId,
      operatorActor: OPERATOR,
      runId: proposed.runId,
      confirm: true,
    })).resolves.toEqual({
      runId: proposed.runId,
      status: "rolled_back",
      rolledBack: 1,
      conflicted: 0,
    });
    expect(await categoryState(transactionId)).toMatchObject({
      categoryId: before.categoryId,
      source: before.source,
      confidence: before.confidence,
      reason: before.reason,
      runId: before.runId,
      revision: before.revision + 2,
    });
    expect(classificationRequests).toHaveLength(requestsAfterProposal);
  } finally {
    if (savedModel === undefined) delete process.env.LLM_MODEL;
    else process.env.LLM_MODEL = savedModel;
  }
});

test.each(["payload", "manual", "category", "transfer"] as const)(
  "a %s race aborts proposal finalization without a misleading preview",
  async (race) => {
    const owner = await fixture();
    const transactionId = await addAuto(owner);
    const companion = await addTransaction(owner, { description: "TRANSFER COMPANION", amountMinor: 1299 });
    primeClassification([
      { item: 0, category: labelIndex("Groceries"), confidence: "high", reason: "Replacement" },
    ]);
    onceBeforeClassificationResponse(async () => {
      if (race === "payload") {
        await adminDb()
          .update(transactions)
          .set({ description: "EDITED WHILE IN FLIGHT", updatedAt: sql`clock_timestamp()` })
          .where(eq(transactions.id, transactionId));
      } else if (race === "manual") {
        await withAuth(owner.clerkUserId, () =>
          setTransactionCategory(transactionId, owner.leaf("Coffee Shops")));
      } else if (race === "category") {
        await adminDb()
          .update(categories)
          .set({ name: "Renamed during inference", updatedAt: sql`clock_timestamp()` })
          .where(eq(categories.id, owner.leaf("Groceries")));
      } else {
        await adminDb().insert(transferPairs).values({
          userId: owner.user.id,
          outflowTransactionId: transactionId,
          inflowTransactionId: companion,
        });
      }
    });

    await expect(proposeReclassification({
      ownerClerkUserId: owner.clerkUserId,
      operatorActor: OPERATOR,
      maxRows: 1,
      policy: "all_auto",
    })).rejects.toBeInstanceOf(ReclassificationStaleError);
    await expect(adminDb().$count(classificationProposals)).resolves.toBe(0);
    const [run] = await adminDb().select({ status: classificationRuns.status }).from(classificationRuns);
    expect(run.status).toBe("failed");
    if (race === "manual") {
      await addAuto(owner, "IMMEDIATE RETRY");
      await expect(propose(owner)).resolves.toMatchObject({ status: "proposed" });
    }
  },
);

test.each(["transaction", "run"] as const)(
  "proposal finalization rechecks its lease after waiting for the %s row",
  async (lockedRow) => {
  const owner = await fixture();
  const transactionId = await addAuto(owner);
  let monitor: Promise<void> | undefined;
  primeClassification([
    { item: 0, category: labelIndex("Groceries"), confidence: "high", reason: "Replacement" },
  ]);
  onceBeforeClassificationResponse(async () => {
    const [run] = await adminDb()
      .select({ id: classificationRuns.id })
      .from(classificationRuns)
      .where(and(
        eq(classificationRuns.ownerUserId, owner.user.id),
        eq(classificationRuns.status, "inferring"),
      ));
    await adminDb()
      .update(classificationRuns)
      .set({ inferenceLeaseUntil: sql`clock_timestamp() + interval '1 second'` })
      .where(eq(classificationRuns.id, run.id));

    const held = await holdDbLock((tx) => lockedRow === "run"
      ? tx
        .select({ id: classificationRuns.id })
        .from(classificationRuns)
        .where(eq(classificationRuns.id, run.id))
        .for("update")
      : tx
        .select({ id: transactions.id })
        .from(transactions)
        .where(eq(transactions.id, transactionId))
        .for("update"));
    monitor = (async () => {
      try {
        await waitForBlocking(held.pid, `proposal finalizer never waited for the ${lockedRow} row`);
        await waitUntil(async () => {
          const result = await adminDb().execute(sql`
            select inference_lease_until <= clock_timestamp() as expired
            from classification_runs where id = ${run.id}
          `);
          return Boolean((result.rows[0] as { expired: boolean }).expired);
        }, `proposal lease did not expire while waiting for its ${lockedRow} row`);
      } finally {
        await held.release();
      }
    })();
  });

  await expect(proposeReclassification({
    ownerClerkUserId: owner.clerkUserId,
    operatorActor: OPERATOR,
    maxRows: 1,
    policy: "all_auto",
  })).rejects.toBeInstanceOf(ReclassificationStaleError);
  await monitor;
  await expect(adminDb().$count(classificationProposals)).resolves.toBe(0);
  await expect(propose(owner)).resolves.toMatchObject({ status: "proposed" });
  const runs = await adminDb()
    .select({ status: classificationRuns.status })
    .from(classificationRuns)
    .orderBy(classificationRuns.createdAt);
  expect(runs).toEqual([{ status: "expired" }, { status: "proposed" }]);
  },
);

test("apply rechecks proposal expiry after waiting for all target-row locks", async () => {
  const owner = await fixture();
  const transactionId = await addAuto(owner);
  const proposed = await propose(owner);
  await adminDb()
    .update(classificationRuns)
    .set({ expiresAt: sql`clock_timestamp() + interval '1 second'` })
    .where(eq(classificationRuns.id, proposed.runId));

  const held = await holdDbLock((tx) => tx
      .select({ id: transactions.id })
      .from(transactions)
      .where(eq(transactions.id, transactionId))
      .for("update"));
  const before = await categoryState(transactionId);
  const applying = applyReclassification({
    ownerClerkUserId: owner.clerkUserId,
    operatorActor: OPERATOR,
    runId: proposed.runId,
    approvalHash: proposed.approvalHash,
  });
  try {
    await waitForBlocking(held.pid, "apply never waited for the target row");
    await waitUntil(async () => {
      const result = await adminDb().execute(sql`
        select expires_at <= clock_timestamp() as expired
        from classification_runs where id = ${proposed.runId}
      `);
      return Boolean((result.rows[0] as { expired: boolean }).expired);
    }, "proposal did not expire while apply was blocked");
  } finally {
    await held.release();
  }
  await expect(applying).rejects.toBeInstanceOf(ReclassificationStateError);
  expect(await categoryState(transactionId)).toEqual(before);
});

test("a concurrent transfer insert wins its FK-lock race with apply and becomes a conflict", async () => {
  const owner = await fixture();
  const transactionId = await addAuto(owner);
  const companion = await addTransaction(owner, { description: "PAIR IN", amountMinor: 1299 });
  const proposed = await propose(owner);
  const held = await holdDbLock((tx) => tx.insert(transferPairs).values({
      userId: owner.user.id,
      outflowTransactionId: transactionId,
      inflowTransactionId: companion,
    }));
  const before = await categoryState(transactionId);
  const applying = applyReclassification({
    ownerClerkUserId: owner.clerkUserId,
    operatorActor: OPERATOR,
    runId: proposed.runId,
    approvalHash: proposed.approvalHash,
  });
  try {
    await waitForBlocking(held.pid, "apply never waited for the transfer FK lock");
  } finally {
    await held.release();
  }
  await expect(applying).resolves.toEqual({
    runId: proposed.runId,
    status: "partially_applied",
    applied: 0,
    conflicted: 1,
  });
  expect(await categoryState(transactionId)).toEqual(before);
});

test.each(["rename", "root insert"] as const)(
  "the categories trigger blocks a same-owner %s until proposal finalization commits",
  async (mutation) => {
    const owner = await fixture();
    const transactionId = await addAuto(owner);
    let monitor: Promise<void> | undefined;
    primeClassification([
      { item: 0, category: labelIndex("Groceries"), confidence: "high", reason: "Replacement" },
    ]);
    onceBeforeClassificationResponse(async () => {
      const held = await holdDbLock((tx) => tx
        .select({ id: transactions.id })
        .from(transactions)
        .where(eq(transactions.id, transactionId))
        .for("update"));
      monitor = (async () => {
        let pending: Awaited<ReturnType<typeof startDbOperation>> | undefined;
        try {
          await waitForBlocking(held.pid, "proposal finalizer never reached its target lock");
          pending = await startDbOperation((tx) => mutation === "rename"
            ? tx
              .update(categories)
              .set({ name: "Renamed after taxonomy read" })
              .where(eq(categories.id, owner.leaf("Groceries")))
            : tx.insert(categories).values({
              userId: owner.user.id,
              name: "Late root",
              sortOrder: 999,
            }));
          await waitUntilBlocked(
            pending.pid,
            `same-owner taxonomy ${mutation} did not wait for the advisory lock`,
            owner.clerkUserId,
          );
        } finally {
          await held.release();
        }
        await pending?.completion;
      })();
    });

    const proposed = await proposeReclassification({
      ownerClerkUserId: owner.clerkUserId,
      operatorActor: OPERATOR,
      maxRows: 1,
      policy: "all_auto",
    });
    await monitor;
    expect(proposed).toMatchObject({ status: "proposed", proposed: 1 });
    if (proposed.status !== "proposed") throw new Error("expected proposal");
    if (mutation === "rename") {
      await expect(applyReclassification({
        ownerClerkUserId: owner.clerkUserId,
        operatorActor: OPERATOR,
        runId: proposed.runId,
        approvalHash: proposed.approvalHash,
      })).rejects.toBeInstanceOf(ReclassificationStateError);
    } else {
      await expect(adminDb().$count(categories, and(
        eq(categories.userId, owner.user.id),
        eq(categories.name, "Late root"),
      ))).resolves.toBe(1);
    }
  },
  15_000,
);

test("a different owner's taxonomy write is independent of proposal finalization", async () => {
  const a = await fixture();
  const b = await fixture();
  const transactionId = await addAuto(a);
  let monitor: Promise<void> | undefined;
  primeClassification([
    { item: 0, category: labelIndex("Groceries"), confidence: "high", reason: "Replacement" },
  ]);
  onceBeforeClassificationResponse(async () => {
    const held = await holdDbLock((tx) => tx
      .select({ id: transactions.id })
      .from(transactions)
      .where(eq(transactions.id, transactionId))
      .for("update"));
    monitor = (async () => {
      try {
        await waitForBlocking(held.pid, "proposal finalizer never reached its target lock");
        let completed = false;
        const pending = await startDbOperation((tx) => tx.insert(categories).values({
          userId: b.user.id,
          name: "Independent root",
          sortOrder: 999,
        }));
        const completion = pending.completion.then(() => { completed = true; });
        await waitUntil(async () => completed, "different-owner taxonomy write was blocked");
        await completion;
      } finally {
        await held.release();
      }
    })();
  });

  await expect(proposeReclassification({
    ownerClerkUserId: a.clerkUserId,
    operatorActor: OPERATOR,
    maxRows: 1,
    policy: "all_auto",
  })).resolves.toMatchObject({ status: "proposed", proposed: 1 });
  await monitor;
});

test("apply holds the owner taxonomy lock from validation through commit", async () => {
  const owner = await fixture();
  const transactionId = await addAuto(owner);
  const proposed = await propose(owner);
  const held = await holdDbLock((tx) => tx
    .select({ id: transactions.id })
    .from(transactions)
    .where(eq(transactions.id, transactionId))
    .for("update"));
  const applying = applyReclassification({
    ownerClerkUserId: owner.clerkUserId,
    operatorActor: OPERATOR,
    runId: proposed.runId,
    approvalHash: proposed.approvalHash,
  });
  await waitForBlocking(held.pid, "apply never reached its target lock");
  const rename = await startDbOperation((tx) => tx
    .update(categories)
    .set({ name: "Renamed after apply taxonomy read" })
    .where(eq(categories.id, owner.leaf("Groceries"))));
  try {
    await waitUntilBlocked(
      rename.pid,
      "taxonomy rename did not wait for apply's advisory lock",
      owner.clerkUserId,
    );
  } finally {
    await held.release();
  }
  await expect(applying).resolves.toMatchObject({ status: "applied", applied: 1 });
  await rename.completion;
  expect(await categoryState(transactionId)).toMatchObject({
    categoryId: owner.leaf("Groceries"),
    runId: proposed.runId,
  });
});

test.each(["manual", "manual-edit", "transfer", "aba", "microsecond"] as const)(
  "apply reports a %s conflict without overwriting the current row",
  async (race) => {
    const owner = await fixture();
    const transactionId = await addAuto(owner);
    const companion = await addTransaction(owner, { description: "PAIR IN", amountMinor: 1299 });
    if (race === "manual-edit") {
      await adminDb().execute(sql`
        update transactions
        set updated_at = '2026-09-10 12:34:56.123456+00'::timestamptz
        where id = ${transactionId}
      `);
    }
    const beforeProposal = await categoryState(transactionId);
    const proposed = await propose(owner);
    if (race === "manual") {
      await withAuth(owner.clerkUserId, () =>
        setTransactionCategory(transactionId, owner.leaf("Coffee Shops")));
    } else if (race === "manual-edit") {
      await withAuth(owner.clerkUserId, () =>
        updateManualTransaction(transactionId, {
          accountId: owner.account.id,
          direction: "outflow",
          amount: "13.00",
          date: "2026-09-10",
          description: "STALE AUTOMATIC VENDOR",
          merchant: null,
          categoryId: owner.leaf("Miscellaneous"),
        }));
    } else if (race === "transfer") {
      await adminDb().insert(transferPairs).values({
        userId: owner.user.id,
        outflowTransactionId: transactionId,
        inflowTransactionId: companion,
      });
    } else if (race === "aba") {
      await adminDb()
        .update(transactions)
        .set({
          categoryRevision: sql`${transactions.categoryRevision} + 2`,
        })
        .where(eq(transactions.id, transactionId));
    } else {
      await adminDb().execute(sql`
        update transactions set updated_at = updated_at + interval '1 microsecond'
        where id = ${transactionId}
      `);
    }
    const current = await categoryState(transactionId);
    if (race === "manual-edit") {
      expect({ ...current, updatedAt: beforeProposal.updatedAt }).toEqual(beforeProposal);
      expect(current.updatedAt).not.toBe(beforeProposal.updatedAt);
      await expect(
        adminDb()
          .select({ amountMinor: transactions.amountMinor })
          .from(transactions)
          .where(eq(transactions.id, transactionId)),
      ).resolves.toEqual([{ amountMinor: -1300 }]);
    }

    await expect(applyReclassification({
      ownerClerkUserId: owner.clerkUserId,
      operatorActor: OPERATOR,
      runId: proposed.runId,
      approvalHash: proposed.approvalHash,
    })).resolves.toEqual({
      runId: proposed.runId,
      status: "partially_applied",
      applied: 0,
      conflicted: 1,
    });
    expect(await categoryState(transactionId)).toEqual(current);
  },
);

test("hash tampering, taxonomy drift, expiry, missing rows, and replay all fail closed", async () => {
  const cases = ["hash", "taxonomy", "expiry", "missing"] as const;
  for (const failure of cases) {
    await adminDb().execute(sql`truncate table users restart identity cascade`);
    resetOpenRouterSubstitute();
    const owner = await fixture();
    const transactionId = await addAuto(owner);
    const proposed = await propose(owner);
    const before = await categoryState(transactionId);
    if (failure === "taxonomy") {
      await adminDb()
        .update(categories)
        .set({ name: "Changed after preview" })
        .where(eq(categories.id, owner.leaf("Groceries")));
    } else if (failure === "expiry") {
      await adminDb()
        .update(classificationRuns)
        .set({ expiresAt: sql`clock_timestamp() - interval '1 second'` })
        .where(eq(classificationRuns.id, proposed.runId));
    } else if (failure === "missing") {
      await adminDb()
        .delete(classificationProposals)
        .where(eq(classificationProposals.runId, proposed.runId));
    }
    const approvalHash = failure === "hash" ? "0".repeat(64) : proposed.approvalHash;
    await expect(applyReclassification({
      ownerClerkUserId: owner.clerkUserId,
      operatorActor: OPERATOR,
      runId: proposed.runId,
      approvalHash,
    })).rejects.toBeInstanceOf(ReclassificationStateError);
    expect(await categoryState(transactionId)).toEqual(before);
  }

  await adminDb().execute(sql`truncate table users restart identity cascade`);
  resetOpenRouterSubstitute();
  const owner = await fixture();
  await addAuto(owner);
  const proposed = await propose(owner);
  const input = {
    ownerClerkUserId: owner.clerkUserId,
    operatorActor: OPERATOR,
    runId: proposed.runId,
    approvalHash: proposed.approvalHash,
  };
  await applyReclassification(input);
  await expect(applyReclassification(input)).rejects.toBeInstanceOf(ReclassificationStateError);
});

test("a manual edit after apply wins over rollback", async () => {
  const owner = await fixture();
  const transactionId = await addAuto(owner);
  const proposed = await propose(owner);
  await applyReclassification({
    ownerClerkUserId: owner.clerkUserId,
    operatorActor: OPERATOR,
    runId: proposed.runId,
    approvalHash: proposed.approvalHash,
  });
  await withAuth(owner.clerkUserId, () =>
    setTransactionCategory(transactionId, owner.leaf("Coffee Shops")));
  const manual = await categoryState(transactionId);

  await expect(rollbackReclassification({
    ownerClerkUserId: owner.clerkUserId,
    operatorActor: OPERATOR,
    runId: proposed.runId,
    confirm: true,
  })).resolves.toEqual({
    runId: proposed.runId,
    status: "partially_rolled_back",
    rolledBack: 0,
    conflicted: 1,
  });
  expect(await categoryState(transactionId)).toEqual(manual);
});

test.each(["run", "revision", "microsecond", "transfer"] as const)(
  "rollback preserves a %s conflict without changing the current row",
  async (race) => {
    const owner = await fixture();
    const transactionId = await addAuto(owner);
    const proposed = await propose(owner);
    await applyReclassification({
      ownerClerkUserId: owner.clerkUserId,
      operatorActor: OPERATOR,
      runId: proposed.runId,
      approvalHash: proposed.approvalHash,
    });
    if (race === "run") {
      await adminDb().update(transactions)
        .set({ categoryRunId: null })
        .where(eq(transactions.id, transactionId));
    } else if (race === "revision") {
      await adminDb().update(transactions)
        .set({ categoryRevision: sql`${transactions.categoryRevision} + 2` })
        .where(eq(transactions.id, transactionId));
    } else if (race === "microsecond") {
      await adminDb().execute(sql`
        update transactions set updated_at = updated_at + interval '1 microsecond'
        where id = ${transactionId}
      `);
    } else {
      const otherAccount = await fixture(owner.clerkUserId);
      const counterpart = await addTransaction(otherAccount, {
        description: "ROLLBACK TRANSFER COUNTERPART",
        amountMinor: 1299,
      });
      await adminDb().insert(transferPairs).values({
        userId: owner.user.id,
        outflowTransactionId: transactionId,
        inflowTransactionId: counterpart,
      });
    }
    const current = await categoryState(transactionId);
    const providerCalls = classificationRequests.length;
    await expect(rollbackReclassification({
      ownerClerkUserId: owner.clerkUserId,
      operatorActor: OPERATOR,
      runId: proposed.runId,
      confirm: true,
    })).resolves.toEqual({
      runId: proposed.runId,
      status: "partially_rolled_back",
      rolledBack: 0,
      conflicted: 1,
    });
    expect(await categoryState(transactionId)).toEqual(current);
    expect(classificationRequests).toHaveLength(providerCalls);
    const [proposal] = await adminDb().select({ state: classificationProposals.state })
      .from(classificationProposals)
      .where(eq(classificationProposals.runId, proposed.runId));
    expect(proposal.state).toBe("rollback_conflict");
  },
);

test("another owner cannot read, apply, or roll back a run", async () => {
  const a = await fixture();
  const b = await fixture();
  await addAuto(a);
  const proposed = await propose(a);
  await expect(withRequestScope(b.clerkUserId, (tx) =>
    tx.select().from(classificationRuns))).resolves.toEqual([]);
  await expect(reclassificationRunSummary({
    ownerClerkUserId: b.clerkUserId,
    operatorActor: OPERATOR,
    runId: proposed.runId,
  })).rejects.toBeInstanceOf(ReclassificationNotFoundError);
  await expect(applyReclassification({
    ownerClerkUserId: b.clerkUserId,
    operatorActor: OPERATOR,
    runId: proposed.runId,
    approvalHash: proposed.approvalHash,
  })).rejects.toBeInstanceOf(ReclassificationNotFoundError);
  await applyReclassification({
    ownerClerkUserId: a.clerkUserId,
    operatorActor: OPERATOR,
    runId: proposed.runId,
    approvalHash: proposed.approvalHash,
  });
  await expect(rollbackReclassification({
    ownerClerkUserId: b.clerkUserId,
    operatorActor: OPERATOR,
    runId: proposed.runId,
    confirm: true,
  })).rejects.toBeInstanceOf(ReclassificationNotFoundError);
});

test("provider failure writes no proposals or ledger rows and releases admission", async () => {
  const owner = await fixture();
  const transactionId = await addAuto(owner);
  const before = await categoryState(transactionId);
  failNextClassification(503);
  await expect(proposeReclassification({
    ownerClerkUserId: owner.clerkUserId,
    operatorActor: OPERATOR,
    maxRows: 1,
    policy: "all_auto",
  })).rejects.toThrow();
  expect(await categoryState(transactionId)).toEqual(before);
  await expect(adminDb().$count(classificationProposals)).resolves.toBe(0);
  const [failed] = await adminDb().select({ status: classificationRuns.status }).from(classificationRuns);
  expect(failed.status).toBe("failed");

  await expect(propose(owner)).resolves.toMatchObject({ status: "proposed" });
  expect(classificationRequests).toHaveLength(2);
});

test("initial and reclassification requests share owner admission", async () => {
  const owner = await fixture();
  await addAuto(owner);
  await addTransaction(owner, { description: "UNCATEGORIZED FOR INITIAL" });
  let initialError: unknown;
  primeClassification([
    { item: 0, category: labelIndex("Groceries"), confidence: "high", reason: "Replacement" },
  ]);
  onceBeforeClassificationResponse(async () => {
    try {
      await withAuth(owner.clerkUserId, () => autoCategorizeBatch());
    } catch (error) {
      initialError = error;
    }
  });

  await expect(proposeReclassification({
    ownerClerkUserId: owner.clerkUserId,
    operatorActor: OPERATOR,
    maxRows: 1,
    policy: "all_auto",
  })).resolves.toMatchObject({ status: "proposed" });
  expect(initialError).toBeInstanceOf(InferenceBusyError);
  expect(classificationRequests).toHaveLength(1);
});

test("empty and nonexistent owners make no provider request and never provision", async () => {
  const empty = await fixture();
  await expect(proposeReclassification({
    ownerClerkUserId: empty.clerkUserId,
    operatorActor: OPERATOR,
    maxRows: 40,
    policy: "all_auto",
  })).resolves.toEqual({ status: "no_candidates", attempted: 0, proposed: 0, skipped: 0 });
  const unknown = fakeClerkUserId();
  await expect(proposeReclassification({
    ownerClerkUserId: unknown,
    operatorActor: OPERATOR,
    maxRows: 40,
    policy: "all_auto",
  })).rejects.toBeInstanceOf(ReclassificationNotFoundError);
  expect(classificationRequests).toHaveLength(0);
  await expect(adminDb().$count(users, eq(users.clerkUserId, unknown))).resolves.toBe(0);
});
