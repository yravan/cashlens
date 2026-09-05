import { eq } from "drizzle-orm";
import { beforeEach, expect, test } from "vitest";

import { POST as categorizeRoute } from "@/app/api/transactions/categorize/route";
import { EXPECTED, SEED_USERS } from "@/db/seed/dataset";
import { seedDataset } from "@/db/seed/seed";
import { autoCategorizeBatch, BATCH_LIMIT, uncategorizedCount } from "@/lib/data/auto-categorize";
import { listCategoryGroups, setTransactionCategory } from "@/lib/data/categories";
import { requireUser } from "@/lib/data/users";
import { withRequestScope } from "@/lib/db/client";
import { accounts, transactions } from "@/lib/db/schema";
import { DEFAULT_CATEGORIES } from "@/lib/ledger/default-categories";
import {
  APIConnectionError,
  APIError,
  AuthenticationError,
  classificationRequests,
  clientOptions,
  failNextClassification,
  onceBeforeClassificationResponse,
  primeClassification,
  primeClassificationText,
  RateLimitError,
  resetAnthropicSubstitute,
} from "../harness/anthropic";
import { fakeClerkUserId, withAuth } from "../harness/clerk";
import { adminDb } from "../harness/db";

beforeEach(resetAnthropicSubstitute);

const LABELS = DEFAULT_CATEGORIES.flatMap(({ group, categories }) =>
  categories.map((name) => `${group} > ${name}`),
);
const labelIndex = (name: string) => {
  const at = LABELS.findIndex((label) => label.endsWith(`> ${name}`));
  if (at < 0) throw new Error(`no default leaf named ${name}`);
  return at;
};

const dateFor = (i: number) => {
  const day = new Date(Date.UTC(2026, 2, 28));
  day.setUTCDate(day.getUTCDate() - i);
  return day.toISOString().slice(0, 10);
};

type Row = { description: string; merchant?: string | null; amountMinor?: number };

async function provision(clerkUserId: string, rows: Row[], accountName = "Probe Checking") {
  const user = await withAuth(clerkUserId, () => requireUser());
  const [account] = await adminDb()
    .insert(accounts)
    .values({ userId: user.id, name: accountName, type: "depository", currency: "USD", source: "manual" })
    .returning({ id: accounts.id });
  const inserted = rows.length
    ? await adminDb()
        .insert(transactions)
        .values(
          rows.map((row, i) => ({
            userId: user.id,
            accountId: account.id,
            amountMinor: row.amountMinor ?? -1000 - i,
            currency: "USD",
            date: dateFor(i),
            description: row.description,
            merchant: row.merchant ?? null,
            status: "posted" as const,
            source: "manual" as const,
          })),
        )
        .returning({ id: transactions.id })
    : [];
  return { user, accountId: account.id, ids: inserted.map((row) => row.id) };
}

const categoryStateOf = async (transactionId: string) => {
  const [row] = await adminDb()
    .select({
      categoryId: transactions.categoryId,
      source: transactions.categorySource,
      confidence: transactions.categoryConfidence,
      reason: transactions.categoryReason,
    })
    .from(transactions)
    .where(eq(transactions.id, transactionId));
  return row;
};

const leafNamed = (groups: Awaited<ReturnType<typeof listCategoryGroups>>, name: string) => {
  for (const group of groups) {
    const leaf = group.categories.find((category) => category.name === name);
    if (leaf) return leaf.id;
  }
  throw new Error(`no default leaf named ${name}`);
};

const promptPayload = (at = 0) =>
  JSON.parse(classificationRequests[at].messages[0].content) as {
    categories: { id: number; name: string }[];
    transactions: Record<string, unknown>[];
  };

