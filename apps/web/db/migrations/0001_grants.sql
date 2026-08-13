ALTER TABLE "users" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT ON TABLE "users" TO "cashlens_app";--> statement-breakpoint
ALTER DEFAULT PRIVILEGES FOR ROLE "cashlens_owner" IN SCHEMA "public" GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO "cashlens_app";
