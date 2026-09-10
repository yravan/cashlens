import { eq, sql } from "drizzle-orm";
import { expect, test } from "vitest";

import { requireUser } from "@/lib/data/users";
import { withRequestScope } from "@/lib/db/client";
import {
  accounts,
  categories,
  classificationProposals,
  classificationRuns,
  transactions,
  users,
} from "@/lib/db/schema";
import { fakeClerkUserId, withAuth } from "../harness/clerk";
import { adminDb } from "../harness/db";

const HASH = "a".repeat(64);
const pgError = (code: string) => ({ cause: expect.objectContaining({ code }) });

async function fixture(clerkUserId: string) {
  const user = await withAuth(clerkUserId, () => requireUser());
  const [account] = await adminDb()
    .insert(accounts)
    .values({
      userId: user.id,
      name: "Journal Checking",
      type: "depository",
      currency: "USD",
      source: "manual",
    })
    .returning({ id: accounts.id });
  const [group] = await adminDb()
    .insert(categories)
    .values({ userId: user.id, name: "Journal Group", sortOrder: 0 })
    .returning({ id: categories.id });
  const [category] = await adminDb()
    .insert(categories)
    .values({ userId: user.id, parentId: group.id, name: "Journal Leaf", sortOrder: 0 })
    .returning({ id: categories.id });
  const [otherCategory] = await adminDb()
    .insert(categories)
    .values({ userId: user.id, parentId: group.id, name: "Journal Other", sortOrder: 1 })
    .returning({ id: categories.id });
  const [transaction] = await adminDb()
    .insert(transactions)
    .values({
      userId: user.id,
      accountId: account.id,
      categoryId: category.id,
      categorySource: "auto",
      categoryConfidence: "low",
      categoryReason: "Existing automatic choice",
      amountMinor: -1200,
      currency: "USD",
      date: "2026-09-10",
      description: "JOURNAL FIXTURE",
      status: "posted",
      source: "manual",
    })
    .returning({ id: transactions.id, revision: transactions.categoryRevision });
  await adminDb().update(transactions)
    .set({ updatedAt: sql`'2026-09-10 12:00:00.123456+00'::timestamptz` })
    .where(eq(transactions.id, transaction.id));
  const [timestamp] = await adminDb()
    .select({ updatedAt: sql<string>`${transactions.updatedAt}::text` })
    .from(transactions)
    .where(eq(transactions.id, transaction.id));
  return {
    clerkUserId,
    user,
    account,
    category,
    otherCategory,
    transaction: { ...transaction, updatedAt: timestamp.updatedAt },
  };
}

const runValues = (
  ownerUserId: string,
  overrides: Partial<typeof classificationRuns.$inferInsert> = {},
): typeof classificationRuns.$inferInsert => ({
  ownerUserId,
  kind: "automatic_reclassification",
  status: "inferring",
  requestedModel: "anthropic/claude-haiku-4.5",
  promptVersion: "v1",
  assignmentSchemaVersion: "v1",
  taxonomyFingerprint: HASH,
  providerPolicyFingerprint: HASH,
  batchSize: 1,
  operatorActor: "operator:test",
  inferenceLeaseUntil: new Date("2026-09-10T12:01:30Z"),
  expiresAt: new Date("2026-09-11T12:00:00Z"),
  ...overrides,
});

type Fixture = Awaited<ReturnType<typeof fixture>>;

const proposalValues = (
  owner: Fixture,
  runId: string,
  overrides: Partial<typeof classificationProposals.$inferInsert> = {},
): typeof classificationProposals.$inferInsert => ({
  runId,
  ownerUserId: owner.user.id,
  transactionId: owner.transaction.id,
  proposedCategoryId: owner.category.id,
  proposedConfidence: "high",
  proposedReason: "Owner-scoped proposal",
  beforeCategoryId: owner.category.id,
  beforeCategorySource: "auto",
  beforeCategoryConfidence: "low",
  beforeCategoryReason: "Existing automatic choice",
  beforeCategoryRevision: owner.transaction.revision,
  beforeUpdatedAt: owner.transaction.updatedAt,
  ...overrides,
});