test("a batch classifies uncategorized rows through the model and stamps auto provenance", async () => {
  const clerkUserId = fakeClerkUserId();
  const { ids } = await provision(clerkUserId, [
    { description: "BEAN BARREL COFFEE", merchant: "Bean Barrel" },
    { description: "MAPLE MARKET #204", merchant: "Maple Market" },
    { description: "ACME CORP PAYROLL", merchant: "Acme Corp", amountMinor: 250000 },
  ]);
  primeClassification([
    { item: 0, category: labelIndex("Coffee Shops"), confidence: "high", reason: "Coffee shop merchant" },
    { item: 1, category: labelIndex("Groceries"), confidence: "medium", reason: "Grocery store" },
    { item: 2, category: labelIndex("Paycheck"), confidence: "high", reason: "Payroll deposit" },
  ]);

  const step = await withAuth(clerkUserId, () => autoCategorizeBatch());
  expect(step).toEqual({ attempted: 3, categorized: 3, remaining: 0 });

  const groups = await withAuth(clerkUserId, () => listCategoryGroups());
  expect(await categoryStateOf(ids[0])).toEqual({
    categoryId: leafNamed(groups, "Coffee Shops"),
    source: "auto",
    confidence: "high",
    reason: "Coffee shop merchant",
  });
  expect(await categoryStateOf(ids[1])).toEqual({
    categoryId: leafNamed(groups, "Groceries"),
    source: "auto",
    confidence: "medium",
    reason: "Grocery store",
  });
  expect(await categoryStateOf(ids[2])).toEqual({
    categoryId: leafNamed(groups, "Paycheck"),
    source: "auto",
    confidence: "high",
    reason: "Payroll deposit",
  });

  expect(classificationRequests).toHaveLength(1);
  const request = classificationRequests[0];
  expect(request.model).toBe("claude-haiku-4-5");
  expect(request.temperature).toBe(0);
  expect(request.output_config?.format?.type).toBe("json_schema");
  expect(request.max_tokens).toBeGreaterThan(0);
  expect(request.max_tokens).toBeLessThanOrEqual(4096);

  const payload = promptPayload();
  expect(payload.categories.map((category) => category.name)).toEqual(LABELS);
  expect(payload.transactions).toEqual([
    { id: 0, direction: "out", merchant: "Bean Barrel", description: "BEAN BARREL COFFEE" },
    { id: 1, direction: "out", merchant: "Maple Market", description: "MAPLE MARKET #204" },
    { id: 2, direction: "in", merchant: "Acme Corp", description: "ACME CORP PAYROLL" },
  ]);
  expect(clientOptions.every((options) => !("apiKey" in options))).toBe(true);
});

test("least data: nothing beyond description, merchant, and direction ever reaches the provider", async () => {
  const clerkUserId = fakeClerkUserId();
  const { user, accountId, ids } = await provision(
    clerkUserId,
    [{ description: "ORINOCO RIVER OUTFITTERS", merchant: "Orinoco Outfitters", amountMinor: -987631 }],
    "Hidden Account Name 9911",
  );
  primeClassification([
    { item: 0, category: labelIndex("Other Shopping"), confidence: "low", reason: "Retail-sounding name" },
  ]);
  await withAuth(clerkUserId, () => autoCategorizeBatch());

  const groups = await withAuth(clerkUserId, () => listCategoryGroups());
  const raw = JSON.stringify(classificationRequests);
  for (const secret of [
    user.id,
    clerkUserId,
    ids[0],
    accountId,
    "Hidden Account Name",
    "9911",
    "987631",
    dateFor(0),
    "USD",
    leafNamed(groups, "Other Shopping"),
  ]) {
    expect(raw).not.toContain(secret);
  }
  for (const row of promptPayload().transactions) {
    expect(Object.keys(row).sort()).toEqual(["description", "direction", "id", "merchant"]);
  }
});

