CREATE TYPE "public"."scheduled_obligation_cadence" AS ENUM('once', 'weekly', 'biweekly', 'monthly', 'annual');--> statement-breakpoint
CREATE TABLE "scheduled_obligations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"name" text NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" char(3) NOT NULL,
	"cadence" "scheduled_obligation_cadence" NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date,
	"ended_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "scheduled_obligations_id_user_id_unique" UNIQUE("id","user_id"),
	CONSTRAINT "scheduled_obligations_amount_positive_safe" CHECK (amount_minor > 0 and amount_minor <= 9007199254740991),
	CONSTRAINT "scheduled_obligations_currency_iso4217" CHECK (currency ~ '^[A-Z]{3}$'),
	CONSTRAINT "scheduled_obligations_name_trimmed" CHECK (name = btrim(name) and char_length(name) between 1 and 200),
	CONSTRAINT "scheduled_obligations_end_ordered" CHECK (ends_on is null or ends_on >= starts_on),
	CONSTRAINT "scheduled_obligations_once_unbounded" CHECK (cadence <> 'once' or ends_on is null)
);
--> statement-breakpoint
ALTER TABLE "scheduled_obligations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "scheduled_obligations" ADD CONSTRAINT "scheduled_obligations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_obligations" ADD CONSTRAINT "scheduled_obligations_account_user_fk" FOREIGN KEY ("account_id","user_id") REFERENCES "public"."accounts"("id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "scheduled_obligations_account_user_idx" ON "scheduled_obligations" USING btree ("account_id","user_id");--> statement-breakpoint
CREATE INDEX "scheduled_obligations_active_user_start_idx" ON "scheduled_obligations" USING btree ("user_id","starts_on") WHERE ended_at is null;--> statement-breakpoint
CREATE POLICY "scheduled_obligations_select_own" ON "scheduled_obligations" AS PERMISSIVE FOR SELECT TO "cashlens_app" USING (user_id = (select app_current_user_id()));--> statement-breakpoint
CREATE POLICY "scheduled_obligations_insert_own" ON "scheduled_obligations" AS PERMISSIVE FOR INSERT TO "cashlens_app" WITH CHECK (user_id = (select app_current_user_id()));--> statement-breakpoint
CREATE POLICY "scheduled_obligations_update_own" ON "scheduled_obligations" AS PERMISSIVE FOR UPDATE TO "cashlens_app" USING (user_id = (select app_current_user_id())) WITH CHECK (user_id = (select app_current_user_id()));