ALTER TABLE "paired_device" ADD COLUMN "kind" text DEFAULT 'ios' NOT NULL;--> statement-breakpoint
ALTER TABLE "paired_device" ADD COLUMN "webCredential" jsonb;