test("already-categorized rows are never re-sent and manual work is never overwritten", async () => {
  const clerkUserId = fakeClerkUserId();
  const { ids } = await provision(clerkUserId, [
    { description: "ALREADY HANDLED VENDOR" },
    { description: "STILL UNCATEGORIZED VENDOR" },
  ]);
  const groups = await withAuth(clerkUserId, () => listCategoryGroups());
  const gifts = leafNamed(groups, "Gifts");
  await withAuth(clerkUserId, () => setTransactionCategory(ids[0], gifts));

  primeClassification([
    { item: 0, category: labelIndex("Miscellaneous"), confidence: "low", reason: "No clear signal" },
  ]);
  const step = await withAuth(clerkUserId, () => autoCategorizeBatch());
  expect(step).toEqual({ attempted: 1, categorized: 1, remaining: 0 });

  const payload = promptPayload();
  expect(payload.transactions).toHaveLength(1);
  expect(JSON.stringify(payload)).not.toContain("ALREADY HANDLED VENDOR");
  expect(await categoryStateOf(ids[0])).toEqual({
    categoryId: gifts,
    source: "user",
    confidence: null,
    reason: null,
  });
});

test("a concurrent manual assignment wins the race against an in-flight batch", async () => {
  const clerkUserId = fakeClerkUserId();
  const { ids } = await provision(clerkUserId, [{ description: "RACED VENDOR" }]);
  const groups = await withAuth(clerkUserId, () => listCategoryGroups());
  const coffee = leafNamed(groups, "Coffee Shops");

  primeClassification([
    { item: 0, category: labelIndex("Groceries"), confidence: "high", reason: "Late guess" },
  ]);
  onceBeforeClassificationResponse(async () => {
    await withAuth(clerkUserId, () => setTransactionCategory(ids[0], coffee));
  });

  const step = await withAuth(clerkUserId, () => autoCategorizeBatch());
  expect(step).toEqual({ attempted: 1, categorized: 0, remaining: 0 });
  expect(await categoryStateOf(ids[0])).toEqual({
    categoryId: coffee,
    source: "user",
    confidence: null,
    reason: null,
  });
});

test("invalid model output entries are dropped while the valid subset applies", async () => {
  const clerkUserId = fakeClerkUserId();
  const { ids } = await provision(clerkUserId, [
    { description: "FIRST VENDOR" },
    { description: "SECOND VENDOR" },
    { description: "THIRD VENDOR" },
  ]);
  primeClassification([
    { item: 0, category: 9999, confidence: "high", reason: "category out of range" },
    { item: 1, category: labelIndex("Groceries"), confidence: "medium", reason: "the valid one" },
    { item: 1, category: labelIndex("Gifts"), confidence: "high", reason: "duplicate item" },
    { item: 2, category: labelIndex("Gifts"), confidence: "certain", reason: "bad confidence" },
    { item: 7, category: labelIndex("Gifts"), confidence: "high", reason: "item out of range" },
  ]);

  const step = await withAuth(clerkUserId, () => autoCategorizeBatch());
  expect(step).toEqual({ attempted: 3, categorized: 1, remaining: 2 });

  const groups = await withAuth(clerkUserId, () => listCategoryGroups());
  expect(await categoryStateOf(ids[0])).toMatchObject({ categoryId: null, source: null });
  expect(await categoryStateOf(ids[1])).toEqual({
    categoryId: leafNamed(groups, "Groceries"),
    source: "auto",
    confidence: "medium",
    reason: "the valid one",
  });
  expect(await categoryStateOf(ids[2])).toMatchObject({ categoryId: null, source: null });
});

test("the model chooses among assignable leaves only — groups are never offered", async () => {
  const clerkUserId = fakeClerkUserId();
  await provision(clerkUserId, [{ description: "ANY VENDOR" }]);
  primeClassification([
    { item: 0, category: labelIndex("Miscellaneous"), confidence: "low", reason: "Fallback" },
  ]);
  await withAuth(clerkUserId, () => autoCategorizeBatch());

  const offered = promptPayload().categories.map((category) => category.name);
  expect(offered).toHaveLength(LABELS.length);
  for (const name of offered) expect(name).toContain(" > ");
  for (const { group } of DEFAULT_CATEGORIES) expect(offered).not.toContain(group);
});

