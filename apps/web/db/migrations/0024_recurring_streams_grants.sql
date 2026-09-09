ALTER TABLE "recurring_streams" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON TABLE "recurring_streams" FROM "cashlens_app";--> statement-breakpoint
GRANT SELECT, INSERT ON TABLE "recurring_streams" TO "cashlens_app";--> statement-breakpoint
GRANT UPDATE ("status", "updated_at") ON TABLE "recurring_streams" TO "cashlens_app";
