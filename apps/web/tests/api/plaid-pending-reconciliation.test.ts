import { and, asc, eq } from "drizzle-orm";
import { beforeEach, expect, test } from "vitest";

import { listCategoryGroups, setTransactionCategory } from "@/lib/data/categories";
import { requireUser } from "@/lib/data/users";
import { withRequestScope } from "@/lib/db/client";
import { transactions, transferPairs } from "@/lib/db/schema";
import { fakeClerkUserId, withAuth } from "../harness/clerk";
import { adminDb } from "../harness/db";
import {
  capSyncPageSize,
  onceAfterSyncPage,
  pushSyncUpdates,
  resetPlaidSubstitute,
  sandboxTransaction,
} from "../harness/plaid";
import {
  backfilled,
  CARD,
  CHECKING,
  rewind,
  step,
} from "./plaid-helpers";

beforeEach(resetPlaidSubstitute);

const pending = (account = CHECKING, id = "pending-source") =>
  sandboxTransaction(account, 18, "PENDING HOLD", "2026-08-22", {
    transaction_id: id,
    pending: true,
  });

const posted = (
  account = CHECKING,
  pendingId = "pending-source",
  id = "posted-source",
  amount = 18.4,
) =>
  sandboxTransaction(account, amount, "POSTED CHARGE", "2026-08-23", {
    transaction_id: id,
    merchant_name: "Corner Bistro",
    pending_transaction_id: pendingId,
  });

const rowsFor = (userId: string) =>
  adminDb()
    .select({
      id: transactions.id,
      accountId: transactions.accountId,
      categoryId: transactions.categoryId,
      categorySource: transactions.categorySource,
      categoryConfidence: transactions.categoryConfidence,
      categoryReason: transactions.categoryReason,
      amountMinor: transactions.amountMinor,
      date: transactions.date,
      description: transactions.description,
      merchant: transactions.merchant,
      status: transactions.status,
      sourceId: transactions.sourceId,
    })
    .from(transactions)
    .where(eq(transactions.userId, userId))
    .orderBy(asc(transactions.date), asc(transactions.sourceId));

const leafNamed = (
  groups: Awaited<ReturnType<typeof listCategoryGroups>>,
  name: string,
) => {
  for (const group of groups) {
    const leaf = group.categories.find((category) => category.name === name);
    if (leaf) return leaf.id;
  }
  throw new Error(`missing category ${name}`);
};

const internalUser = (clerkUserId: string) => withAuth(clerkUserId, requireUser);

const removed = (transactionId: string, accountId = CHECKING) => ({
  transaction_id: transactionId,
  account_id: accountId,
});

test("a linked posted transaction reuses the pending row and preserves user enrichment", async () => {
  const clerkUserId = fakeClerkUserId();
  const item = await backfilled(clerkUserId, pending());
  const user = await internalUser(clerkUserId);
  const [before] = await rowsFor(user.id);
  const groups = await withAuth(clerkUserId, listCategoryGroups);
  const categoryId = leafNamed(groups, "Restaurants & Bars");
  await withAuth(clerkUserId, () => setTransactionCategory(before.id, categoryId));
  capSyncPageSize(1);

  pushSyncUpdates(item.accessToken, {
    added: [posted()],
    removed: [removed("pending-source")],
  });

  const response = await item.sync();
  await expect(response.json()).resolves.toEqual(step("complete", 1));
  await expect(rowsFor(user.id)).resolves.toEqual([
    {
      id: before.id,
      accountId: item.accountId.get(CHECKING),
      categoryId,
      categorySource: "user",
      categoryConfidence: null,
      categoryReason: null,
      amountMinor: -1840,
      date: "2026-08-23",
      description: "POSTED CHARGE",
      merchant: "Corner Bistro",
      status: "posted",
      sourceId: "posted-source",
    },
  ]);
});