test("cross-user isolation: a run never reads, sends, or writes another user's rows", async () => {
  const clerkA = fakeClerkUserId();
  const clerkB = fakeClerkUserId();
  await provision(clerkA, [{ description: "ALPHA SECRET STORE" }]);
  const b = await provision(clerkB, [{ description: "BRAVO PRIVATE VENDOR" }]);

  primeClassification([
    { item: 0, category: labelIndex("Miscellaneous"), confidence: "low", reason: "Fallback" },
  ]);
  const step = await withAuth(clerkA, () => autoCategorizeBatch());
  expect(step.categorized).toBe(1);

  expect(JSON.stringify(classificationRequests)).not.toContain("BRAVO PRIVATE VENDOR");
  expect(await categoryStateOf(b.ids[0])).toMatchObject({ categoryId: null, source: null });

  const groupsA = await withAuth(clerkA, () => listCategoryGroups());
  const probe = await withRequestScope(clerkA, (tx) =>
    tx
      .update(transactions)
      .set({
        categoryId: leafNamed(groupsA, "Miscellaneous"),
        categorySource: "auto",
        categoryConfidence: "low",
        categoryReason: "cross-user probe",
      })
      .where(eq(transactions.id, b.ids[0])),
  );
  expect(probe.rowCount).toBe(0);
  expect(await categoryStateOf(b.ids[0])).toMatchObject({ categoryId: null, source: null });
});

test("an empty queue returns zeros without ever calling the provider", async () => {
  const clerkUserId = fakeClerkUserId();
  await provision(clerkUserId, []);
  const step = await withAuth(clerkUserId, () => autoCategorizeBatch());
  expect(step).toEqual({ attempted: 0, categorized: 0, remaining: 0 });
  expect(classificationRequests).toHaveLength(0);
});

test("the batch caps at the newest BATCH_LIMIT rows and reports the remainder", async () => {
  const clerkUserId = fakeClerkUserId();
  const total = BATCH_LIMIT + 5;
  const { ids } = await provision(
    clerkUserId,
    Array.from({ length: total }, (_, i) => ({ description: `VENDOR NUMBER ${i}` })),
  );
  primeClassification(
    Array.from({ length: BATCH_LIMIT }, (_, i) => ({
      item: i,
      category: labelIndex("Miscellaneous"),
      confidence: "low",
      reason: "Fallback pick",
    })),
  );

  const step = await withAuth(clerkUserId, () => autoCategorizeBatch());
  expect(step).toEqual({ attempted: BATCH_LIMIT, categorized: BATCH_LIMIT, remaining: 5 });
  expect(await withAuth(clerkUserId, () => uncategorizedCount())).toBe(5);

  const payload = promptPayload();
  expect(payload.transactions).toHaveLength(BATCH_LIMIT);
  expect(payload.transactions[0].description).toBe("VENDOR NUMBER 0");
  const sent = new Set(payload.transactions.map((row) => row.description));
  for (let i = BATCH_LIMIT; i < total; i += 1) {
    expect(sent.has(`VENDOR NUMBER ${i}`)).toBe(false);
    expect(await categoryStateOf(ids[i])).toMatchObject({ categoryId: null });
  }
});

test("the seeded demo backlog categorizes in one batch and empties the queue", async () => {
  await seedDataset(adminDb());
  const clerkUserId = SEED_USERS.demo.clerkUserId;
  primeClassification(
    Array.from({ length: EXPECTED.demo.uncategorized }, (_, i) => ({
      item: i,
      category: labelIndex("Miscellaneous"),
      confidence: "low",
      reason: "Fallback pick",
    })),
  );

  const step = await withAuth(clerkUserId, () => autoCategorizeBatch());
  expect(step).toEqual({
    attempted: EXPECTED.demo.uncategorized,
    categorized: EXPECTED.demo.uncategorized,
    remaining: 0,
  });
  expect(await withAuth(clerkUserId, () => uncategorizedCount())).toBe(0);
  expect(JSON.stringify(classificationRequests)).not.toContain(SEED_USERS.neighbor.clerkUserId);
});

