ALTER TABLE "public"."account_balance_snapshots" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DO $$
BEGIN
  CREATE POLICY "balance_snapshot_bootstrap_accounts" ON "public"."accounts"
    FOR SELECT TO "cashlens_owner" USING (true);
  CREATE POLICY "balance_snapshot_bootstrap_balances" ON "public"."account_balances"
    FOR SELECT TO "cashlens_owner" USING (true);
  CREATE POLICY "balance_snapshot_bootstrap_select" ON "public"."account_balance_snapshots"
    FOR SELECT TO "cashlens_owner" USING (true);
  CREATE POLICY "balance_snapshot_bootstrap_insert" ON "public"."account_balance_snapshots"
    FOR INSERT TO "cashlens_owner" WITH CHECK (true);

  INSERT INTO "public"."account_balance_snapshots" (
    "account_id", "user_id", "snapshot_day", "current_minor", "currency",
    "source", "capture_reason", "observed_at", "provider_as_of"
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
      WHEN account."source" = 'manual' THEN 'manual_anchor'::"public"."balance_snapshot_source"
      ELSE 'provider'::"public"."balance_snapshot_source"
    END,
    'bootstrap'::"public"."balance_capture_reason",
    balance."as_of",
    NULL
  FROM "public"."account_balances" balance
  JOIN "public"."accounts" account
    ON account."id" = balance."account_id"
    AND account."user_id" = balance."user_id"
  WHERE balance."current_minor" IS NOT NULL
    AND (
      account."source" = 'plaid'
      OR (account."source" = 'manual' AND balance."reported_on" IS NOT NULL)
    )
  ON CONFLICT ("account_id", "snapshot_day") DO NOTHING;

  DROP POLICY "balance_snapshot_bootstrap_accounts" ON "public"."accounts";
  DROP POLICY "balance_snapshot_bootstrap_balances" ON "public"."account_balances";
  DROP POLICY "balance_snapshot_bootstrap_select" ON "public"."account_balance_snapshots";
  DROP POLICY "balance_snapshot_bootstrap_insert" ON "public"."account_balance_snapshots";
END
$$;--> statement-breakpoint
REVOKE ALL ON TABLE "public"."account_balance_snapshots" FROM "cashlens_app";--> statement-breakpoint
GRANT SELECT ON TABLE "public"."account_balance_snapshots" TO "cashlens_app";--> statement-breakpoint
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
) ON TABLE "public"."account_balance_snapshots" TO "cashlens_app";--> statement-breakpoint
GRANT UPDATE (
  "current_minor",
  "capture_reason",
  "observed_at",
  "provider_as_of",
  "updated_at"
) ON TABLE "public"."account_balance_snapshots" TO "cashlens_app";
