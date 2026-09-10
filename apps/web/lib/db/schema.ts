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

export const classificationRunKind = pgEnum("classification_run_kind", [
  "automatic_initial",
  "automatic_reclassification",
]);

export const classificationRunStatus = pgEnum("classification_run_status", [
  "inferring",
  "succeeded",
  "proposed",
  "applied",
  "partially_applied",
  "rolled_back",
  "partially_rolled_back",
  "expired",
  "cancelled",
  "failed",
]);

export const classificationProposalState = pgEnum("classification_proposal_state", [
  "proposed",
  "applied",
  "skipped",
  "conflicted",
  "rolled_back",
  "rollback_conflict",
]);

const ownRow = sql`user_id = (select app_current_user_id())`;
const ownOwnerRow = sql`owner_user_id = (select app_current_user_id())`;

function ownRowPolicies(table: string) {
  return [
    pgPolicy(`${table}_select_own`, { for: "select", to: appRole, using: ownRow }),
    pgPolicy(`${table}_insert_own`, { for: "insert", to: appRole, withCheck: ownRow }),
  ];
}

function ownerRowPolicies(table: string) {
  return [
    pgPolicy(`${table}_select_own`, { for: "select", to: appRole, using: ownOwnerRow }),
    pgPolicy(`${table}_insert_own`, { for: "insert", to: appRole, withCheck: ownOwnerRow }),
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

export const classificationRuns = pgTable(
  "classification_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerUserId: uuid("owner_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: classificationRunKind("kind").notNull(),
    status: classificationRunStatus("status").notNull(),
    requestedModel: text("requested_model").notNull(),
    responseModel: text("response_model"),
    promptVersion: text("prompt_version").notNull(),
    assignmentSchemaVersion: text("assignment_schema_version").notNull(),
    taxonomyFingerprint: text("taxonomy_fingerprint").notNull(),
    providerPolicyFingerprint: text("provider_policy_fingerprint").notNull(),
    proposalSetHash: text("proposal_set_hash"),
    resultSetHash: text("result_set_hash"),
    batchSize: integer("batch_size").notNull(),
    attempted: integer("attempted").notNull().default(0),
    proposed: integer("proposed").notNull().default(0),
    applied: integer("applied").notNull().default(0),
    skipped: integer("skipped").notNull().default(0),
    conflicted: integer("conflicted").notNull().default(0),
    providerInputTokens: integer("provider_input_tokens"),
    providerOutputTokens: integer("provider_output_tokens"),
    providerGenerationId: text("provider_generation_id"),
    operatorActor: text("operator_actor"),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    appliedAt: timestamp("applied_at", { withTimezone: true }),
    inferenceLeaseUntil: timestamp("inference_lease_until", { withTimezone: true }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    unique("classification_runs_id_owner_unique").on(t.id, t.ownerUserId),
    unique("classification_runs_id_owner_kind_unique").on(t.id, t.ownerUserId, t.kind),
    uniqueIndex("classification_runs_owner_inferring_key")
      .on(t.ownerUserId)
      .where(sql`status = 'inferring'`),
    index("classification_runs_owner_created_idx").on(t.ownerUserId, t.createdAt),
    check("classification_runs_batch_size_bounded", sql`batch_size between 1 and 40`),
    check(
      "classification_runs_counts_nonnegative",
      sql`attempted >= 0 and proposed >= 0 and applied >= 0 and skipped >= 0 and conflicted >= 0`,
    ),
    check(
      "classification_runs_usage_nonnegative",
      sql`(provider_input_tokens is null or provider_input_tokens >= 0)
        and (provider_output_tokens is null or provider_output_tokens >= 0)`,
    ),
    check(
      "classification_runs_identity_bounded",
      sql`char_length(requested_model) between 1 and 200
        and (response_model is null or char_length(response_model) between 1 and 200)
        and char_length(prompt_version) between 1 and 100
        and char_length(assignment_schema_version) between 1 and 100
        and (provider_generation_id is null or char_length(provider_generation_id) between 1 and 200)
        and (operator_actor is null or char_length(operator_actor) between 1 and 200)`,
    ),
    check(
      "classification_runs_fingerprints_valid",
      sql`taxonomy_fingerprint ~ '^[0-9a-f]{64}$'
        and provider_policy_fingerprint ~ '^[0-9a-f]{64}$'
        and (proposal_set_hash is null or proposal_set_hash ~ '^[0-9a-f]{64}$')
        and (result_set_hash is null or result_set_hash ~ '^[0-9a-f]{64}$')`,
    ),
    check(
      "classification_runs_kind_scope",
      sql`(kind = 'automatic_initial' and operator_actor is null and expires_at is null)
        or (kind = 'automatic_reclassification' and operator_actor is not null and expires_at is not null)`,
    ),
    check(
      "classification_runs_status_scope",
      sql`(kind = 'automatic_initial'
          and status in ('inferring', 'succeeded', 'expired', 'cancelled', 'failed'))
        or (kind = 'automatic_reclassification'
          and status in ('inferring', 'proposed', 'applied', 'partially_applied',
            'rolled_back', 'partially_rolled_back', 'expired', 'cancelled', 'failed'))`,
    ),
    ...ownerRowPolicies("classification_runs"),
    pgPolicy("classification_runs_update_own", {
      for: "update",
      to: appRole,
      using: ownOwnerRow,
      withCheck: ownOwnerRow,
    }),
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
    categoryRunId: uuid("category_run_id"),
    categoryRevision: bigint("category_revision", { mode: "number" }).notNull().default(0),
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
    unique("transactions_id_user_id_unique").on(t.id, t.userId),
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
    // The journal grant migration defers provenance FK checks until commit.
    foreignKey({
      name: "transactions_category_run_user_fk",
      columns: [t.categoryRunId, t.userId],
      foreignColumns: [classificationRuns.id, classificationRuns.ownerUserId],
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
    check(
      "transactions_category_run_scope",
      sql`category_run_id is null or category_source is not distinct from 'auto'`,
    ),
    check("transactions_category_revision_nonnegative", sql`category_revision >= 0`),
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

export const classificationProposals = pgTable(
  "classification_proposals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    runId: uuid("run_id").notNull(),
    ownerUserId: uuid("owner_user_id").notNull(),
    runKind: classificationRunKind("run_kind").notNull().default("automatic_reclassification"),
    transactionId: uuid("transaction_id").notNull(),
    proposedCategoryId: uuid("proposed_category_id").notNull(),
    proposedConfidence: categoryConfidence("proposed_confidence").notNull(),
    proposedReason: text("proposed_reason").notNull(),
    beforeCategoryId: uuid("before_category_id").notNull(),
    beforeCategorySource: categorySource("before_category_source").notNull(),
    beforeCategoryConfidence: categoryConfidence("before_category_confidence"),
    beforeCategoryReason: text("before_category_reason"),
    beforeCategoryRunId: uuid("before_category_run_id"),
    beforeCategoryRevision: bigint("before_category_revision", { mode: "number" }).notNull(),
    beforeUpdatedAt: timestamp("before_updated_at", { withTimezone: true, mode: "string" }).notNull(),
    appliedCategoryId: uuid("applied_category_id"),
    appliedCategorySource: categorySource("applied_category_source"),
    appliedCategoryConfidence: categoryConfidence("applied_category_confidence"),
    appliedCategoryReason: text("applied_category_reason"),
    appliedCategoryRunId: uuid("applied_category_run_id"),
    appliedCategoryRevision: bigint("applied_category_revision", { mode: "number" }),
    appliedUpdatedAt: timestamp("applied_updated_at", { withTimezone: true, mode: "string" }),
    state: classificationProposalState("state").notNull().default("proposed"),
    appliedAt: timestamp("applied_at", { withTimezone: true }),
    skippedAt: timestamp("skipped_at", { withTimezone: true }),
    conflictedAt: timestamp("conflicted_at", { withTimezone: true }),
    rolledBackAt: timestamp("rolled_back_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    foreignKey({
      name: "classification_proposals_run_owner_fk",
      columns: [t.runId, t.ownerUserId, t.runKind],
      foreignColumns: [classificationRuns.id, classificationRuns.ownerUserId, classificationRuns.kind],
    }).onDelete("cascade"),
    foreignKey({
      name: "classification_proposals_transaction_owner_fk",
      columns: [t.transactionId, t.ownerUserId],
      foreignColumns: [transactions.id, transactions.userId],
    }).onDelete("cascade"),
    foreignKey({
      name: "classification_proposals_category_owner_fk",
      columns: [t.proposedCategoryId, t.ownerUserId],
      foreignColumns: [categories.id, categories.userId],
    }),
    foreignKey({
      name: "classification_proposals_before_category_owner_fk",
      columns: [t.beforeCategoryId, t.ownerUserId],
      foreignColumns: [categories.id, categories.userId],
    }),
    foreignKey({
      name: "classification_proposals_before_run_owner_fk",
      columns: [t.beforeCategoryRunId, t.ownerUserId],
      foreignColumns: [classificationRuns.id, classificationRuns.ownerUserId],
    }),
    foreignKey({
      name: "classification_proposals_applied_category_owner_fk",
      columns: [t.appliedCategoryId, t.ownerUserId],
      foreignColumns: [categories.id, categories.userId],
    }),
    foreignKey({
      name: "classification_proposals_applied_run_owner_fk",
      columns: [t.appliedCategoryRunId, t.ownerUserId],
      foreignColumns: [classificationRuns.id, classificationRuns.ownerUserId],
    }),
    unique("classification_proposals_run_transaction_unique").on(t.runId, t.transactionId),
    index("classification_proposals_owner_run_idx").on(t.ownerUserId, t.runId),
    index("classification_proposals_transaction_idx").on(t.transactionId),
    check("classification_proposals_before_auto", sql`before_category_source = 'auto'`),
    check(
      "classification_proposals_run_kind",
      sql`run_kind = 'automatic_reclassification'`,
    ),
    check(
      "classification_proposals_before_reason_bounded",
      sql`before_category_reason is null or char_length(before_category_reason) between 1 and 200`,
    ),
    check(
      "classification_proposals_proposed_reason_bounded",
      sql`char_length(proposed_reason) between 1 and 200`,
    ),
    check(
      "classification_proposals_applied_reason_bounded",
      sql`applied_category_reason is null or char_length(applied_category_reason) between 1 and 200`,
    ),
    check(
      "classification_proposals_applied_tuple_scope",
      sql`(applied_category_id is null and applied_category_source is null
          and applied_category_confidence is null and applied_category_reason is null
          and applied_category_run_id is null and applied_category_revision is null
          and applied_updated_at is null)
        or (applied_category_id is not null
          and applied_category_id is not distinct from proposed_category_id
          and applied_category_source is not distinct from 'auto'
          and applied_category_confidence is not distinct from proposed_confidence
          and applied_category_reason is not distinct from proposed_reason
          and applied_category_run_id is not null
          and applied_category_run_id is not distinct from run_id
          and applied_category_revision is not null
          and applied_updated_at is not null)`,
    ),
    check(
      "classification_proposals_state_scope",
      sql`(state in ('proposed', 'skipped', 'conflicted') and applied_category_id is null)
        or (state in ('applied', 'rolled_back', 'rollback_conflict') and applied_category_id is not null)`,
    ),
    check(
      "classification_proposals_revisions_nonnegative",
      sql`before_category_revision >= 0
        and (applied_category_revision is null or applied_category_revision > before_category_revision)`,
    ),
    ...ownerRowPolicies("classification_proposals"),
    pgPolicy("classification_proposals_update_own", {
      for: "update",
      to: appRole,
      using: ownOwnerRow,
      withCheck: ownOwnerRow,
    }),
  ],
);

// One link row per detected transfer (3.3.1). Active pairs have NULL
// dismissed_at; a dismissed row is negative memory — the combination is never
// re-proposed, while both transactions stay free to pair elsewhere.
export const transferPairs = pgTable(
  "transfer_pairs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull(),
    outflowTransactionId: uuid("outflow_transaction_id").notNull(),
    inflowTransactionId: uuid("inflow_transaction_id").notNull(),
    dismissedAt: timestamp("dismissed_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    // Composite FKs: deleting either half (2.1.4 removed path, purge) unpairs by cascade.
    foreignKey({
      name: "transfer_pairs_outflow_user_fk",
      columns: [t.outflowTransactionId, t.userId],
      foreignColumns: [transactions.id, transactions.userId],
    }).onDelete("cascade"),
    foreignKey({
      name: "transfer_pairs_inflow_user_fk",
      columns: [t.inflowTransactionId, t.userId],
      foreignColumns: [transactions.id, transactions.userId],
    }).onDelete("cascade"),
    unique("transfer_pairs_combo_unique").on(t.outflowTransactionId, t.inflowTransactionId),
    uniqueIndex("transfer_pairs_active_outflow_key")
      .on(t.outflowTransactionId)
      .where(sql`dismissed_at is null`),
    uniqueIndex("transfer_pairs_active_inflow_key")
      .on(t.inflowTransactionId)
      .where(sql`dismissed_at is null`),
    index("transfer_pairs_inflow_idx").on(t.inflowTransactionId),
    index("transfer_pairs_user_id_idx").on(t.userId),
    check(
      "transfer_pairs_distinct_halves",
      sql`outflow_transaction_id <> inflow_transaction_id`,
    ),
    ...ownRowPolicies("transfer_pairs"),
    pgPolicy("transfer_pairs_update_own", {
      for: "update",
      to: appRole,
      using: ownRow,
      withCheck: ownRow,
    }),
    pgPolicy("transfer_pairs_delete_own", { for: "delete", to: appRole, using: ownRow }),
  ],
);

export const recurringStreamStatus = pgEnum("recurring_stream_status", [
  "confirmed",
  "dismissed",
]);

export const flowDirection = pgEnum("flow_direction", ["inflow", "outflow"]);

// Recurring detection (6.4.1) is recomputed from the ledger on every read; a
// row here exists only once the user acted on a proposed stream, keyed on the
// stream identity so re-detection reattaches the decision. Absence = proposed.
export const recurringStreams = pgTable(
  "recurring_streams",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull(),
    accountId: uuid("account_id").notNull(),
    currency: char("currency", { length: 3 }).notNull(),
    direction: flowDirection("direction").notNull(),
    normalizedName: text("normalized_name").notNull(),
    status: recurringStreamStatus("status").notNull(),
    ...timestamps,
  },
  (t) => [
    // Composite FK: purging an account takes its stream decisions with it,
    // and a row can never reference another user's account.
    foreignKey({
      name: "recurring_streams_account_user_fk",
      columns: [t.accountId, t.userId],
      foreignColumns: [accounts.id, accounts.userId],
    }).onDelete("cascade"),
    uniqueIndex("recurring_streams_identity_key").on(
      t.accountId,
      t.currency,
      t.direction,
      t.normalizedName,
    ),
    index("recurring_streams_user_id_idx").on(t.userId),
    check("recurring_streams_currency_iso4217", sql`currency ~ '^[A-Z]{3}$'`),
    check(
      "recurring_streams_name_bounded",
      sql`normalized_name = btrim(normalized_name) and char_length(normalized_name) between 1 and 200`,
    ),
    ...ownRowPolicies("recurring_streams"),
    pgPolicy("recurring_streams_update_own", {
      for: "update",
      to: appRole,
      using: ownRow,
      withCheck: ownRow,
    }),
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
