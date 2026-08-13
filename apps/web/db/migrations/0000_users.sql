CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clerk_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_clerk_user_id_unique" UNIQUE("clerk_user_id")
);
--> statement-breakpoint
ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "users_select_self" ON "users" AS PERMISSIVE FOR SELECT TO "cashlens_app" USING (clerk_user_id = current_setting('app.clerk_user_id', true));--> statement-breakpoint
CREATE POLICY "users_insert_self" ON "users" AS PERMISSIVE FOR INSERT TO "cashlens_app" WITH CHECK (clerk_user_id = current_setting('app.clerk_user_id', true));