test("one owner can hold only one inferring run while different owners remain independent", async () => {
  const a = await fixture(fakeClerkUserId());
  const b = await fixture(fakeClerkUserId());
  const [active] = await withRequestScope(a.clerkUserId, (tx) =>
    tx.insert(classificationRuns).values(runValues(a.user.id)).returning(),
  );

  await expect(
    withRequestScope(a.clerkUserId, (tx) =>
      tx.insert(classificationRuns).values(runValues(a.user.id)),
    ),
  ).rejects.toMatchObject(pgError("23505"));
  await expect(
    withRequestScope(b.clerkUserId, (tx) =>
      tx.insert(classificationRuns).values(runValues(b.user.id)),
    ),
  ).resolves.toBeDefined();

  await withRequestScope(a.clerkUserId, (tx) =>
    tx.update(classificationRuns).set({ status: "failed" }).where(eq(classificationRuns.id, active.id)),
  );
  await expect(
    withRequestScope(a.clerkUserId, (tx) =>
      tx.insert(classificationRuns).values(runValues(a.user.id)),
    ),
  ).resolves.toBeDefined();
});

test("deleting an owner cascades the complete journal graph without touching another owner", async () => {
  const a = await fixture(fakeClerkUserId());
  const b = await fixture(fakeClerkUserId());
  for (const owner of [a, b]) {
    const [priorRun] = await withRequestScope(owner.clerkUserId, (tx) =>
      tx.insert(classificationRuns).values(runValues(owner.user.id, {
        kind: "automatic_initial",
        status: "succeeded",
        operatorActor: null,
        expiresAt: null,
      })).returning(),
    );
    const [currentRun] = await withRequestScope(owner.clerkUserId, (tx) =>
      tx.insert(classificationRuns).values(runValues(owner.user.id, {
        status: "applied",
      })).returning(),
    );
    const appliedAt = "2026-09-10 12:00:00.654321+00";
    await adminDb().update(transactions).set({
      categoryId: owner.otherCategory.id,
      categorySource: "auto",
      categoryConfidence: "high",
      categoryReason: "Reclassified choice",
      categoryRunId: currentRun.id,
      categoryRevision: 1,
      updatedAt: sql`${appliedAt}::timestamptz`,
    }).where(eq(transactions.id, owner.transaction.id));
    await withRequestScope(owner.clerkUserId, (tx) =>
      tx.insert(classificationProposals).values(proposalValues(owner, currentRun.id, {
        proposedCategoryId: owner.otherCategory.id,
        proposedConfidence: "high",
        proposedReason: "Reclassified choice",
        beforeCategoryRunId: priorRun.id,
        state: "applied",
        appliedCategoryId: owner.otherCategory.id,
        appliedCategorySource: "auto",
        appliedCategoryConfidence: "high",
        appliedCategoryReason: "Reclassified choice",
        appliedCategoryRunId: currentRun.id,
        appliedCategoryRevision: 1,
        appliedUpdatedAt: appliedAt,
      })).returning(),
    );
  }

  const rowsForOwner = async (userId: string) => {
    const result = await adminDb().execute(sql`
      select 'account' as kind, id::text from accounts where user_id = ${userId}
      union all select 'category', id::text from categories where user_id = ${userId}
      union all select 'transaction', id::text from transactions where user_id = ${userId}
      union all select 'run', id::text from classification_runs where owner_user_id = ${userId}
      union all select 'proposal', id::text from classification_proposals where owner_user_id = ${userId}
      order by kind, id
    `);
    return result.rows as { kind: string; id: string }[];
  };
  const bBefore = await rowsForOwner(b.user.id);
  expect(await rowsForOwner(a.user.id)).toHaveLength(8);
  await expect(
    adminDb().delete(categories).where(eq(categories.id, a.category.id)),
  ).rejects.toMatchObject(pgError("23503"));

  await adminDb().delete(users).where(eq(users.id, a.user.id));

  expect(await rowsForOwner(a.user.id)).toEqual([]);
  expect(await rowsForOwner(b.user.id)).toEqual(bBefore);
});

