CREATE TABLE "pm_round_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversationId" uuid NOT NULL,
	"roundId" uuid NOT NULL,
	"seq" integer NOT NULL,
	"kind" text NOT NULL,
	"payload" jsonb NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "conversation_message" ADD COLUMN "roundId" uuid;--> statement-breakpoint
ALTER TABLE "pm_round_event" ADD CONSTRAINT "pm_round_event_conversationId_conversation_id_fk" FOREIGN KEY ("conversationId") REFERENCES "public"."conversation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pm_round_event_round_idx" ON "pm_round_event" USING btree ("conversationId","roundId","seq");