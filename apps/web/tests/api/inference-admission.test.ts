import { createHash } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { beforeEach, expect, test } from "vitest";

import { POST as categorizeRoute } from "@/app/api/transactions/categorize/route";
import { autoCategorizeBatch, BATCH_LIMIT } from "@/lib/data/auto-categorize";
import { listCategoryGroups, setTransactionCategory } from "@/lib/data/categories";
import { requireUser } from "@/lib/data/users";
import { accounts, classificationRuns, transactions } from "@/lib/db/schema";
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

const LABELS = DEFAULT_CATEGORIES.flatMap(({ group, categories }) =>
  categories.map((name) => `${group} > ${name}`),
);

const labelIndex = (name: string) => {
  const index = LABELS.findIndex((label) => label.endsWith(`> ${name}`));
  if (index < 0) throw new Error(`no default leaf named ${name}`);
  return index;
};

async function fixture(clerkUserId = fakeClerkUserId(), description = "ADMISSION VENDOR") {
  const user = await withAuth(clerkUserId, () => requireUser());
  const [account] = await adminDb()
    .insert(accounts)
    .values({
      userId: user.id,
      name: "Admission Checking",
      type: "depository",
      currency: "USD",
      source: "manual",
    })
    .returning({ id: accounts.id });
  const [transaction] = await adminDb()
    .insert(transactions)
    .values({
      userId: user.id,
      accountId: account.id,
      amountMinor: -1200,
      currency: "USD",
      date: "2026-09-10",
      description,
      merchant: "Admission Merchant",
      status: "posted",
      source: "manual",
    })
    .returning({ id: transactions.id });
  return { clerkUserId, user, account, transaction };
}

async function addTransaction(owner: Awaited<ReturnType<typeof fixture>>, description: string) {
  const [transaction] = await adminDb()
    .insert(transactions)
    .values({
      userId: owner.user.id,
      accountId: owner.account.id,
      amountMinor: -1300,
      currency: "USD",
      date: "2026-09-09",
      description,
      status: "posted",
      source: "manual",
    })
    .returning({ id: transactions.id });
  return transaction;
}

const post = (clerkUserId: string) =>
  withAuth(clerkUserId, () =>
    categorizeRoute(
      new Request("http://localhost/api/transactions/categorize", {
        method: "POST",
        headers: { host: "localhost" },
      }),
    ),
  );

const answer = (category = "Miscellaneous") => [
  { item: 0, category: labelIndex(category), confidence: "low", reason: "Bounded test choice" },
];

test("same-owner overlap spends once, returns bounded busy retry, then admits after release", async () => {
  const owner = await fixture();
  let busy: Response | undefined;
  primeClassification(answer());
  primeClassification(answer("Groceries"));
  onceBeforeClassificationResponse(async () => {
    busy = await post(owner.clerkUserId);
  });

  const first = await post(owner.clerkUserId);
  expect(first.status).toBe(200);
  expect(busy?.status).toBe(429);
  expect(await busy!.json()).toEqual({ error: "classification_busy" });
  const retryAfter = Number(busy!.headers.get("retry-after"));
  expect(retryAfter).toBeGreaterThanOrEqual(1);
  expect(retryAfter).toBeLessThanOrEqual(90);
  expect(classificationRequests).toHaveLength(1);

  await addTransaction(owner, "AFTER RELEASE VENDOR");
  const afterRelease = await post(owner.clerkUserId);
  expect(afterRelease.status).toBe(200);
  expect(classificationRequests).toHaveLength(2);
});

test("different owners hold independent inference admission", async () => {
  const a = await fixture(fakeClerkUserId(), "OWNER A VENDOR");
  const b = await fixture(fakeClerkUserId(), "OWNER B VENDOR");
  let second: Response | undefined;
  primeClassification(answer());
  primeClassification(answer("Groceries"));
  onceBeforeClassificationResponse(async () => {
    second = await post(b.clerkUserId);
  });

  const first = await post(a.clerkUserId);
  expect(first.status).toBe(200);
  expect(second?.status).toBe(200);
  expect(classificationRequests).toHaveLength(2);
});

test("lease recovery expires the old run and fences its late response", async () => {
  const owner = await fixture();
  let reclaimed: Response | undefined;
  primeClassification(answer("Gifts"));
  primeClassification(answer("Groceries"));
  onceBeforeClassificationResponse(async () => {
    await adminDb()
      .update(classificationRuns)
      .set({ inferenceLeaseUntil: sql`clock_timestamp() - interval '1 second'` })
      .where(
        and(
          eq(classificationRuns.ownerUserId, owner.user.id),
          eq(classificationRuns.status, "inferring"),
        ),
      );
    reclaimed = await post(owner.clerkUserId);
  });

  const late = await post(owner.clerkUserId);
  expect(reclaimed?.status).toBe(200);
  expect(late.status).toBe(200);
  expect(await late.json()).toEqual({ attempted: 1, categorized: 0, remaining: 0 });
  expect(classificationRequests).toHaveLength(2);

  const runs = await adminDb()
    .select({ status: classificationRuns.status, applied: classificationRuns.applied })
    .from(classificationRuns)
    .where(eq(classificationRuns.ownerUserId, owner.user.id))
    .orderBy(classificationRuns.createdAt);
  expect(runs).toEqual([
    { status: "expired", applied: 0 },
    { status: "succeeded", applied: 1 },
  ]);
});

