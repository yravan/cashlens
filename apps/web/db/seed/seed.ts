import { inArray, or } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import { accountBalances, accounts, categories, transactions, users } from "../../lib/db/schema.ts";
import {
  SEED_ACCOUNTS,
  SEED_BALANCES,
  SEED_CATEGORIES,
  SEED_CLERK_IDS,
  SEED_PERSONAS,
  SEED_TRANSACTIONS,
  SEED_USERS,
  type SeedPersona,
} from "./dataset.ts";

export type SeedDb = Pick<NodePgDatabase, "insert" | "delete">;

export async function seedDataset(
  db: SeedDb,
  userIds: Partial<Record<SeedPersona, string>> = {},
): Promise<Record<SeedPersona, string>> {
  const ids = Object.fromEntries(
    SEED_PERSONAS.map((persona) => [persona, userIds[persona] ?? SEED_USERS[persona].id]),
  ) as Record<SeedPersona, string>;
  const owned = <T extends { persona: SeedPersona }>(rows: readonly T[]) =>
    rows.map(({ persona, ...row }) => ({ ...row, userId: ids[persona] }));

  await db.delete(users).where(inArray(users.clerkUserId, SEED_CLERK_IDS));
  await db.delete(accounts).where(inArray(accounts.id, SEED_ACCOUNTS.map((account) => account.id)));
  await db.delete(categories).where(
    or(
      inArray(categories.userId, Object.values(ids)),
      inArray(categories.id, SEED_CATEGORIES.map((row) => row.id)),
    ),
  );

  const created = SEED_PERSONAS.filter((persona) => !userIds[persona]);
  if (created.length) await db.insert(users).values(created.map((persona) => SEED_USERS[persona]));
  await db.insert(categories).values(owned(SEED_CATEGORIES));
  await db.insert(accounts).values(owned(SEED_ACCOUNTS));
  await db.insert(transactions).values(owned(SEED_TRANSACTIONS));
  await db.insert(accountBalances).values(owned(SEED_BALANCES));
  return ids;
}