test("run, transaction, and category relations cannot cross an owner boundary", async () => {
  const a = await fixture(fakeClerkUserId());
  const b = await fixture(fakeClerkUserId());
  const [run] = await withRequestScope(a.clerkUserId, (tx) =>
    tx.insert(classificationRuns).values(runValues(a.user.id)).returning(),
  );

  await expect(
    adminDb()
      .update(transactions)
      .set({ categoryRunId: run.id })
      .where(eq(transactions.id, b.transaction.id)),
  ).rejects.toMatchObject(pgError("23503"));
  await expect(
    adminDb().insert(classificationProposals).values(proposalValues(a, run.id, {
      transactionId: b.transaction.id,
      beforeUpdatedAt: b.transaction.updatedAt,
    })),
  ).rejects.toMatchObject(pgError("23503"));
  await expect(
    adminDb().insert(classificationProposals).values(proposalValues(a, run.id, {
      proposedCategoryId: b.category.id,
    })),
  ).rejects.toMatchObject(pgError("23503"));
});

test("RLS hides another owner's journal and rejects forged ownership", async () => {
  const a = await fixture(fakeClerkUserId());
  const b = await fixture(fakeClerkUserId());
  const [run] = await withRequestScope(a.clerkUserId, (tx) =>
    tx.insert(classificationRuns).values(runValues(a.user.id)).returning(),
  );
  const [proposal] = await withRequestScope(a.clerkUserId, (tx) =>
    tx.insert(classificationProposals).values(proposalValues(a, run.id)).returning(),
  );

  const visibleToB = await withRequestScope(b.clerkUserId, async (tx) => ({
    runs: await tx.select().from(classificationRuns),
    proposals: await tx.select().from(classificationProposals),
  }));
  expect(visibleToB).toEqual({ runs: [], proposals: [] });
  await expect(
    withRequestScope(b.clerkUserId, (tx) =>
      tx.update(classificationProposals)
        .set({ state: "skipped" })
        .where(eq(classificationProposals.id, proposal.id))
        .returning(),
    ),
  ).resolves.toEqual([]);
  await expect(
    withRequestScope(b.clerkUserId, (tx) =>
      tx.insert(classificationRuns).values(runValues(a.user.id, { status: "failed" })),
    ),
  ).rejects.toMatchObject(pgError("42501"));
});

