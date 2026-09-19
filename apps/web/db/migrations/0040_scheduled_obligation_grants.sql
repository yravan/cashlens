ALTER TABLE "scheduled_obligations" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON TABLE "scheduled_obligations" FROM "cashlens_app";--> statement-breakpoint
GRANT SELECT ON TABLE "scheduled_obligations" TO "cashlens_app";--> statement-breakpoint
GRANT INSERT ("user_id", "account_id", "name", "amount_minor", "currency", "cadence", "starts_on", "ends_on") ON TABLE "scheduled_obligations" TO "cashlens_app";--> statement-breakpoint
GRANT UPDATE ("account_id", "name", "amount_minor", "currency", "cadence", "starts_on", "ends_on", "ended_at", "updated_at") ON TABLE "scheduled_obligations" TO "cashlens_app";
