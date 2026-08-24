ALTER TABLE "connections" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "connection_credentials" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON TABLE "connections", "connection_credentials" FROM "cashlens_app";--> statement-breakpoint
GRANT SELECT, INSERT ON TABLE "connections" TO "cashlens_app";--> statement-breakpoint
GRANT UPDATE ("status", "updated_at") ON TABLE "connections" TO "cashlens_app";--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON TABLE "connection_credentials" TO "cashlens_app";