test("a lease crossing its deadline while the finalizer waits on the run lock is fenced", async () => {
  const owner = await fixture();
  let monitor: Promise<void> | undefined;
  primeClassification(answer());
  onceBeforeClassificationResponse(async () => {
    const [run] = await adminDb()
      .select({ id: classificationRuns.id })
      .from(classificationRuns)
      .where(
        and(
          eq(classificationRuns.ownerUserId, owner.user.id),
          eq(classificationRuns.status, "inferring"),
        ),
      );
    await adminDb()
      .update(classificationRuns)
      .set({ inferenceLeaseUntil: sql`clock_timestamp() + interval '1 second'` })
      .where(eq(classificationRuns.id, run.id));

    let release = () => {};
    let locked = () => {};
    let holderPid = 0;
    const releaseSignal = new Promise<void>((resolve) => {
      release = resolve;
    });
    const lockedSignal = new Promise<void>((resolve) => {
      locked = resolve;
    });
    const holder = adminDb().transaction(async (tx) => {
      const pid = await tx.execute(sql`select pg_backend_pid() as pid`);
      holderPid = Number((pid.rows[0] as { pid: number }).pid);
      await tx
        .select({ id: classificationRuns.id })
        .from(classificationRuns)
        .where(eq(classificationRuns.id, run.id))
        .for("update");
      locked();
      await releaseSignal;
    });
    await lockedSignal;

    const waitUntil = async (predicate: () => Promise<boolean>, failure: string) => {
      const deadline = Date.now() + 5_000;
      while (Date.now() < deadline) {
        if (await predicate()) return;
        await new Promise<void>((resolve) => setImmediate(resolve));
      }
      throw new Error(failure);
    };
    monitor = (async () => {
      try {
        await waitUntil(async () => {
          const result = await adminDb().execute(sql`
            select exists (
              select 1 from pg_stat_activity
              where ${holderPid} = any(pg_blocking_pids(pid))
            ) as blocked
          `);
          return Boolean((result.rows[0] as { blocked: boolean }).blocked);
        }, "classification finalizer never waited for the held run lock");
        await waitUntil(async () => {
          const result = await adminDb().execute(sql`
            select inference_lease_until <= clock_timestamp() as expired
            from classification_runs where id = ${run.id}
          `);
          return Boolean((result.rows[0] as { expired: boolean }).expired);
        }, "classification lease did not cross its deadline");
      } finally {
        release();
        await holder;
      }
    })();
  });

  const fenced = await post(owner.clerkUserId);
  await monitor;
  expect(await fenced.json()).toEqual({ attempted: 1, categorized: 0, remaining: 1 });
  const [transaction] = await adminDb()
    .select({ categoryId: transactions.categoryId })
    .from(transactions)
    .where(eq(transactions.id, owner.transaction.id));
  expect(transaction.categoryId).toBeNull();

  primeClassification(answer("Groceries"));
  expect((await post(owner.clerkUserId)).status).toBe(200);
  const statuses = await adminDb()
    .select({ status: classificationRuns.status })
    .from(classificationRuns)
    .where(eq(classificationRuns.ownerUserId, owner.user.id))
    .orderBy(classificationRuns.createdAt);
  expect(statuses).toEqual([{ status: "expired" }, { status: "succeeded" }]);
});

test("provider failure releases the owner admission for an immediate retry", async () => {
  const owner = await fixture();
  failNextClassification(503);
  expect((await post(owner.clerkUserId)).status).toBe(502);

  primeClassification(answer());
  expect((await post(owner.clerkUserId)).status).toBe(200);
  expect(classificationRequests).toHaveLength(2);
  const statuses = await adminDb()
    .select({ status: classificationRuns.status })
    .from(classificationRuns)
    .where(eq(classificationRuns.ownerUserId, owner.user.id))
    .orderBy(classificationRuns.createdAt);
  expect(statuses).toEqual([{ status: "failed" }, { status: "succeeded" }]);
});

test("empty backlog checks do not grow the inference journal", async () => {
  const clerkUserId = fakeClerkUserId();
  const user = await withAuth(clerkUserId, () => requireUser());
  for (let i = 0; i < 3; i += 1) {
    await expect(withAuth(clerkUserId, () => autoCategorizeBatch())).resolves.toEqual({
      attempted: 0,
      categorized: 0,
      remaining: 0,
    });
  }
  expect(classificationRequests).toHaveLength(0);
  expect(
    await adminDb().$count(classificationRuns, eq(classificationRuns.ownerUserId, user.id)),
  ).toBe(0);
});

