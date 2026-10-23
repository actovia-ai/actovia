-- Every timestamp column is `timestamp` without a time zone, and drizzle
-- writes and reads it as UTC wall clock. Until now the session ran in the
-- zone PGlite's initdb wrote into postgresql.conf (the OS zone as a fixed
-- offset, e.g. 'Etc/GMT-8' in Shanghai), so a value stamped by a column's
-- DEFAULT now() held local wall clock and read back shifted by the offset.
-- The session is pinned to UTC now (`pinSessionUtc`, db/session.ts); this
-- moves what the defaults wrote onto UTC. The zone they were written in is
-- still readable as TimeZone's reset_val, which the pin does not change.
--
-- A column only a DEFAULT ever writes is converted wholesale. One a DEFAULT
-- fills on insert and JS (`new Date()`, already UTC) on update is converted
-- only while it still equals the row's createdAt: it was then filled by the
-- same INSERT's now(). Both are set in one UPDATE, so the comparison reads
-- the old values. A row the conversion leaves equal — every row of a UTC
-- install — is not touched. Columns JS always stamps are left alone.
UPDATE "chat" SET
  "createdAt" = ("createdAt" AT TIME ZONE z.tz) AT TIME ZONE 'UTC'
FROM (SELECT reset_val AS tz FROM pg_settings WHERE name = 'TimeZone') z
WHERE ("createdAt" AT TIME ZONE z.tz) AT TIME ZONE 'UTC' <> "createdAt";
--> statement-breakpoint
UPDATE "settings" SET
  "createdAt" = ("createdAt" AT TIME ZONE z.tz) AT TIME ZONE 'UTC',
  "updatedAt" = CASE WHEN "updatedAt" = "createdAt"
    THEN ("updatedAt" AT TIME ZONE z.tz) AT TIME ZONE 'UTC' ELSE "updatedAt" END
FROM (SELECT reset_val AS tz FROM pg_settings WHERE name = 'TimeZone') z
WHERE ("createdAt" AT TIME ZONE z.tz) AT TIME ZONE 'UTC' <> "createdAt";
--> statement-breakpoint
UPDATE "mcp_server" SET
  "createdAt" = ("createdAt" AT TIME ZONE z.tz) AT TIME ZONE 'UTC',
  "updatedAt" = CASE WHEN "updatedAt" = "createdAt"
    THEN ("updatedAt" AT TIME ZONE z.tz) AT TIME ZONE 'UTC' ELSE "updatedAt" END
FROM (SELECT reset_val AS tz FROM pg_settings WHERE name = 'TimeZone') z
WHERE ("createdAt" AT TIME ZONE z.tz) AT TIME ZONE 'UTC' <> "createdAt";
--> statement-breakpoint
UPDATE "paired_device" SET
  "createdAt" = ("createdAt" AT TIME ZONE z.tz) AT TIME ZONE 'UTC'
FROM (SELECT reset_val AS tz FROM pg_settings WHERE name = 'TimeZone') z
WHERE ("createdAt" AT TIME ZONE z.tz) AT TIME ZONE 'UTC' <> "createdAt";
--> statement-breakpoint
UPDATE "team" SET
  "createdAt" = ("createdAt" AT TIME ZONE z.tz) AT TIME ZONE 'UTC',
  "updatedAt" = CASE WHEN "updatedAt" = "createdAt"
    THEN ("updatedAt" AT TIME ZONE z.tz) AT TIME ZONE 'UTC' ELSE "updatedAt" END
FROM (SELECT reset_val AS tz FROM pg_settings WHERE name = 'TimeZone') z
WHERE ("createdAt" AT TIME ZONE z.tz) AT TIME ZONE 'UTC' <> "createdAt";
--> statement-breakpoint
UPDATE "agent" SET
  "createdAt" = ("createdAt" AT TIME ZONE z.tz) AT TIME ZONE 'UTC',
  "updatedAt" = CASE WHEN "updatedAt" = "createdAt"
    THEN ("updatedAt" AT TIME ZONE z.tz) AT TIME ZONE 'UTC' ELSE "updatedAt" END
