CREATE TYPE "public"."balance_capture_reason" AS ENUM('event', 'bootstrap', 'reconciliation');--> statement-breakpoint
CREATE TYPE "public"."balance_snapshot_source" AS ENUM('provider', 'manual_anchor');--> statement-breakpoint
CREATE TABLE "account_balance_snapshots" (
	"account_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"snapshot_day" date NOT NULL,
	"current_minor" bigint NOT NULL,
	"currency" char(3) NOT NULL,
	"source" "balance_snapshot_source" NOT NULL,
	"capture_reason" "balance_capture_reason" NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"provider_as_of" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "account_balance_snapshots_account_day_pk" PRIMARY KEY("account_id","snapshot_day"),
	CONSTRAINT "account_balance_snapshots_currency_iso4217" CHECK (currency ~ '^[A-Z]{3}$')
);
--> statement-breakpoint
ALTER TABLE "account_balance_snapshots" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "account_balance_snapshots" ADD CONSTRAINT "account_balance_snapshots_account_user_fk" FOREIGN KEY ("account_id","user_id") REFERENCES "public"."accounts"("id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_balance_snapshots_user_day_account_idx" ON "account_balance_snapshots" USING btree ("user_id","snapshot_day","account_id");--> statement-breakpoint
CREATE POLICY "account_balance_snapshots_select_own" ON "account_balance_snapshots" AS PERMISSIVE FOR SELECT TO "cashlens_app" USING (user_id = (select app_current_user_id()));--> statement-breakpoint
CREATE POLICY "account_balance_snapshots_insert_own" ON "account_balance_snapshots" AS PERMISSIVE FOR INSERT TO "cashlens_app" WITH CHECK (user_id = (select app_current_user_id()));--> statement-breakpoint
CREATE POLICY "account_balance_snapshots_update_own" ON "account_balance_snapshots" AS PERMISSIVE FOR UPDATE TO "cashlens_app" USING (user_id = (select app_current_user_id())) WITH CHECK (user_id = (select app_current_user_id()));