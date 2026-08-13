import { sql } from "drizzle-orm";
import {
  bigint,
  char,
  check,
  date,
  foreignKey,
  index,
  pgEnum,
  pgPolicy,
  pgRole,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const appRole = pgRole("cashlens_app").existing();

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clerkUserId: text("clerk_user_id").notNull().unique(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  () => [
    pgPolicy("users_select_self", {
      for: "select",
      to: appRole,
      using: sql`clerk_user_id = current_setting('app.clerk_user_id', true)`,
    }),
    pgPolicy("users_insert_self", {
      for: "insert",
      to: appRole,
      withCheck: sql`clerk_user_id = current_setting('app.clerk_user_id', true)`,
    }),
  ],
);

export const ledgerSource = pgEnum("ledger_source", [
  "plaid",
  "manual",
  "import",
]);

export const accountType = pgEnum("account_type", [
  "depository",
  "credit",
  "loan",
  "investment",
  "other",
]);

export const transactionStatus = pgEnum("transaction_status", [
  "pending",
  "posted",
]);

const ownRow = sql`user_id = (select app_current_user_id())`;

export const accounts = pgTable(
  "accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    type: accountType("type").notNull(),
    subtype: text("subtype"),
    mask: text("mask"),
    currency: char("currency", { length: 3 }).notNull(),
    source: ledgerSource("source").notNull(),
    sourceId: text("source_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique("accounts_id_user_id_unique").on(t.id, t.userId),
    uniqueIndex("accounts_user_source_row_key")
      .on(t.userId, t.source, t.sourceId)
      .where(sql`source_id is not null`),
    index("accounts_user_id_idx").on(t.userId),
    check("accounts_currency_iso4217", sql`currency ~ '^[A-Z]{3}$'`),
    pgPolicy("accounts_select_own", {
      for: "select",
      to: appRole,
      using: ownRow,
    }),
    pgPolicy("accounts_insert_own", {
      for: "insert",
      to: appRole,
      withCheck: ownRow,
    }),
  ],
);

export const transactions = pgTable(
  "transactions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull(),
    accountId: uuid("account_id").notNull(),
    amountMinor: bigint("amount_minor", { mode: "number" }).notNull(),
    currency: char("currency", { length: 3 }).notNull(),
    date: date("date").notNull(),
    description: text("description").notNull(),
    merchant: text("merchant"),
    status: transactionStatus("status").notNull(),
    source: ledgerSource("source").notNull(),
    sourceId: text("source_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // Composite FK: plain FKs bypass RLS, letting a row reference another user's account.
    foreignKey({
      name: "transactions_account_user_fk",
      columns: [t.accountId, t.userId],
      foreignColumns: [accounts.id, accounts.userId],
    }).onDelete("cascade"),
    uniqueIndex("transactions_account_source_row_key")
      .on(t.accountId, t.source, t.sourceId)
      .where(sql`source_id is not null`),
    index("transactions_user_date_idx").on(t.userId, t.date),
    index("transactions_account_date_idx").on(t.accountId, t.date),
    check("transactions_currency_iso4217", sql`currency ~ '^[A-Z]{3}$'`),
    pgPolicy("transactions_select_own", {
      for: "select",
      to: appRole,
      using: ownRow,
    }),
    pgPolicy("transactions_insert_own", {
      for: "insert",
      to: appRole,
      withCheck: ownRow,
    }),
  ],
);

export const accountBalances = pgTable(
  "account_balances",
  {
    accountId: uuid("account_id").primaryKey(),
    userId: uuid("user_id").notNull(),
    availableMinor: bigint("available_minor", { mode: "number" }),
    currentMinor: bigint("current_minor", { mode: "number" }),
    limitMinor: bigint("limit_minor", { mode: "number" }),
    asOf: timestamp("as_of", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    foreignKey({
      name: "account_balances_account_user_fk",
      columns: [t.accountId, t.userId],
      foreignColumns: [accounts.id, accounts.userId],
    }).onDelete("cascade"),
    index("account_balances_user_id_idx").on(t.userId),
    check(
      "account_balances_reported_figure",
      sql`available_minor is not null or current_minor is not null`,
    ),
    pgPolicy("account_balances_select_own", {
      for: "select",
      to: appRole,
      using: ownRow,
    }),
    pgPolicy("account_balances_insert_own", {
      for: "insert",
      to: appRole,
      withCheck: ownRow,
    }),
  ],
);
