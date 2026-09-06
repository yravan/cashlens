ALTER TABLE "transfer_pairs" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON TABLE "transfer_pairs" FROM "cashlens_app";--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON TABLE "transfer_pairs" TO "cashlens_app";--> statement-breakpoint
GRANT UPDATE ("dismissed_at", "updated_at") ON TABLE "transfer_pairs" TO "cashlens_app";
