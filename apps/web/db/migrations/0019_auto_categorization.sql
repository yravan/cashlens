CREATE TYPE "public"."category_confidence" AS ENUM('low', 'medium', 'high');--> statement-breakpoint
CREATE TYPE "public"."category_source" AS ENUM('user', 'auto');--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "category_source" "category_source";--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "category_confidence" "category_confidence";--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "category_reason" text;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_category_source_scope" CHECK (category_id is not null or category_source is null);--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_auto_fields_scope" CHECK ((category_confidence is null and category_reason is null) or category_source = 'auto');--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_category_reason_bounded" CHECK (category_reason is null or char_length(category_reason) between 1 and 200);