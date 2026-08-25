ALTER TABLE "accounts" ADD COLUMN "connection_id" uuid;--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_connection_user_fk" FOREIGN KEY ("connection_id","user_id") REFERENCES "public"."connections"("id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "accounts_connection_id_idx" ON "accounts" USING btree ("connection_id");