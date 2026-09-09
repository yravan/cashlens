CREATE TYPE "public"."flow_direction" AS ENUM('inflow', 'outflow');--> statement-breakpoint
CREATE TYPE "public"."recurring_stream_status" AS ENUM('confirmed', 'dismissed');--> statement-breakpoint
CREATE TABLE "recurring_streams" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"currency" char(3) NOT NULL,
	"direction" "flow_direction" NOT NULL,
	"normalized_name" text NOT NULL,
	"status" "recurring_stream_status" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recurring_streams_currency_iso4217" CHECK (currency ~ '^[A-Z]{3}$'),
	CONSTRAINT "recurring_streams_name_bounded" CHECK (normalized_name = btrim(normalized_name) and char_length(normalized_name) between 1 and 200)
);
--> statement-breakpoint
ALTER TABLE "recurring_streams" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "recurring_streams" ADD CONSTRAINT "recurring_streams_account_user_fk" FOREIGN KEY ("account_id","user_id") REFERENCES "public"."accounts"("id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "recurring_streams_identity_key" ON "recurring_streams" USING btree ("account_id","currency","direction","normalized_name");--> statement-breakpoint
CREATE INDEX "recurring_streams_user_id_idx" ON "recurring_streams" USING btree ("user_id");--> statement-breakpoint
CREATE POLICY "recurring_streams_select_own" ON "recurring_streams" AS PERMISSIVE FOR SELECT TO "cashlens_app" USING (user_id = (select app_current_user_id()));--> statement-breakpoint
CREATE POLICY "recurring_streams_insert_own" ON "recurring_streams" AS PERMISSIVE FOR INSERT TO "cashlens_app" WITH CHECK (user_id = (select app_current_user_id()));--> statement-breakpoint
CREATE POLICY "recurring_streams_update_own" ON "recurring_streams" AS PERMISSIVE FOR UPDATE TO "cashlens_app" USING (user_id = (select app_current_user_id())) WITH CHECK (user_id = (select app_current_user_id()));