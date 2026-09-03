import { sql } from "drizzle-orm";
import {
  bigint,
  char,
  check,
  date,
  foreignKey,
  index,
  integer,
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
    // Webhook owner resolution (2.1.4): scoped by a request-local uuid set only
    // after a verified provider item id matched a connection row.
    pgPolicy("users_select_webhook_owner", {
      for: "select",
      to: appRole,
      using: sql`id::text = current_setting('app.plaid_webhook_user_id', true)`,
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

export const categorySource = pgEnum("category_source", ["user", "auto"]);

export const categoryConfidence = pgEnum("category_confidence", [
  "low",
  "medium",
  "high",
]);

const ownRow = sql`user_id = (select app_current_user_id())`;

function ownRowPolicies(table: string) {
  return [
    pgPolicy(`${table}_select_own`, { for: "select", to: appRole, using: ownRow }),
    pgPolicy(`${table}_insert_own`, { for: "insert", to: appRole, withCheck: ownRow }),
  ];
}

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
};

export const connectionProvider = pgEnum("connection_provider", ["plaid"]);

export const connectionStatus = pgEnum("connection_status", [
  "active",
  "disconnected",
]);

export const backfillStatus = pgEnum("backfill_status", ["in_progress", "complete"]);

export const connections = pgTable(
  "connections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    provider: connectionProvider("provider").notNull(),
    providerItemId: text("provider_item_id"),
    institutionId: text("institution_id"),
    institutionName: text("institution_name"),
    status: connectionStatus("status").notNull(),
    backfillStatus: backfillStatus("backfill_status").notNull().default("in_progress"),
    syncCursor: text("sync_cursor"),
    providerError: text("provider_error"),
    webhookUrl: text("webhook_url"),
    ...timestamps,
  },
  (t) => [
    unique("connections_id_user_id_unique").on(t.id, t.userId),
    uniqueIndex("connections_user_provider_item_key")
      .on(t.userId, t.provider, t.providerItemId)
      .where(sql`provider_item_id is not null`),
    index("connections_user_id_idx").on(t.userId),
    ...ownRowPolicies("connections"),
    pgPolicy("connections_update_own", {
      for: "update",
      to: appRole,
      using: ownRow,
      withCheck: ownRow,
    }),
    // Webhook item→connection mapping (2.1.4): a session that knows a verified
    // provider item id may read exactly that item's connection rows.
    pgPolicy("connections_select_webhook_item", {
      for: "select",
      to: appRole,
      using: sql`provider = 'plaid' and provider_item_id = current_setting('app.plaid_item_id', true)`,
    }),
  ],
);

export const accounts = pgTable(
  "accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    connectionId: uuid("connection_id"),
    name: text("name").notNull(),
    type: accountType("type").notNull(),
    subtype: text("subtype"),
    mask: text("mask"),
    currency: char("currency", { length: 3 }).notNull(),
    source: ledgerSource("source").notNull(),
    sourceId: text("source_id"),
    ...timestamps,
  },
  (t) => [
    unique("accounts_id_user_id_unique").on(t.id, t.userId),
    // Composite FK: plain FKs bypass RLS, letting a row reference another user's connection.
    foreignKey({
      name: "accounts_connection_user_fk",
      columns: [t.connectionId, t.userId],
      foreignColumns: [connections.id, connections.userId],
    }),
    index("accounts_connection_id_idx").on(t.connectionId),
    uniqueIndex("accounts_user_source_row_key")
      .on(t.userId, t.source, t.sourceId)
      .where(sql`source_id is not null`),
    index("accounts_user_id_idx").on(t.userId),
    check("accounts_currency_iso4217", sql`currency ~ '^[A-Z]{3}$'`),
    ...ownRowPolicies("accounts"),
    // Purge (2.1.5): deleting an account cascades its transactions and
    // balances through composite (id, user_id) FKs, so the cascade can never
    // cross a user boundary.
    pgPolicy("accounts_delete_own", { for: "delete", to: appRole, using: ownRow }),
  ],
);

