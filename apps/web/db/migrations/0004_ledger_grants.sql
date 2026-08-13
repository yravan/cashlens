ALTER TABLE "accounts" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "transactions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "account_balances" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON TABLE "accounts", "transactions", "account_balances" FROM "cashlens_app";--> statement-breakpoint
GRANT SELECT, INSERT ON TABLE "accounts", "transactions", "account_balances" TO "cashlens_app";