FROM (SELECT reset_val AS tz FROM pg_settings WHERE name = 'TimeZone') z
WHERE ("createdAt" AT TIME ZONE z.tz) AT TIME ZONE 'UTC' <> "createdAt";
--> statement-breakpoint
UPDATE "agent_memory" SET
  "createdAt" = ("createdAt" AT TIME ZONE z.tz) AT TIME ZONE 'UTC',
  "updatedAt" = CASE WHEN "updatedAt" = "createdAt"
    THEN ("updatedAt" AT TIME ZONE z.tz) AT TIME ZONE 'UTC' ELSE "updatedAt" END
FROM (SELECT reset_val AS tz FROM pg_settings WHERE name = 'TimeZone') z
WHERE ("createdAt" AT TIME ZONE z.tz) AT TIME ZONE 'UTC' <> "createdAt";
--> statement-breakpoint
UPDATE "project" SET
  "createdAt" = ("createdAt" AT TIME ZONE z.tz) AT TIME ZONE 'UTC',
  "lastUsedAt" = CASE WHEN "lastUsedAt" = "createdAt"
    THEN ("lastUsedAt" AT TIME ZONE z.tz) AT TIME ZONE 'UTC' ELSE "lastUsedAt" END
FROM (SELECT reset_val AS tz FROM pg_settings WHERE name = 'TimeZone') z
WHERE ("createdAt" AT TIME ZONE z.tz) AT TIME ZONE 'UTC' <> "createdAt";
--> statement-breakpoint
UPDATE "conversation" SET
  "createdAt" = ("createdAt" AT TIME ZONE z.tz) AT TIME ZONE 'UTC',
  "updatedAt" = CASE WHEN "updatedAt" = "createdAt"
    THEN ("updatedAt" AT TIME ZONE z.tz) AT TIME ZONE 'UTC' ELSE "updatedAt" END,
  "lastMessageAt" = CASE WHEN "lastMessageAt" = "createdAt"
    THEN ("lastMessageAt" AT TIME ZONE z.tz) AT TIME ZONE 'UTC' ELSE "lastMessageAt" END
FROM (SELECT reset_val AS tz FROM pg_settings WHERE name = 'TimeZone') z
WHERE ("createdAt" AT TIME ZONE z.tz) AT TIME ZONE 'UTC' <> "createdAt";
--> statement-breakpoint
UPDATE "conversation_message" SET
  "createdAt" = ("createdAt" AT TIME ZONE z.tz) AT TIME ZONE 'UTC'
FROM (SELECT reset_val AS tz FROM pg_settings WHERE name = 'TimeZone') z
WHERE ("createdAt" AT TIME ZONE z.tz) AT TIME ZONE 'UTC' <> "createdAt";
--> statement-breakpoint
UPDATE "pm_round_event" SET
  "createdAt" = ("createdAt" AT TIME ZONE z.tz) AT TIME ZONE 'UTC'
FROM (SELECT reset_val AS tz FROM pg_settings WHERE name = 'TimeZone') z
WHERE ("createdAt" AT TIME ZONE z.tz) AT TIME ZONE 'UTC' <> "createdAt";
--> statement-breakpoint
UPDATE "agent_session" SET
  "createdAt" = ("createdAt" AT TIME ZONE z.tz) AT TIME ZONE 'UTC',
  "updatedAt" = CASE WHEN "updatedAt" = "createdAt"
    THEN ("updatedAt" AT TIME ZONE z.tz) AT TIME ZONE 'UTC' ELSE "updatedAt" END
FROM (SELECT reset_val AS tz FROM pg_settings WHERE name = 'TimeZone') z
WHERE ("createdAt" AT TIME ZONE z.tz) AT TIME ZONE 'UTC' <> "createdAt";
--> statement-breakpoint
UPDATE "task" SET
  "createdAt" = ("createdAt" AT TIME ZONE z.tz) AT TIME ZONE 'UTC',
  "updatedAt" = CASE WHEN "updatedAt" = "createdAt"
    THEN ("updatedAt" AT TIME ZONE z.tz) AT TIME ZONE 'UTC' ELSE "updatedAt" END
FROM (SELECT reset_val AS tz FROM pg_settings WHERE name = 'TimeZone') z
WHERE ("createdAt" AT TIME ZONE z.tz) AT TIME ZONE 'UTC' <> "createdAt";
--> statement-breakpoint
UPDATE "task_execution" SET
  "startedAt" = ("startedAt" AT TIME ZONE z.tz) AT TIME ZONE 'UTC'