export const categories = pgTable(
  "categories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    parentId: uuid("parent_id"),
    name: text("name").notNull(),
    sortOrder: integer("sort_order").notNull(),
    ...timestamps,
  },
  (t) => [
    unique("categories_id_user_id_unique").on(t.id, t.userId),
    foreignKey({
      name: "categories_parent_user_fk",
      columns: [t.parentId, t.userId],
      foreignColumns: [t.id, t.userId],
    }),
    uniqueIndex("categories_user_root_name_key")
      .on(t.userId, t.name)
      .where(sql`parent_id is null`),
    uniqueIndex("categories_user_parent_name_key")
      .on(t.userId, t.parentId, t.name)
      .where(sql`parent_id is not null`),
    index("categories_user_id_idx").on(t.userId),
    check(
      "categories_name_trimmed",
      sql`name = btrim(name) and char_length(name) between 1 and 60`,
    ),
    ...ownRowPolicies("categories"),
  ],
);

export const transactions = pgTable(
  "transactions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull(),
    accountId: uuid("account_id").notNull(),
    categoryId: uuid("category_id"),
    categorySource: categorySource("category_source"),
    categoryConfidence: categoryConfidence("category_confidence"),
    categoryReason: text("category_reason"),
    amountMinor: bigint("amount_minor", { mode: "number" }).notNull(),
    currency: char("currency", { length: 3 }).notNull(),
    date: date("date").notNull(),
    description: text("description").notNull(),
    merchant: text("merchant"),
    status: transactionStatus("status").notNull(),
    source: ledgerSource("source").notNull(),
    sourceId: text("source_id"),
    ...timestamps,
  },
  (t) => [
    // Composite FK: plain FKs bypass RLS, letting a row reference another user's account.
    foreignKey({
      name: "transactions_account_user_fk",
      columns: [t.accountId, t.userId],
      foreignColumns: [accounts.id, accounts.userId],
    }).onDelete("cascade"),
    foreignKey({
      name: "transactions_category_user_fk",
      columns: [t.categoryId, t.userId],
      foreignColumns: [categories.id, categories.userId],
    }),
    uniqueIndex("transactions_account_source_row_key")
      .on(t.accountId, t.source, t.sourceId)
      .where(sql`source_id is not null`),
    index("transactions_user_date_idx").on(t.userId, t.date),
    index("transactions_account_date_idx").on(t.accountId, t.date),
    check("transactions_currency_iso4217", sql`currency ~ '^[A-Z]{3}$'`),
    // Rows categorized before provenance tracking keep a NULL source.
    check(
      "transactions_category_source_scope",
      sql`category_id is not null or category_source is null`,
    ),
    check(
      "transactions_auto_fields_scope",
      sql`(category_confidence is null and category_reason is null) or category_source = 'auto'`,
    ),
    check(
      "transactions_category_reason_bounded",
      sql`category_reason is null or char_length(category_reason) between 1 and 200`,
    ),
    ...ownRowPolicies("transactions"),
    pgPolicy("transactions_update_own", {
      for: "update",
      to: appRole,
      using: ownRow,
      withCheck: ownRow,
    }),
    pgPolicy("transactions_delete_own", { for: "delete", to: appRole, using: ownRow }),
  ],
);

export const connectionCredentials = pgTable(
  "connection_credentials",
  {
    connectionId: uuid("connection_id").primaryKey(),
    userId: uuid("user_id").notNull(),
    ciphertext: text("ciphertext").notNull(),
    ...timestamps,
  },
  (t) => [
    foreignKey({
      name: "connection_credentials_connection_user_fk",
      columns: [t.connectionId, t.userId],
      foreignColumns: [connections.id, connections.userId],
    }).onDelete("cascade"),
    index("connection_credentials_user_id_idx").on(t.userId),
    ...ownRowPolicies("connection_credentials"),
    pgPolicy("connection_credentials_delete_own", {
      for: "delete",
      to: appRole,
      using: ownRow,
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
    createdAt: timestamps.createdAt,
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
    ...ownRowPolicies("account_balances"),
    pgPolicy("account_balances_update_own", {
      for: "update",
      to: appRole,
      using: ownRow,
      withCheck: ownRow,
    }),
  ],
);