test("the run records the captured request and actual sanitized provider metadata", async () => {
  const owner = await fixture(fakeClerkUserId(), "PRIVATE METADATA VENDOR");
  const savedModel = process.env.LLM_MODEL;
  process.env.LLM_MODEL = "openai/gpt-5-nano";
  try {
    primeClassification(answer());
    onceBeforeClassificationResponse(async () => {
      process.env.LLM_MODEL = "anthropic/claude-haiku-4.5";
    });
    expect((await post(owner.clerkUserId)).status).toBe(200);
  } finally {
    if (savedModel === undefined) delete process.env.LLM_MODEL;
    else process.env.LLM_MODEL = savedModel;
  }

  expect(classificationRequests[0].body.model).toBe("openai/gpt-5-nano");
  const [run] = await adminDb()
    .select()
    .from(classificationRuns)
    .where(eq(classificationRuns.ownerUserId, owner.user.id));
  const groups = await withAuth(owner.clerkUserId, () => listCategoryGroups());
  const orderedLeaves = groups.flatMap((group) =>
    group.categories.map((leaf) => ({ id: leaf.id, label: `${group.name} > ${leaf.name}` })),
  );
  expect(run).toMatchObject({
    status: "succeeded",
    requestedModel: "openai/gpt-5-nano",
    responseModel: "openai/gpt-5-nano",
    promptVersion: "classification-prompt-v1",
    assignmentSchemaVersion: "transaction-classification-v1",
    providerInputTokens: 1,
    providerOutputTokens: 1,
    providerGenerationId: "gen-substitute",
    batchSize: BATCH_LIMIT,
    attempted: 1,
    applied: 1,
    skipped: 0,
  });
  expect(run.taxonomyFingerprint).toBe(
    createHash("sha256").update(JSON.stringify(orderedLeaves)).digest("hex"),
  );
  expect(run.providerPolicyFingerprint).toBe(
    createHash("sha256")
      .update(JSON.stringify({ data_collection: "deny", require_parameters: true }))
      .digest("hex"),
  );
  expect(run.resultSetHash).toMatch(/^[0-9a-f]{64}$/);
  expect(JSON.stringify(run)).not.toContain("PRIVATE METADATA VENDOR");
  expect(JSON.stringify(run)).not.toContain("Admission Merchant");
  expect(JSON.stringify(run)).not.toContain("Bounded test choice");
});

test("initial and manual writes advance provenance, including clear and reassign", async () => {
  const owner = await fixture();
  primeClassification(answer());
  await withAuth(owner.clerkUserId, () => autoCategorizeBatch());
  const [run] = await adminDb()
    .select({ id: classificationRuns.id })
    .from(classificationRuns)
    .where(eq(classificationRuns.ownerUserId, owner.user.id));
  const state = async () => {
    const [row] = await adminDb()
      .select({
        categoryId: transactions.categoryId,
        source: transactions.categorySource,
        runId: transactions.categoryRunId,
        revision: transactions.categoryRevision,
      })
      .from(transactions)
      .where(eq(transactions.id, owner.transaction.id));
    return row;
  };
  expect(await state()).toMatchObject({ source: "auto", runId: run.id, revision: 1 });

  const groups = await withAuth(owner.clerkUserId, () => listCategoryGroups());
  const leafIds = groups.flatMap((group) => group.categories.map((leaf) => leaf.id));
  await withAuth(owner.clerkUserId, () => setTransactionCategory(owner.transaction.id, leafIds[0]));
  expect(await state()).toMatchObject({ source: "user", runId: null, revision: 2 });
  await withAuth(owner.clerkUserId, () => setTransactionCategory(owner.transaction.id, null));
  expect(await state()).toEqual({ categoryId: null, source: null, runId: null, revision: 3 });
  await withAuth(owner.clerkUserId, () => setTransactionCategory(owner.transaction.id, leafIds[1]));
  expect(await state()).toMatchObject({ source: "user", runId: null, revision: 4 });
});

test("manual clear and payload edits made during inference both win the final CAS", async () => {
  const owner = await fixture();
  const other = await addTransaction(owner, "PAYLOAD EDIT VENDOR");
  primeClassification([
    ...answer(),
    { item: 1, category: labelIndex("Groceries"), confidence: "high", reason: "Stale payload choice" },
  ]);
  onceBeforeClassificationResponse(async () => {
    await withAuth(owner.clerkUserId, () => setTransactionCategory(owner.transaction.id, null));
    await adminDb()
      .update(transactions)
      .set({ description: "EDITED WHILE IN FLIGHT", updatedAt: sql`clock_timestamp()` })
      .where(eq(transactions.id, other.id));
  });

  const step = await withAuth(owner.clerkUserId, () => autoCategorizeBatch());
  expect(step).toEqual({ attempted: 2, categorized: 0, remaining: 2 });
  const rows = await adminDb()
    .select({ id: transactions.id, categoryId: transactions.categoryId })
    .from(transactions)
    .where(eq(transactions.userId, owner.user.id));
  expect(rows).toEqual(expect.arrayContaining([
    { id: owner.transaction.id, categoryId: null },
    { id: other.id, categoryId: null },
  ]));
});
