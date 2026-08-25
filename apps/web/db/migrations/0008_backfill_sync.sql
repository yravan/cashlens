CREATE TYPE "public"."backfill_status" AS ENUM('in_progress', 'complete');--> statement-breakpoint
ALTER TABLE "connections" ADD COLUMN "backfill_status" "backfill_status" DEFAULT 'in_progress' NOT NULL;--> statement-breakpoint
ALTER TABLE "connections" ADD COLUMN "sync_cursor" text;--> statement-breakpoint
CREATE POLICY "account_balances_update_own" ON "account_balances" AS PERMISSIVE FOR UPDATE TO "cashlens_app" USING (user_id = (select app_current_user_id())) WITH CHECK (user_id = (select app_current_user_id()));