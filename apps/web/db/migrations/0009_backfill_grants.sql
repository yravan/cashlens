GRANT UPDATE ("backfill_status", "sync_cursor") ON TABLE "connections" TO "cashlens_app";--> statement-breakpoint
GRANT UPDATE ("available_minor", "current_minor", "limit_minor", "as_of") ON TABLE "account_balances" TO "cashlens_app";
