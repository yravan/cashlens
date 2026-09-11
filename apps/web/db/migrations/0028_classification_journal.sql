CREATE TYPE "public"."classification_proposal_state" AS ENUM('proposed', 'applied', 'skipped', 'conflicted', 'rolled_back', 'rollback_conflict');--> statement-breakpoint
CREATE TYPE "public"."classification_run_kind" AS ENUM('automatic_initial', 'automatic_reclassification');--> statement-breakpoint
CREATE TYPE "public"."classification_run_status" AS ENUM('inferring', 'succeeded', 'proposed', 'applied', 'partially_applied', 'rolled_back', 'partially_rolled_back', 'expired', 'cancelled', 'failed');--> statement-breakpoint
CREATE TABLE "classification_proposals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"run_kind" "classification_run_kind" DEFAULT 'automatic_reclassification' NOT NULL,
	"transaction_id" uuid NOT NULL,
	"proposed_category_id" uuid NOT NULL,
	"proposed_confidence" "category_confidence" NOT NULL,
	"proposed_reason" text NOT NULL,
	"before_category_id" uuid NOT NULL,
	"before_category_source" "category_source" NOT NULL,
	"before_category_confidence" "category_confidence",
	"before_category_reason" text,
	"before_category_run_id" uuid,
	"before_category_revision" bigint NOT NULL,
	"before_updated_at" timestamp with time zone NOT NULL,
	"applied_category_revision" bigint,
	"applied_updated_at" timestamp with time zone,
	"state" "classification_proposal_state" DEFAULT 'proposed' NOT NULL,
	"applied_at" timestamp with time zone,
	"skipped_at" timestamp with time zone,
	"conflicted_at" timestamp with time zone,
	"rolled_back_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "classification_proposals_run_transaction_unique" UNIQUE("run_id","transaction_id"),
	CONSTRAINT "classification_proposals_before_auto" CHECK (before_category_source = 'auto'),
	CONSTRAINT "classification_proposals_run_kind" CHECK (run_kind = 'automatic_reclassification'),
	CONSTRAINT "classification_proposals_before_reason_bounded" CHECK (before_category_reason is null or char_length(before_category_reason) between 1 and 200),
	CONSTRAINT "classification_proposals_proposed_reason_bounded" CHECK (char_length(proposed_reason) between 1 and 200),
	CONSTRAINT "classification_proposals_state_scope" CHECK ((state in ('proposed', 'skipped', 'conflicted')
          and applied_category_revision is null and applied_updated_at is null)
        or (state in ('applied', 'rolled_back', 'rollback_conflict')
          and applied_category_revision is not null and applied_updated_at is not null)),
	CONSTRAINT "classification_proposals_revisions_nonnegative" CHECK (before_category_revision >= 0
        and (applied_category_revision is null or applied_category_revision > before_category_revision))
);
--> statement-breakpoint
ALTER TABLE "classification_proposals" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "classification_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"kind" "classification_run_kind" NOT NULL,
	"status" "classification_run_status" NOT NULL,
	"requested_model" text NOT NULL,
	"response_model" text,
	"prompt_version" text NOT NULL,
	"assignment_schema_version" text NOT NULL,
	"taxonomy_fingerprint" text NOT NULL,
	"provider_policy_fingerprint" text NOT NULL,
	"proposal_set_hash" text,
	"result_set_hash" text,
	"batch_size" integer NOT NULL,
	"attempted" integer DEFAULT 0 NOT NULL,
	"proposed" integer DEFAULT 0 NOT NULL,
	"applied" integer DEFAULT 0 NOT NULL,
	"skipped" integer DEFAULT 0 NOT NULL,
	"conflicted" integer DEFAULT 0 NOT NULL,
	"provider_input_tokens" integer,
	"provider_output_tokens" integer,
	"provider_generation_id" text,
	"operator_actor" text,
	"approved_at" timestamp with time zone,
	"applied_at" timestamp with time zone,
	"inference_lease_until" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "classification_runs_id_owner_unique" UNIQUE("id","owner_user_id"),
	CONSTRAINT "classification_runs_id_owner_kind_unique" UNIQUE("id","owner_user_id","kind"),
	CONSTRAINT "classification_runs_batch_size_bounded" CHECK (batch_size between 1 and 40),
	CONSTRAINT "classification_runs_counts_nonnegative" CHECK (attempted >= 0 and proposed >= 0 and applied >= 0 and skipped >= 0 and conflicted >= 0),
	CONSTRAINT "classification_runs_usage_nonnegative" CHECK ((provider_input_tokens is null or provider_input_tokens >= 0)
        and (provider_output_tokens is null or provider_output_tokens >= 0)),
	CONSTRAINT "classification_runs_identity_bounded" CHECK (char_length(requested_model) between 1 and 200
        and (response_model is null or char_length(response_model) between 1 and 200)
        and char_length(prompt_version) between 1 and 100
        and char_length(assignment_schema_version) between 1 and 100
        and (provider_generation_id is null or char_length(provider_generation_id) between 1 and 200)
        and (operator_actor is null or char_length(operator_actor) between 1 and 200)),
	CONSTRAINT "classification_runs_fingerprints_valid" CHECK (taxonomy_fingerprint ~ '^[0-9a-f]{64}$'
        and provider_policy_fingerprint ~ '^[0-9a-f]{64}$'
        and (proposal_set_hash is null or proposal_set_hash ~ '^[0-9a-f]{64}$')
        and (result_set_hash is null or result_set_hash ~ '^[0-9a-f]{64}$')),
	CONSTRAINT "classification_runs_kind_scope" CHECK ((kind = 'automatic_initial' and operator_actor is null and expires_at is null)
        or (kind = 'automatic_reclassification' and operator_actor is not null and expires_at is not null)),
	CONSTRAINT "classification_runs_status_scope" CHECK ((kind = 'automatic_initial'
          and status in ('inferring', 'succeeded', 'expired', 'cancelled', 'failed'))
        or (kind = 'automatic_reclassification'
          and status in ('inferring', 'proposed', 'applied', 'partially_applied',
            'rolled_back', 'partially_rolled_back', 'expired', 'cancelled', 'failed')))
);
--> statement-breakpoint
ALTER TABLE "classification_runs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "category_run_id" uuid;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "category_revision" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "classification_proposals" ADD CONSTRAINT "classification_proposals_run_owner_fk" FOREIGN KEY ("run_id","owner_user_id","run_kind") REFERENCES "public"."classification_runs"("id","owner_user_id","kind") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "classification_proposals" ADD CONSTRAINT "classification_proposals_transaction_owner_fk" FOREIGN KEY ("transaction_id","owner_user_id") REFERENCES "public"."transactions"("id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "classification_proposals" ADD CONSTRAINT "classification_proposals_category_owner_fk" FOREIGN KEY ("proposed_category_id","owner_user_id") REFERENCES "public"."categories"("id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "classification_proposals" ADD CONSTRAINT "classification_proposals_before_category_owner_fk" FOREIGN KEY ("before_category_id","owner_user_id") REFERENCES "public"."categories"("id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "classification_proposals" ADD CONSTRAINT "classification_proposals_before_run_owner_fk" FOREIGN KEY ("before_category_run_id","owner_user_id") REFERENCES "public"."classification_runs"("id","owner_user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "classification_runs" ADD CONSTRAINT "classification_runs_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "classification_proposals_owner_run_idx" ON "classification_proposals" USING btree ("owner_user_id","run_id");--> statement-breakpoint
CREATE INDEX "classification_proposals_transaction_idx" ON "classification_proposals" USING btree ("transaction_id");--> statement-breakpoint
CREATE UNIQUE INDEX "classification_runs_owner_inferring_key" ON "classification_runs" USING btree ("owner_user_id") WHERE status = 'inferring';--> statement-breakpoint
CREATE INDEX "classification_runs_owner_created_idx" ON "classification_runs" USING btree ("owner_user_id","created_at");--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_category_run_user_fk" FOREIGN KEY ("category_run_id","user_id") REFERENCES "public"."classification_runs"("id","owner_user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_category_run_scope" CHECK (category_run_id is null or category_source is not distinct from 'auto');--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_category_revision_nonnegative" CHECK (category_revision >= 0);--> statement-breakpoint
CREATE POLICY "classification_proposals_select_own" ON "classification_proposals" AS PERMISSIVE FOR SELECT TO "cashlens_app" USING (owner_user_id = (select app_current_user_id()));--> statement-breakpoint
CREATE POLICY "classification_proposals_insert_own" ON "classification_proposals" AS PERMISSIVE FOR INSERT TO "cashlens_app" WITH CHECK (owner_user_id = (select app_current_user_id()));--> statement-breakpoint
CREATE POLICY "classification_proposals_update_own" ON "classification_proposals" AS PERMISSIVE FOR UPDATE TO "cashlens_app" USING (owner_user_id = (select app_current_user_id())) WITH CHECK (owner_user_id = (select app_current_user_id()));--> statement-breakpoint
CREATE POLICY "classification_runs_select_own" ON "classification_runs" AS PERMISSIVE FOR SELECT TO "cashlens_app" USING (owner_user_id = (select app_current_user_id()));--> statement-breakpoint
CREATE POLICY "classification_runs_insert_own" ON "classification_runs" AS PERMISSIVE FOR INSERT TO "cashlens_app" WITH CHECK (owner_user_id = (select app_current_user_id()));--> statement-breakpoint
CREATE POLICY "classification_runs_update_own" ON "classification_runs" AS PERMISSIVE FOR UPDATE TO "cashlens_app" USING (owner_user_id = (select app_current_user_id())) WITH CHECK (owner_user_id = (select app_current_user_id()));