test("journal checks reject fabricated provenance and account purge removes proposals", async () => {
  const owner = await fixture(fakeClerkUserId());
  const [run] = await withRequestScope(owner.clerkUserId, (tx) =>
    tx.insert(classificationRuns).values(runValues(owner.user.id)).returning(),
  );
  await expect(
    adminDb().update(transactions).set({ categoryRunId: run.id, categorySource: "user" })
      .where(eq(transactions.id, owner.transaction.id)),
  ).rejects.toMatchObject(pgError("23514"));
  await expect(
    adminDb().update(transactions).set({
      categoryRunId: run.id,
      categorySource: null,
      categoryConfidence: null,
      categoryReason: null,
    }).where(eq(transactions.id, owner.transaction.id)),
  ).rejects.toMatchObject(pgError("23514"));
  await expect(
    withRequestScope(owner.clerkUserId, (tx) =>
      tx.insert(classificationRuns).values(runValues(owner.user.id, {
        status: "failed",
        taxonomyFingerprint: "not-a-hash",
      })),
    ),
  ).rejects.toMatchObject(pgError("23514"));
  await expect(
    withRequestScope(owner.clerkUserId, (tx) =>
      tx.insert(classificationRuns).values(runValues(owner.user.id, {
        kind: "automatic_initial",
        status: "proposed",
        operatorActor: null,
        expiresAt: null,
      })),
    ),
  ).rejects.toMatchObject(pgError("23514"));

  const [initialRun] = await adminDb()
    .insert(classificationRuns)
    .values(runValues(owner.user.id, {
      kind: "automatic_initial",
      status: "failed",
      operatorActor: null,
      expiresAt: null,
    }))
    .returning({ id: classificationRuns.id });
  await expect(
    adminDb().insert(classificationProposals).values(proposalValues(owner, initialRun.id)),
  ).rejects.toMatchObject(pgError("23503"));

  const appliedBase = proposalValues(owner, run.id, {
    proposedReason: "Applied tuple probe",
    state: "applied",
    appliedCategoryId: owner.category.id,
    appliedCategorySource: "auto",
    appliedCategoryConfidence: "high",
    appliedCategoryReason: "Applied tuple probe",
    appliedCategoryRunId: run.id,
    appliedCategoryRevision: owner.transaction.revision + 1,
    appliedUpdatedAt: "2026-09-10 12:00:00.654321+00",
  });
  await expect(
    adminDb().insert(classificationProposals).values({
      ...appliedBase,
      appliedCategorySource: null,
    }),
  ).rejects.toMatchObject(pgError("23514"));
  await expect(
    adminDb().insert(classificationProposals).values({
      ...appliedBase,
      appliedCategoryRunId: null,
    }),
  ).rejects.toMatchObject(pgError("23514"));
  for (const mismatch of [
    { appliedCategoryId: owner.otherCategory.id },
    { appliedCategoryConfidence: "medium" as const },
    { appliedCategoryReason: "Different reason" },
  ]) {
    await expect(
      adminDb().insert(classificationProposals).values({ ...appliedBase, ...mismatch }),
    ).rejects.toMatchObject(pgError("23514"));
  }

  const [proposal] = await withRequestScope(owner.clerkUserId, (tx) =>
    tx.insert(classificationProposals).values(proposalValues(owner, run.id)).returning(),
  );
  const [beforeRoundTrip] = await adminDb()
    .select({ value: sql<string>`(${classificationProposals.beforeUpdatedAt} at time zone 'UTC')::text` })
    .from(classificationProposals)
    .where(eq(classificationProposals.id, proposal.id));
  expect(beforeRoundTrip.value).toBe("2026-09-10 12:00:00.123456");
  await withRequestScope(owner.clerkUserId, (tx) =>
    tx.update(classificationProposals).set({
      state: "applied",
      appliedCategoryId: owner.category.id,
      appliedCategorySource: "auto",
      appliedCategoryConfidence: "high",
      appliedCategoryReason: "Owner-scoped proposal",
      appliedCategoryRunId: run.id,
      appliedCategoryRevision: owner.transaction.revision + 1,
      appliedUpdatedAt: "2026-09-10 12:00:00.654321+00",
    }).where(eq(classificationProposals.id, proposal.id)),
  );
  const [appliedRoundTrip] = await adminDb()
    .select({ value: sql<string>`(${classificationProposals.appliedUpdatedAt} at time zone 'UTC')::text` })
    .from(classificationProposals)
    .where(eq(classificationProposals.id, proposal.id));
  expect(appliedRoundTrip.value).toBe("2026-09-10 12:00:00.654321");
  await expect(
    withRequestScope(owner.clerkUserId, (tx) =>
      tx.update(classificationProposals).set({ beforeCategoryReason: "rewrite" }),
    ),
  ).rejects.toMatchObject(pgError("42501"));
  await withRequestScope(owner.clerkUserId, (tx) =>
    tx.delete(accounts).where(eq(accounts.id, owner.account.id)),
  );
  await expect(adminDb().$count(classificationProposals)).resolves.toBe(0);
  await expect(
    adminDb().select({ id: classificationRuns.id }).from(classificationRuns)
      .orderBy(classificationRuns.id),
  ).resolves.toEqual([run.id, initialRun.id].sort().map((id) => ({ id })));

  await expect(
    withRequestScope(owner.clerkUserId, (tx) => tx.delete(classificationRuns)),
  ).rejects.toMatchObject(pgError("42501"));
  await expect(
    withRequestScope(owner.clerkUserId, (tx) =>
      tx.execute(sql`update classification_runs set requested_model = 'rewritten'`),
    ),
  ).rejects.toMatchObject(pgError("42501"));
  await adminDb().delete(users).where(eq(users.id, owner.user.id));
  await expect(
    adminDb().$count(classificationRuns, eq(classificationRuns.ownerUserId, owner.user.id)),
  ).resolves.toBe(0);
});