test("auto-category provenance survives settlement", async () => {
  const clerkUserId = fakeClerkUserId();
  const item = await backfilled(clerkUserId, pending());
  const user = await internalUser(clerkUserId);
  const [before] = await rowsFor(user.id);
  const categoryId = leafNamed(
    await withAuth(clerkUserId, listCategoryGroups),
    "Restaurants & Bars",
  );
  await adminDb()
    .update(transactions)
    .set({
      categoryId,
      categorySource: "auto",
      categoryConfidence: "low",
      categoryReason: "Merchant resembles a restaurant",
    })
    .where(eq(transactions.id, before.id));
  pushSyncUpdates(item.accessToken, {
    added: [posted()],
    removed: [removed("pending-source")],
  });

  await item.sync();

  await expect(rowsFor(user.id)).resolves.toMatchObject([
    {
      id: before.id,
      categoryId,
      categorySource: "auto",
      categoryConfidence: "low",
      categoryReason: "Merchant resembles a restaurant",
      status: "posted",
      sourceId: "posted-source",
    },
  ]);
});

test("an explicit link can claim only a pending row", async () => {
  const clerkUserId = fakeClerkUserId();
  const alreadyPosted = pending();
  alreadyPosted.pending = false;
  alreadyPosted.name = "ALREADY POSTED";
  const item = await backfilled(clerkUserId, alreadyPosted);
  const user = await internalUser(clerkUserId);
  const [before] = await rowsFor(user.id);
  pushSyncUpdates(item.accessToken, { added: [posted()] });

  await item.sync();

  await expect(rowsFor(user.id)).resolves.toMatchObject([
    { id: before.id, description: "ALREADY POSTED", sourceId: "pending-source" },
    { description: "POSTED CHARGE", sourceId: "posted-source" },
  ]);
});

test("a posted replacement resolves before Plaid removes the old pending id", async () => {
  const clerkUserId = fakeClerkUserId();
  const item = await backfilled(clerkUserId, pending());
  const user = await internalUser(clerkUserId);
  const [before] = await rowsFor(user.id);

  pushSyncUpdates(item.accessToken, { added: [posted()] });
  await expect((await item.sync()).json()).resolves.toEqual(step("complete", 1));
  expect(await rowsFor(user.id)).toMatchObject([
    { id: before.id, status: "posted", sourceId: "posted-source" },
  ]);

  pushSyncUpdates(item.accessToken, { removed: [removed("pending-source")] });
  await expect((await item.sync()).json()).resolves.toEqual(step("complete", 0));
  expect(await rowsFor(user.id)).toHaveLength(1);
});

test("a removal that arrives before its linked posting stays lossless", async () => {
  const clerkUserId = fakeClerkUserId();
  const item = await backfilled(clerkUserId, pending());
  const user = await internalUser(clerkUserId);

  pushSyncUpdates(item.accessToken, { removed: [removed("pending-source")] });
  await expect((await item.sync()).json()).resolves.toEqual(
    step("complete", 0, { removed: 1 }),
  );
  expect(await rowsFor(user.id)).toEqual([]);

  pushSyncUpdates(item.accessToken, { added: [posted()] });
  await expect((await item.sync()).json()).resolves.toEqual(step("complete", 1));
  expect(await rowsFor(user.id)).toMatchObject([
    { amountMinor: -1840, status: "posted", sourceId: "posted-source" },
  ]);
});

test("null, unknown, and cross-account links never guess a replacement", async () => {
  const clerkUserId = fakeClerkUserId();
  const item = await backfilled(clerkUserId, pending());
  const user = await internalUser(clerkUserId);
  const noLink = posted(CHECKING, "", "posted-no-link");
  noLink.pending_transaction_id = null;

  pushSyncUpdates(item.accessToken, {
    added: [
      noLink,
      posted(CHECKING, "not-present", "posted-unknown"),
      posted(CARD, "pending-source", "posted-other-account"),
    ],
  });
  await item.sync();

  expect(await rowsFor(user.id)).toHaveLength(4);
  expect((await rowsFor(user.id)).map((row) => row.sourceId)).toEqual([
    "pending-source",
    "posted-no-link",
    "posted-other-account",
    "posted-unknown",
  ]);
});

