ALTER TABLE "categories" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON TABLE "categories" FROM "cashlens_app";--> statement-breakpoint
GRANT SELECT, INSERT ON TABLE "categories" TO "cashlens_app";--> statement-breakpoint
GRANT UPDATE ("category_id") ON TABLE "transactions" TO "cashlens_app";
