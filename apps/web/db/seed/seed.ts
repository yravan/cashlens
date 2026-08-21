import { inArray } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import { accountBalances, accounts, transactions, users } from "../../lib/db/schema.ts";
import {
  SEED_ACCOUNTS,
  SEED_BALANCES,
  SEED_TRANSACTIONS,
  SEED_USERS,
  type SeedPersona,
} from "./dataset.ts";

export type SeedDb = Pick<NodePgDatabase, "insert" | "delete">;

const PERSONAS = Object.keys(SEED_USERS) as SeedPersona[];

export async function seedDataset(
  db: SeedDb,
  userIds: Partial<Record<SeedPersona, string>> = {},
): Promise<Record<SeedPersona, string>> {
  const ids = Object.fromEntries(
    PERSONAS.map((persona) => [persona, userIds[persona] ?? SEED_USERS[persona].id]),
  ) as Record<SeedPersona, string>;

  await db.delete(users).where(
    inArray(users.clerkUserId, PERSONAS.map((persona) => SEED_USERS[persona].clerkUserId)),
  );
  await db.delete(accounts).where(inArray(accounts.id, SEED_ACCOUNTS.map((account) => account.id)));

  const created = PERSONAS.filter((persona) => !userIds[persona]);
  if (created.length) {
    await db.insert(users).values(created.map((persona) => SEED_USERS[persona]));
  }
  await db.insert(accounts).values(
    SEED_ACCOUNTS.map(({ persona, ...row }) => ({ ...row, userId: ids[persona] })),
  );
  await db.insert(transactions).values(
    SEED_TRANSACTIONS.map(({ persona, ...row }) => ({ ...row, userId: ids[persona] })),
  );
  await db.insert(accountBalances).values(
    SEED_BALANCES.map(({ persona, ...row }) => ({ ...row, userId: ids[persona] })),
  );
  return ids;
}
