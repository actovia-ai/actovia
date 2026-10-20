CREATE TYPE "public"."agent_runtime" AS ENUM('actovia', 'claude-code');--> statement-breakpoint
CREATE TYPE "public"."agent_session_state" AS ENUM('working', 'blocked', 'done', 'stopped', 'error');--> statement-breakpoint
CREATE TABLE "agent_session" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"projectId" uuid NOT NULL,
	"agentId" uuid,
	"conversationId" uuid NOT NULL,
	"runtime" text NOT NULL,
	"cliSessionId" text,
	"cwd" text NOT NULL,
	"branch" text,
	"state" "agent_session_state" DEFAULT 'working' NOT NULL,
	"messageId" uuid,
	"continuedInTerminal" boolean DEFAULT false NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"dir" text NOT NULL,
	"workDir" text NOT NULL,
	"useWorktrees" boolean DEFAULT true NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"lastUsedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "project_dir_unique" UNIQUE("dir")
);
--> statement-breakpoint
ALTER TABLE "agent" ADD COLUMN "runtime" "agent_runtime" DEFAULT 'actovia' NOT NULL;--> statement-breakpoint
ALTER TABLE "agent" ADD COLUMN "permissionMode" text;--> statement-breakpoint
ALTER TABLE "conversation" ADD COLUMN "projectId" uuid;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "agents" jsonb;--> statement-breakpoint
ALTER TABLE "agent_session" ADD CONSTRAINT "agent_session_projectId_project_id_fk" FOREIGN KEY ("projectId") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_session" ADD CONSTRAINT "agent_session_agentId_agent_id_fk" FOREIGN KEY ("agentId") REFERENCES "public"."agent"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_session" ADD CONSTRAINT "agent_session_conversationId_conversation_id_fk" FOREIGN KEY ("conversationId") REFERENCES "public"."conversation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_session_project_agent_idx" ON "agent_session" USING btree ("projectId","agentId");--> statement-breakpoint
ALTER TABLE "conversation" ADD CONSTRAINT "conversation_projectId_project_id_fk" FOREIGN KEY ("projectId") REFERENCES "public"."project"("id") ON DELETE set null ON UPDATE no action;