FROM (SELECT reset_val AS tz FROM pg_settings WHERE name = 'TimeZone') z
WHERE ("startedAt" AT TIME ZONE z.tz) AT TIME ZONE 'UTC' <> "startedAt";
--> statement-breakpoint
UPDATE "task_execution_event" SET
  "createdAt" = ("createdAt" AT TIME ZONE z.tz) AT TIME ZONE 'UTC'
FROM (SELECT reset_val AS tz FROM pg_settings WHERE name = 'TimeZone') z
WHERE ("createdAt" AT TIME ZONE z.tz) AT TIME ZONE 'UTC' <> "createdAt";
--> statement-breakpoint
UPDATE "conversation_plan" SET
  "createdAt" = ("createdAt" AT TIME ZONE z.tz) AT TIME ZONE 'UTC',
  "updatedAt" = CASE WHEN "updatedAt" = "createdAt"
    THEN ("updatedAt" AT TIME ZONE z.tz) AT TIME ZONE 'UTC' ELSE "updatedAt" END
FROM (SELECT reset_val AS tz FROM pg_settings WHERE name = 'TimeZone') z
WHERE ("createdAt" AT TIME ZONE z.tz) AT TIME ZONE 'UTC' <> "createdAt";
--> statement-breakpoint
UPDATE "plan_step" SET
  "createdAt" = ("createdAt" AT TIME ZONE z.tz) AT TIME ZONE 'UTC',
  "updatedAt" = CASE WHEN "updatedAt" = "createdAt"
    THEN ("updatedAt" AT TIME ZONE z.tz) AT TIME ZONE 'UTC' ELSE "updatedAt" END
FROM (SELECT reset_val AS tz FROM pg_settings WHERE name = 'TimeZone') z
WHERE ("createdAt" AT TIME ZONE z.tz) AT TIME ZONE 'UTC' <> "createdAt";
--> statement-breakpoint
UPDATE "philharmonic_session_summary" SET
  "createdAt" = ("createdAt" AT TIME ZONE z.tz) AT TIME ZONE 'UTC',
  "updatedAt" = CASE WHEN "updatedAt" = "createdAt"
    THEN ("updatedAt" AT TIME ZONE z.tz) AT TIME ZONE 'UTC' ELSE "updatedAt" END
FROM (SELECT reset_val AS tz FROM pg_settings WHERE name = 'TimeZone') z
WHERE ("createdAt" AT TIME ZONE z.tz) AT TIME ZONE 'UTC' <> "createdAt";
--> statement-breakpoint
UPDATE "knowledge_doc" SET
  "createdAt" = ("createdAt" AT TIME ZONE z.tz) AT TIME ZONE 'UTC',
  "updatedAt" = CASE WHEN "updatedAt" = "createdAt"
    THEN ("updatedAt" AT TIME ZONE z.tz) AT TIME ZONE 'UTC' ELSE "updatedAt" END
FROM (SELECT reset_val AS tz FROM pg_settings WHERE name = 'TimeZone') z
WHERE ("createdAt" AT TIME ZONE z.tz) AT TIME ZONE 'UTC' <> "createdAt";
--> statement-breakpoint
UPDATE "memory" SET
  "createdAt" = ("createdAt" AT TIME ZONE z.tz) AT TIME ZONE 'UTC',
  "updatedAt" = CASE WHEN "updatedAt" = "createdAt"
    THEN ("updatedAt" AT TIME ZONE z.tz) AT TIME ZONE 'UTC' ELSE "updatedAt" END
FROM (SELECT reset_val AS tz FROM pg_settings WHERE name = 'TimeZone') z
WHERE ("createdAt" AT TIME ZONE z.tz) AT TIME ZONE 'UTC' <> "createdAt";
--> statement-breakpoint
UPDATE "memory_usage_log" SET
  "createdAt" = ("createdAt" AT TIME ZONE z.tz) AT TIME ZONE 'UTC'
FROM (SELECT reset_val AS tz FROM pg_settings WHERE name = 'TimeZone') z
WHERE ("createdAt" AT TIME ZONE z.tz) AT TIME ZONE 'UTC' <> "createdAt";
--> statement-breakpoint
UPDATE "lcm_summary" SET
  "createdAt" = ("createdAt" AT TIME ZONE z.tz) AT TIME ZONE 'UTC'
FROM (SELECT reset_val AS tz FROM pg_settings WHERE name = 'TimeZone') z
WHERE ("createdAt" AT TIME ZONE z.tz) AT TIME ZONE 'UTC' <> "createdAt";
