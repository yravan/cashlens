ALTER TABLE "classification_runs" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "classification_proposals" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON TABLE "classification_runs", "classification_proposals" FROM "cashlens_app";--> statement-breakpoint
GRANT SELECT, INSERT ON TABLE "classification_runs", "classification_proposals" TO "cashlens_app";--> statement-breakpoint
GRANT UPDATE (
  "status", "response_model", "proposal_set_hash", "result_set_hash",
  "attempted", "proposed", "applied", "skipped", "conflicted",
  "provider_input_tokens", "provider_output_tokens", "provider_generation_id",
  "approved_at", "applied_at", "inference_lease_until", "updated_at"
) ON TABLE "classification_runs" TO "cashlens_app";--> statement-breakpoint
GRANT UPDATE (
  "state", "applied_category_revision", "applied_updated_at", "applied_at", "skipped_at",
  "conflicted_at", "rolled_back_at", "updated_at"
) ON TABLE "classification_proposals" TO "cashlens_app";--> statement-breakpoint
GRANT UPDATE ("category_run_id", "category_revision") ON TABLE "transactions" TO "cashlens_app";--> statement-breakpoint
-- Preserve references until the complete owner-deletion cascade reaches commit.
ALTER TABLE "classification_proposals" ALTER CONSTRAINT "classification_proposals_category_owner_fk" DEFERRABLE INITIALLY DEFERRED;--> statement-breakpoint
ALTER TABLE "classification_proposals" ALTER CONSTRAINT "classification_proposals_before_category_owner_fk" DEFERRABLE INITIALLY DEFERRED;--> statement-breakpoint
ALTER TABLE "classification_proposals" ALTER CONSTRAINT "classification_proposals_before_run_owner_fk" DEFERRABLE INITIALLY DEFERRED;--> statement-breakpoint
ALTER TABLE "transactions" ALTER CONSTRAINT "transactions_category_run_user_fk" DEFERRABLE INITIALLY DEFERRED;
