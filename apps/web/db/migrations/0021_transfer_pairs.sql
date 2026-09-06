CREATE TABLE "transfer_pairs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"outflow_transaction_id" uuid NOT NULL,
	"inflow_transaction_id" uuid NOT NULL,
	"dismissed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transfer_pairs_combo_unique" UNIQUE("outflow_transaction_id","inflow_transaction_id"),
	CONSTRAINT "transfer_pairs_distinct_halves" CHECK (outflow_transaction_id <> inflow_transaction_id)
);
--> statement-breakpoint
ALTER TABLE "transfer_pairs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_id_user_id_unique" UNIQUE("id","user_id");--> statement-breakpoint
ALTER TABLE "transfer_pairs" ADD CONSTRAINT "transfer_pairs_outflow_user_fk" FOREIGN KEY ("outflow_transaction_id","user_id") REFERENCES "public"."transactions"("id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfer_pairs" ADD CONSTRAINT "transfer_pairs_inflow_user_fk" FOREIGN KEY ("inflow_transaction_id","user_id") REFERENCES "public"."transactions"("id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "transfer_pairs_active_outflow_key" ON "transfer_pairs" USING btree ("outflow_transaction_id") WHERE dismissed_at is null;--> statement-breakpoint
CREATE UNIQUE INDEX "transfer_pairs_active_inflow_key" ON "transfer_pairs" USING btree ("inflow_transaction_id") WHERE dismissed_at is null;--> statement-breakpoint
CREATE INDEX "transfer_pairs_inflow_idx" ON "transfer_pairs" USING btree ("inflow_transaction_id");--> statement-breakpoint
CREATE INDEX "transfer_pairs_user_id_idx" ON "transfer_pairs" USING btree ("user_id");--> statement-breakpoint
CREATE POLICY "transfer_pairs_select_own" ON "transfer_pairs" AS PERMISSIVE FOR SELECT TO "cashlens_app" USING (user_id = (select app_current_user_id()));--> statement-breakpoint
CREATE POLICY "transfer_pairs_insert_own" ON "transfer_pairs" AS PERMISSIVE FOR INSERT TO "cashlens_app" WITH CHECK (user_id = (select app_current_user_id()));--> statement-breakpoint
CREATE POLICY "transfer_pairs_update_own" ON "transfer_pairs" AS PERMISSIVE FOR UPDATE TO "cashlens_app" USING (user_id = (select app_current_user_id())) WITH CHECK (user_id = (select app_current_user_id()));--> statement-breakpoint
CREATE POLICY "transfer_pairs_delete_own" ON "transfer_pairs" AS PERMISSIVE FOR DELETE TO "cashlens_app" USING (user_id = (select app_current_user_id()));