test("replaying the complete provider history cannot resurrect the pending duplicate", async () => {
  const clerkUserId = fakeClerkUserId();
  const item = await backfilled(clerkUserId, pending());
  const user = await internalUser(clerkUserId);
  const [before] = await rowsFor(user.id);
  pushSyncUpdates(item.accessToken, {
    added: [posted()],
    removed: [removed("pending-source")],
  });
  await item.sync();
  await rewind(item.connectionId);

  await item.sync();

  await expect(rowsFor(user.id)).resolves.toMatchObject([
    { id: before.id, status: "posted", sourceId: "posted-source" },
  ]);
});

test("a CAS-losing reconciliation run commits nothing after the winner", async () => {
  const clerkUserId = fakeClerkUserId();
  const item = await backfilled(clerkUserId, pending());
  const user = await internalUser(clerkUserId);
  const [before] = await rowsFor(user.id);
  pushSyncUpdates(item.accessToken, {
    added: [posted()],
    removed: [removed("pending-source")],
  });
  capSyncPageSize(1);
  let winner: unknown;
  onceAfterSyncPage(async () => {
    capSyncPageSize(500);
    winner = await (await item.sync()).json();
    capSyncPageSize(1);
  });

  const loser = await item.sync();

  expect(winner).toEqual(step("complete", 1));
  await expect(loser.json()).resolves.toEqual(step("complete", 0, { drained: false }));
  await expect(rowsFor(user.id)).resolves.toMatchObject([
    { id: before.id, status: "posted", sourceId: "posted-source" },
  ]);
});

test("another user's matching provider id can never be claimed", async () => {
  const clerkA = fakeClerkUserId();
  const clerkB = fakeClerkUserId();
  const itemB = await backfilled(clerkB, pending(CHECKING, "shared-pending"));
  const itemA = await backfilled(clerkA);
  const userA = await internalUser(clerkA);
  const userB = await internalUser(clerkB);

  pushSyncUpdates(itemA.accessToken, {
    added: [posted(CHECKING, "shared-pending", "a-posted")],
  });
  await itemA.sync();

  await expect(rowsFor(userA.id)).resolves.toMatchObject([
    { status: "posted", sourceId: "a-posted" },
  ]);
  await expect(rowsFor(userB.id)).resolves.toMatchObject([
    { status: "pending", sourceId: "shared-pending" },
  ]);
  expect(itemB.connectionId).not.toBe(itemA.connectionId);
});

test("the resolved row participates in transfer matching immediately", async () => {
  const clerkUserId = fakeClerkUserId();
  const counterpart = sandboxTransaction(CHECKING, -18, "CARD PAYMENT", "2026-08-23");
  const item = await backfilled(clerkUserId, pending(CARD), counterpart);
  const user = await internalUser(clerkUserId);

  pushSyncUpdates(item.accessToken, {
    added: [posted(CARD, "pending-source", "posted-source", 18)],
    removed: [removed("pending-source", CARD)],
  });
  await item.sync();

  expect(await adminDb().$count(transferPairs, eq(transferPairs.userId, user.id))).toBe(1);
  expect(await rowsFor(user.id)).toHaveLength(2);
});

test("the app role receives the source-id mutation needed by reconciliation", async () => {
  const clerkUserId = fakeClerkUserId();
  await backfilled(clerkUserId, pending());
  const user = await internalUser(clerkUserId);
  const [row] = await rowsFor(user.id);

  const changed = await withRequestScope(clerkUserId, (tx) =>
    tx
      .update(transactions)
      .set({ sourceId: "posted-by-app-role" })
      .where(
        and(
          eq(transactions.id, row.id),
          eq(transactions.userId, user.id),
          eq(transactions.status, "pending"),
        ),
      ),
  );

  expect(changed.rowCount).toBe(1);
  await expect(rowsFor(user.id)).resolves.toMatchObject([
    { sourceId: "posted-by-app-role" },
  ]);
});

test("the transaction RLS backstop still hides another user's pending rows", async () => {
  const clerkA = fakeClerkUserId();
  const clerkB = fakeClerkUserId();
  await backfilled(clerkA, pending(CHECKING, "a-pending"));
  await backfilled(clerkB, pending(CHECKING, "b-pending"));

  const visible = await withRequestScope(clerkB, (tx) =>
    tx.select({ sourceId: transactions.sourceId }).from(transactions),
  );

  expect(visible).toEqual([{ sourceId: "b-pending" }]);
});