const post = (headers: Record<string, string> = {}) =>
  categorizeRoute(
    new Request("http://localhost/api/transactions/categorize", {
      method: "POST",
      headers: { host: "localhost", ...headers },
    }),
  );

test("the route runs a batch for the signed-in user and reports the step", async () => {
  const clerkUserId = fakeClerkUserId();
  const { ids } = await provision(clerkUserId, [{ description: "ROUTE VENDOR" }]);
  primeClassification([
    { item: 0, category: labelIndex("Miscellaneous"), confidence: "low", reason: "Fallback" },
  ]);

  const response = await withAuth(clerkUserId, () => post());
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ attempted: 1, categorized: 1, remaining: 0 });
  expect(await categoryStateOf(ids[0])).toMatchObject({ source: "auto" });
});

test("the route rejects signed-out and cross-origin callers before any work", async () => {
  const clerkUserId = fakeClerkUserId();
  await provision(clerkUserId, [{ description: "GUARDED VENDOR" }]);

  expect((await post()).status).toBe(401);
  const crossOrigin = await withAuth(clerkUserId, () => post({ origin: "https://evil.example" }));
  expect(crossOrigin.status).toBe(403);
  expect(classificationRequests).toHaveLength(0);
});

test("an unconfigured provider answers 503 and never attempts a call", async () => {
  const saved = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  try {
    const clerkUserId = fakeClerkUserId();
    const { ids } = await provision(clerkUserId, [{ description: "DORMANT VENDOR" }]);

    const response = await withAuth(clerkUserId, () => post());
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "llm_unconfigured" });
    expect(classificationRequests).toHaveLength(0);
    expect(await categoryStateOf(ids[0])).toMatchObject({ categoryId: null });
  } finally {
    process.env.ANTHROPIC_API_KEY = saved;
  }
});

test("provider failures map to honest statuses and leak no provider detail", async () => {
  const clerkUserId = fakeClerkUserId();
  const { ids } = await provision(clerkUserId, [{ description: "FLAKY VENDOR" }]);

  const cases: { prime: () => void; status: number; error: string }[] = [
    { prime: () => failNextClassification(new RateLimitError()), status: 429, error: "llm_rate_limited" },
    {
      prime: () => failNextClassification(new APIError(529, "overloaded upstream detail")),
      status: 429,
      error: "llm_rate_limited",
    },
    {
      prime: () => failNextClassification(new APIError(500, "internal provider detail")),
      status: 502,
      error: "llm_unavailable",
    },
    { prime: () => failNextClassification(new APIConnectionError()), status: 502, error: "llm_unavailable" },
    { prime: () => failNextClassification(new AuthenticationError()), status: 503, error: "llm_unconfigured" },
    { prime: () => primeClassificationText("not json at all"), status: 502, error: "llm_unavailable" },
    {
      prime: () =>
        primeClassification(
          [{ item: 0, category: labelIndex("Miscellaneous"), confidence: "low", reason: "cut" }],
          "max_tokens",
        ),
      status: 502,
      error: "llm_unavailable",
    },
  ];

  for (const { prime, status, error } of cases) {
    prime();
    const response = await withAuth(clerkUserId, () => post());
    expect(response.status).toBe(status);
    const body = await response.text();
    expect(JSON.parse(body)).toEqual({ error });
    expect(body).not.toContain("detail");
    if (status === 429) expect(response.headers.get("retry-after")).toBe("30");
    expect(await categoryStateOf(ids[0])).toMatchObject({ categoryId: null, source: null });
  }
});
