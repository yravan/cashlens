INSERT INTO "account_balance_snapshots" (
  "account_id",
  "user_id",
  "snapshot_day",
  "current_minor",
  "currency",
  "source",
  "capture_reason",
  "observed_at",
  "provider_as_of"
)
SELECT
  balance."account_id",
  balance."user_id",
  CASE
    WHEN account."source" = 'manual' THEN balance."reported_on"
    ELSE (balance."as_of" AT TIME ZONE 'UTC')::date
  END,
  balance."current_minor",
  account."currency",
  CASE
    WHEN account."source" = 'manual' THEN 'manual_anchor'::"balance_snapshot_source"
    ELSE 'provider'::"balance_snapshot_source"
  END,
  'bootstrap'::"balance_capture_reason",
  balance."as_of",
  NULL
FROM "account_balances" balance
JOIN "accounts" account
  ON account."id" = balance."account_id"
  AND account."user_id" = balance."user_id"
WHERE balance."current_minor" IS NOT NULL
  AND (
    account."source" = 'plaid'
    OR (account."source" = 'manual' AND balance."reported_on" IS NOT NULL)
  )
ON CONFLICT ("account_id", "snapshot_day") DO NOTHING;--> statement-breakpoint
ALTER TABLE "account_balance_snapshots" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON TABLE "account_balance_snapshots" FROM "cashlens_app";--> statement-breakpoint
GRANT SELECT ON TABLE "account_balance_snapshots" TO "cashlens_app";--> statement-breakpoint
GRANT INSERT (
  "account_id",
  "user_id",
  "snapshot_day",
  "current_minor",
  "currency",
  "source",
  "capture_reason",
  "observed_at",
  "provider_as_of"
) ON TABLE "account_balance_snapshots" TO "cashlens_app";--> statement-breakpoint
GRANT UPDATE (
  "current_minor",
  "capture_reason",
  "observed_at",
  "provider_as_of",
  "updated_at"
) ON TABLE "account_balance_snapshots" TO "cashlens_app";
