CREATE TYPE "public"."account_type" AS ENUM('depository', 'credit', 'loan', 'investment', 'other');--> statement-breakpoint
CREATE TYPE "public"."ledger_source" AS ENUM('plaid', 'manual', 'import');--> statement-breakpoint
CREATE TYPE "public"."transaction_status" AS ENUM('pending', 'posted');--> statement-breakpoint
CREATE TABLE "account_balances" (
	"account_id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"available_minor" bigint,
	"current_minor" bigint,
	"limit_minor" bigint,
	"as_of" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "account_balances_reported_figure" CHECK (available_minor is not null or current_minor is not null)
);
--> statement-breakpoint
ALTER TABLE "account_balances" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"type" "account_type" NOT NULL,
	"subtype" text,
	"mask" text,
	"currency" char(3) NOT NULL,
	"source" "ledger_source" NOT NULL,
	"source_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "accounts_id_user_id_unique" UNIQUE("id","user_id"),
	CONSTRAINT "accounts_currency_iso4217" CHECK (currency ~ '^[A-Z]{3}$')
);
--> statement-breakpoint
ALTER TABLE "accounts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" char(3) NOT NULL,
	"date" date NOT NULL,
	"description" text NOT NULL,
	"merchant" text,
	"status" "transaction_status" NOT NULL,
	"source" "ledger_source" NOT NULL,
	"source_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transactions_currency_iso4217" CHECK (currency ~ '^[A-Z]{3}$')
);
--> statement-breakpoint
ALTER TABLE "transactions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "account_balances" ADD CONSTRAINT "account_balances_account_user_fk" FOREIGN KEY ("account_id","user_id") REFERENCES "public"."accounts"("id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_account_user_fk" FOREIGN KEY ("account_id","user_id") REFERENCES "public"."accounts"("id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_balances_user_id_idx" ON "account_balances" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "accounts_user_source_row_key" ON "accounts" USING btree ("user_id","source","source_id") WHERE source_id is not null;--> statement-breakpoint
CREATE INDEX "accounts_user_id_idx" ON "accounts" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "transactions_account_source_row_key" ON "transactions" USING btree ("account_id","source","source_id") WHERE source_id is not null;--> statement-breakpoint
CREATE INDEX "transactions_user_date_idx" ON "transactions" USING btree ("user_id","date");--> statement-breakpoint
CREATE INDEX "transactions_account_date_idx" ON "transactions" USING btree ("account_id","date");--> statement-breakpoint
CREATE POLICY "account_balances_select_own" ON "account_balances" AS PERMISSIVE FOR SELECT TO "cashlens_app" USING (user_id = (select app_current_user_id()));--> statement-breakpoint
CREATE POLICY "account_balances_insert_own" ON "account_balances" AS PERMISSIVE FOR INSERT TO "cashlens_app" WITH CHECK (user_id = (select app_current_user_id()));--> statement-breakpoint
CREATE POLICY "accounts_select_own" ON "accounts" AS PERMISSIVE FOR SELECT TO "cashlens_app" USING (user_id = (select app_current_user_id()));--> statement-breakpoint
CREATE POLICY "accounts_insert_own" ON "accounts" AS PERMISSIVE FOR INSERT TO "cashlens_app" WITH CHECK (user_id = (select app_current_user_id()));--> statement-breakpoint
CREATE POLICY "transactions_select_own" ON "transactions" AS PERMISSIVE FOR SELECT TO "cashlens_app" USING (user_id = (select app_current_user_id()));--> statement-breakpoint
CREATE POLICY "transactions_insert_own" ON "transactions" AS PERMISSIVE FOR INSERT TO "cashlens_app" WITH CHECK (user_id = (select app_current_user_id()));