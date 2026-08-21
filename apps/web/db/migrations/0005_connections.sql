CREATE TYPE "public"."connection_provider" AS ENUM('plaid');--> statement-breakpoint
CREATE TYPE "public"."connection_status" AS ENUM('active', 'disconnected');--> statement-breakpoint
CREATE TABLE "connection_credentials" (
	"connection_id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"ciphertext" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "connection_credentials" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"provider" "connection_provider" NOT NULL,
	"provider_item_id" text,
	"institution_id" text,
	"institution_name" text,
	"status" "connection_status" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "connections_id_user_id_unique" UNIQUE("id","user_id")
);
--> statement-breakpoint
ALTER TABLE "connections" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "connection_credentials" ADD CONSTRAINT "connection_credentials_connection_user_fk" FOREIGN KEY ("connection_id","user_id") REFERENCES "public"."connections"("id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connections" ADD CONSTRAINT "connections_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "connection_credentials_user_id_idx" ON "connection_credentials" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "connections_user_provider_item_key" ON "connections" USING btree ("user_id","provider","provider_item_id") WHERE provider_item_id is not null;--> statement-breakpoint
CREATE INDEX "connections_user_id_idx" ON "connections" USING btree ("user_id");--> statement-breakpoint
CREATE POLICY "connection_credentials_select_own" ON "connection_credentials" AS PERMISSIVE FOR SELECT TO "cashlens_app" USING (user_id = (select app_current_user_id()));--> statement-breakpoint
CREATE POLICY "connection_credentials_insert_own" ON "connection_credentials" AS PERMISSIVE FOR INSERT TO "cashlens_app" WITH CHECK (user_id = (select app_current_user_id()));--> statement-breakpoint
CREATE POLICY "connection_credentials_delete_own" ON "connection_credentials" AS PERMISSIVE FOR DELETE TO "cashlens_app" USING (user_id = (select app_current_user_id()));--> statement-breakpoint
CREATE POLICY "connections_select_own" ON "connections" AS PERMISSIVE FOR SELECT TO "cashlens_app" USING (user_id = (select app_current_user_id()));--> statement-breakpoint
CREATE POLICY "connections_insert_own" ON "connections" AS PERMISSIVE FOR INSERT TO "cashlens_app" WITH CHECK (user_id = (select app_current_user_id()));--> statement-breakpoint
CREATE POLICY "connections_update_own" ON "connections" AS PERMISSIVE FOR UPDATE TO "cashlens_app" USING (user_id = (select app_current_user_id())) WITH CHECK (user_id = (select app_current_user_id()));