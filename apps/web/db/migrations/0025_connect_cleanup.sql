ALTER TYPE "public"."connection_status" ADD VALUE 'provisioning' BEFORE 'active';--> statement-breakpoint
ALTER TYPE "public"."connection_status" ADD VALUE 'cleanup_required' BEFORE 'disconnected';