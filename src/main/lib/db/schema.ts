import {
  AgentsSettingsSchema,
  VoiceSchema,
  DeepResearchSchema,
  DiscoverSchema,
  ComputerUseSchema,
  GoogleCloudSchema,
  ImageSchema,
  KeyboardShortcutsSchema,
  KnowledgeBaseSchema,
  MemorySchema,
  ModelCatalogSchema,
  PersonalitySchema,
  ProviderConfigSchema,
  ProvidersSchema,
  S3Schema,
  ToolsSchema,
  WebSearchSchema
} from '@actovia/shared/schemas/settings-schema'
import type { Attempt } from '@actovia/shared/types/chat'
import type { DiscoverGroup } from '@actovia/shared/types/discover'
import type { PmRoundEventKind } from '@actovia/shared/types/pm-round'
import { WebSearchResult } from '@actovia/shared/types/web-search'
import type { Usage } from '@earendil-works/pi-ai'
import { sql, type InferSelectModel } from 'drizzle-orm'
import {
  boolean,
  index,
  integer,
  json,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  uuid,
  varchar
} from 'drizzle-orm/pg-core'
import z from 'zod'

export const chat = pgTable('chat', {
  id: uuid('id').primaryKey().notNull().defaultRandom(),
  createdAt: timestamp('createdAt').defaultNow().notNull(),
  title: text('title').notNull(),
  favorite: boolean().default(false)
})

export type Chat = InferSelectModel<typeof chat>

export const message = pgTable(
  'message',
  {
    id: uuid('id').primaryKey().notNull().defaultRandom(),
    chatId: uuid('chatId')
      .notNull()
      .references(() => chat.id),
    // The run this row belongs to: the id of the run's user message (the
    // user row carries its own id). Context assembly, compaction and the
    // renderer all work in runs, never in single rows. Backfilled by
    // migration 0008.
    runId: uuid('runId').notNull(),
    role: varchar('role').notNull(), // 'user' | 'assistant' | 'toolResult'
    content: jsonb('content').notNull(), // content array for the message
    // Extracted, indexable text — only `text` blocks from user/assistant
    // messages; excludes `thinking` blocks and toolResult rows entirely.
    // Populated by extractSearchableText() in saveMessages().
    searchText: text('searchText'),
    // assistant-specific fields
    usage: jsonb('usage').$type<Usage>(),
    api: varchar('api'),
    provider: varchar('provider'),
    model: varchar('model'),
    stopReason: varchar('stopReason'),
    errorMessage: varchar('errorMessage'),
    // toolResult-specific fields
    toolCallId: varchar('toolCallId'),
    toolName: varchar('toolName'),
    details: jsonb('details'),
    isError: boolean('isError'),
    // Wall-clock time for the entire turn this message belongs to. Populated
    // only on the LAST assistant message of a turn — gives ThinkingTimeline a
    // precise duration even for single-message turns where message timestamps
    // can't span the response (pi-ai sets timestamp at stream START).
    durationMs: integer('durationMs'),
    // Regenerate groups — meaningful on a run's user row only (null on every
    // other row). `alternateOf`: the group's first run, set on every run a
    // Regenerate created; `attempt`: 'comparing' | 'chosen' | 'folded' |
    // 'hidden', null for an ordinary run (and a group's first run before its
    // first regenerate). Written only by `lib/chat/attempts.ts`.
    alternateOf: uuid('alternateOf'),
    attempt: varchar('attempt').$type<Attempt>(),
    createdAt: timestamp('createdAt').defaultNow().notNull()
  },
  (table) => [
    // gin_trgm_ops (pg_trgm) — not to_tsvector — so ILIKE substring matching
    // works uniformly across languages, including CJK text that Postgres's
    // built-in text-search parser doesn't segment into words at all.
    index('message_search_index').using(
      'gin',
      sql`${table.searchText} gin_trgm_ops`
    ),
    index('message_chat_run_idx').on(table.chatId, table.runId)
  ]
)

export type DBMessage = InferSelectModel<typeof message>
export type Message = DBMessage

// The numbered sources of a chat — every result of its `web_search` calls and
// every page `web_fetch` read — one row per (call, rank), written when the
// run is saved and filled in from the stored messages for a chat older than
// the table (`chat/sources.ts`). Derived data: the `message` rows stay the
// record. It answers `recall({ source })`, the number a new run counts on
// from, and the clients' citation map. `content` is the text the model was
// given: a search result's extract, a fetched page in full. Ranks repeat in
// a chat numbered before 2026-09-29 (every run started at 1), hence the
// call in the key; the newest row of a rank is that rank.
export const chatSource = pgTable(
  'chat_source',
  {
    chatId: uuid('chatId')
      .notNull()
      .references(() => chat.id, { onDelete: 'cascade' }),
    rank: integer('rank').notNull(),
    toolCallId: varchar('toolCallId').notNull(),
    runId: uuid('runId').notNull(),
    toolName: varchar('toolName').notNull(),
    link: text('link').notNull(),
    title: text('title').notNull(),
    siteName: text('siteName'),
    hostname: text('hostname'),
    favicon: text('favicon'),
    snippet: text('snippet'),
    thumbnail: text('thumbnail'),
    age: text('age'),
    content: text('content').notNull(),
    createdAt: timestamp('createdAt').notNull()
  },
  (table) => [
    primaryKey({ columns: [table.chatId, table.toolCallId, table.rank] }),
    index('chat_source_chat_rank_idx').on(table.chatId, table.rank)
  ]
)

export type ChatSource = InferSelectModel<typeof chatSource>

export const vote = pgTable(
  'vote',
  {
    chatId: uuid('chatId')
      .notNull()
      .references(() => chat.id),
    messageId: uuid('messageId')
      .notNull()
      .references(() => message.id),
    isUpvoted: boolean('isUpvoted').notNull()
  },
  (table) => {
    return {
      pk: primaryKey({ columns: [table.chatId, table.messageId] })
    }
  }
)

export type Vote = InferSelectModel<typeof vote>

export const settings = pgTable('settings', {
  id: text('id').primaryKey(),
  providerConfig:
    jsonb('providerConfig').$type<z.infer<typeof ProviderConfigSchema>>(),
  providers: jsonb('providers').$type<z.infer<typeof ProvidersSchema>>(),
  modelCatalog:
    jsonb('modelCatalog').$type<z.infer<typeof ModelCatalogSchema>>(),
  tools: jsonb('tools').$type<z.infer<typeof ToolsSchema>>(),
  voice: jsonb('voice').$type<z.infer<typeof VoiceSchema>>(),
  // The user's avatar (Sidebar footer + Settings → Profile). The physical
  // column is still named `assistantAvatar` — it used to be the AI's avatar —
  // so existing rows carry over without a migration.
  userAvatar: text('assistantAvatar').default(''),
  googleCloud: jsonb('googleCloud').$type<z.infer<typeof GoogleCloudSchema>>(),
  webSearch: jsonb('webSearch').$type<z.infer<typeof WebSearchSchema>>(),
  knowledgeBase:
    jsonb('knowledgeBase').$type<z.infer<typeof KnowledgeBaseSchema>>(),
  computerUse: jsonb('computerUse').$type<z.infer<typeof ComputerUseSchema>>(),
  agents: jsonb('agents').$type<z.infer<typeof AgentsSettingsSchema>>(),
  discover: jsonb('discover').$type<z.infer<typeof DiscoverSchema>>(),
  image: jsonb('image').$type<z.infer<typeof ImageSchema>>(),
  deepResearch:
    jsonb('deepResearch').$type<z.infer<typeof DeepResearchSchema>>(),
  s3: jsonb('s3').$type<z.infer<typeof S3Schema>>(),
  autoUpdate: boolean('autoUpdate').default(true),
  runOnStartup: boolean('runOnStartup').default(false),
  menuBar: boolean('menuBar').default(true),
  language: text('language').default('auto'),
  autoBackup: boolean('autoBackup').default(true),
  lastBackupAt: timestamp('lastBackupAt'),
  memory: jsonb('memory').$type<z.infer<typeof MemorySchema>>(),
  personality: jsonb('personality').$type<z.infer<typeof PersonalitySchema>>(),
  keyboardShortcuts:
    jsonb('keyboardShortcuts').$type<z.infer<typeof KeyboardShortcutsSchema>>(),
  // Settings → General → Color tone (`ColorToneSchema` in settings-schema.ts).
  colorTone: text('colorTone').default('neutral'),
  createdAt: timestamp('createdAt').defaultNow().notNull(),
  updatedAt: timestamp('updatedAt').defaultNow().notNull()
})

export type Settings = InferSelectModel<typeof settings>

export const jobStatusEnum = pgEnum('jobStatus', [
  'streaming',
  'archived',
  'failed',
  'terminated'
])

export const deepResearch = pgTable('deep_research', {
  id: uuid('id').primaryKey().notNull().defaultRandom(),
  toolCallId: text('toolCallId').notNull(),
  title: text('title'),
  jobStatus: jobStatusEnum().notNull(),
  finalReport: text('finalReport'),
  webSources: json('webSources').$type<WebSearchResult[]>(),
  // Set only when jobStatus is 'failed': the error's class and message,
  // scrubbed of secrets and clipped — never a secret or a whole provider
  // response. See src/main/lib/server/routes/deep-research.ts.
  errorMessage: text('errorMessage'),
  startTime: timestamp('startTime').defaultNow().notNull(),
  endTime: timestamp('endTime').defaultNow()
})

export type DeepResearch = InferSelectModel<typeof deepResearch>

export const deepResearchMessage = pgTable('deep_research_message', {
  id: uuid('id').primaryKey().notNull().defaultRandom(),
  deepResearchId: uuid('deepResearchId')
    .notNull()
    .references(() => deepResearch.id),
  message: json('message').notNull().$type<Record<string, unknown>>(),
  createdAt: timestamp('createdAt').defaultNow().notNull()
})

export type DeepResearchMessage = InferSelectModel<typeof deepResearchMessage>

// ─── MCP Registry ───────────────────────────────────────────────────────────

export const mcpServer = pgTable('mcp_server', {
  id: uuid('id').primaryKey().notNull().defaultRandom(),
  name: text('name').notNull(),
  description: text('description').default(''),
  // Transport type: stdio (local command), sse (legacy remote), streamable-http (recommended remote)
  transportType: varchar('transportType').notNull().default('stdio'),
  // stdio fields
  command: text('command').default(''),
  args: jsonb('args').$type<string[]>().default([]),
  env: jsonb('env').$type<Record<string, string>>(),
  // Remote fields (sse / streamable-http)
  url: text('url'),
  headers: jsonb('headers').$type<Record<string, string>>(),
  // Arbitrary extra fields merged into the JSON export (e.g. oauth, httpUrl)
  extraConfig: jsonb('extraConfig').$type<Record<string, unknown>>(),
  isActive: boolean('isActive').default(false),
  createdAt: timestamp('createdAt').defaultNow().notNull(),
  updatedAt: timestamp('updatedAt').defaultNow().notNull()
})

// A device allowed onto the LAN listener (see src/main/lib/lan/). Only the
// hash of its token is kept; the token itself exists on the device alone.
export const pairedDevice = pgTable('paired_device', {
  id: uuid('id').primaryKey().notNull().defaultRandom(),
  name: text('name').notNull(),
  tokenHash: text('tokenHash').notNull().unique(),
  createdAt: timestamp('createdAt').defaultNow().notNull(),
  lastSeenAt: timestamp('lastSeenAt')
})

export type PairedDevice = InferSelectModel<typeof pairedDevice>

export type McpServer = InferSelectModel<typeof mcpServer>

// ─── Philharmonic ────────────────────────────────────────────────────────────────

// A team groups employees and contributes its own systemPrompt to every member.
export const team = pgTable('team', {
  id: uuid('id').primaryKey().notNull().defaultRandom(),
  name: text('name').notNull(),
  description: text('description').default(''),
  systemPrompt: text('systemPrompt').default(''),
  icon: text('icon'), // optional emoji
  createdAt: timestamp('createdAt').defaultNow().notNull(),
  updatedAt: timestamp('updatedAt').defaultNow().notNull()
})

export type Team = InferSelectModel<typeof team>

export const agentRuntimeEnum = pgEnum('agent_runtime', [
  'actovia',
  'claude-code',
  'codex'
])

export const agent = pgTable('agent', {
  id: uuid('id').primaryKey().notNull().defaultRandom(),
  name: text('name').notNull(),
  description: text('description').default(''),
  teamId: uuid('teamId').references(() => team.id, { onDelete: 'set null' }),
  avatarSeed: text('avatarSeed'),
  avatarStyle: text('avatarStyle'),
  systemPrompt: text('systemPrompt').default(''),
  toolAllowList: jsonb('toolAllowList').$type<string[]>().default([]),
  skillSlugs: jsonb('skillSlugs').$type<string[]>().default([]),
  mcpServerNames: jsonb('mcpServerNames').$type<string[]>().default([]),
  model: text('model'),
  provider: text('provider'),
  runtime: agentRuntimeEnum('runtime').notNull().default('actovia'),
  /** A CLI employee's permission mode; null = the CLI's `default`. */
  permissionMode: text('permissionMode'),
  isActive: boolean('isActive').default(true),
  createdAt: timestamp('createdAt').defaultNow().notNull(),
  updatedAt: timestamp('updatedAt').defaultNow().notNull()
})

export type Agent = InferSelectModel<typeof agent>

export const agentMemorySourceEnum = pgEnum('agent_memory_source', [
  'conversation',
  'task',
  'system'
])

export const agentMemory = pgTable('agent_memory', {
  id: uuid('id').primaryKey().notNull().defaultRandom(),
  agentId: uuid('agentId')
    .notNull()
    .references(() => agent.id, { onDelete: 'cascade' }),
  // P1-4: memory rows are scoped to the Group they were learned in. The
  // employee LLM at runtime only sees rows for the current conversation;
  // the Workforce admin view continues to read all rows (no filter).
  conversationId: uuid('conversationId')
    .notNull()
    .references(() => conversation.id, { onDelete: 'cascade' }),
  key: text('key').notNull(),
  value: jsonb('value').notNull(),
  source: agentMemorySourceEnum('source').notNull().default('task'),
  confidence: real('confidence').default(0.8),
  isActive: boolean('isActive').default(true),
  createdAt: timestamp('createdAt').defaultNow().notNull(),
  updatedAt: timestamp('updatedAt').defaultNow().notNull()
})

export type AgentMemory = InferSelectModel<typeof agentMemory>

// ─── Conversations (work groups) ──────────────────────────────────────────────

/** A folder Philharmonic works in (spec §4): `dir` holds `.actovia/` meta; `workDir` is where agents work — `dir` for a new project, the owner's folder for an opened one. */
export const project = pgTable('project', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  dir: text('dir').notNull().unique(),
  workDir: text('workDir').notNull(),
  useWorktrees: boolean('useWorktrees').notNull().default(true),
  createdAt: timestamp('createdAt').defaultNow().notNull(),
  lastUsedAt: timestamp('lastUsedAt').defaultNow().notNull()
})
export type Project = InferSelectModel<typeof project>

export const conversation = pgTable(
  'conversation',
  {
    id: uuid('id').primaryKey().notNull().defaultRandom(),
    title: text('title').notNull(),
    icon: text('icon'), // emoji
    memberAgentIds: jsonb('memberAgentIds').$type<string[]>().default([]),
    archived: boolean('archived').default(false),
    projectId: uuid('projectId').references(() => project.id, {
      onDelete: 'set null'
    }),
    createdAt: timestamp('createdAt').defaultNow().notNull(),
    updatedAt: timestamp('updatedAt').defaultNow().notNull(),
    lastMessageAt: timestamp('lastMessageAt').defaultNow().notNull()
  },
  (table) => [index('conversation_last_message_idx').on(table.lastMessageAt)]
)

export type Conversation = InferSelectModel<typeof conversation>

export const conversationMessageRoleEnum = pgEnum('conversation_message_role', [
  'user',
  'pm',
  'employee',
  'system'
])

export const conversationMessage = pgTable(
  'conversation_message',
  {
    id: uuid('id').primaryKey().notNull().defaultRandom(),
    conversationId: uuid('conversationId')
      .notNull()
      .references(() => conversation.id, { onDelete: 'cascade' }),
    role: conversationMessageRoleEnum('role').notNull(),
    agentId: uuid('agentId').references(() => agent.id, {
      onDelete: 'set null'
    }),
    content: text('content').notNull().default(''),
    parts: jsonb('parts').$type<Record<string, unknown>[]>(), // tool-call cards etc.
    taskId: uuid('taskId'),
    roundId: uuid('roundId'),
    createdAt: timestamp('createdAt').defaultNow().notNull()
  },
  (table) => [
    index('conversation_message_conv_idx').on(
      table.conversationId,
      table.createdAt
    )
  ]
)

export type ConversationMessage = InferSelectModel<typeof conversationMessage>

// One PM round's decision trail (spec 2026-10-17): what it read, thought,
// called and was answered, in order. Masked before it is written.
export const pmRoundEvent = pgTable(
  'pm_round_event',
  {
    id: uuid('id').primaryKey().notNull().defaultRandom(),
    conversationId: uuid('conversationId')
      .notNull()
      .references(() => conversation.id, { onDelete: 'cascade' }),
    roundId: uuid('roundId').notNull(),
    seq: integer('seq').notNull(),
    kind: text('kind').$type<PmRoundEventKind>().notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp('createdAt').defaultNow().notNull()
  },
  (table) => [
    index('pm_round_event_round_idx').on(
      table.conversationId,
      table.roundId,
      table.seq
    )
  ]
)
export type PmRoundEvent = InferSelectModel<typeof pmRoundEvent>

export const agentSessionStateEnum = pgEnum('agent_session_state', [
  'working',
  'blocked',
  'done',
  'stopped',
  'error'
])

/** One CLI session of one employee in one project (spec §8). */
export const agentSession = pgTable(
  'agent_session',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('projectId')
      .notNull()
      .references(() => project.id, { onDelete: 'cascade' }),
    agentId: uuid('agentId').references(() => agent.id, {
      onDelete: 'set null'
    }),
    conversationId: uuid('conversationId')
      .notNull()
      .references(() => conversation.id, { onDelete: 'cascade' }),
    runtime: text('runtime').notNull(),
    cliSessionId: text('cliSessionId'),
    cwd: text('cwd').notNull(),
    branch: text('branch'),
    state: agentSessionStateEnum('state').notNull().default('working'),
    /** The employee message whose card this session draws (latest step). */
    messageId: uuid('messageId'),
    continuedInTerminal: boolean('continuedInTerminal')
      .notNull()
      .default(false),
    createdAt: timestamp('createdAt').defaultNow().notNull(),
    updatedAt: timestamp('updatedAt').defaultNow().notNull()
  },
  (table) => [
    index('agent_session_project_agent_idx').on(table.projectId, table.agentId)
  ]
)
export type AgentSession = InferSelectModel<typeof agentSession>

// ─── Tasks ────────────────────────────────────────────────────────────────────

export const taskStatusEnum = pgEnum('task_status', [
  'pending',
  'running',
  'completed',
  'failed',
  'cancelled',
  'waiting_for_user'
])

export const taskPriorityEnum = pgEnum('task_priority', [
  'low',
  'medium',
  'high',
  'urgent'
])

export const task = pgTable('task', {
  id: uuid('id').primaryKey().notNull().defaultRandom(),
  parentTaskId: uuid('parentTaskId'),
  conversationId: uuid('conversationId').references(() => conversation.id, {
    onDelete: 'cascade'
  }),
  title: text('title').notNull(),
  description: text('description').default(''),
  status: taskStatusEnum('status').notNull().default('pending'),
  priority: taskPriorityEnum('priority').notNull().default('medium'),
  assignedAgentId: uuid('assignedAgentId').references(() => agent.id, {
    onDelete: 'set null'
  }),
  input: jsonb('input').$type<Record<string, unknown>>(),
  output: jsonb('output').$type<Record<string, unknown>>(),
  maxRetries: real('maxRetries').default(1),
  retryCount: real('retryCount').default(0),
  cronExpression: text('cronExpression'),
  runAt: timestamp('runAt'),
  lastRunAt: timestamp('lastRunAt'),
  lastRunStatus: varchar('lastRunStatus').$type<'completed' | 'failed'>(),
  feedbackRating: varchar('feedbackRating').$type<
    'positive' | 'negative' | null
  >(),
  feedbackNote: text('feedbackNote'),
  createdAt: timestamp('createdAt').defaultNow().notNull(),
  updatedAt: timestamp('updatedAt').defaultNow().notNull(),
  completedAt: timestamp('completedAt')
})

export type Task = InferSelectModel<typeof task>

export const executionStatusEnum = pgEnum('execution_status', [
  'running',
  'completed',
  'failed'
])

export const taskExecution = pgTable('task_execution', {
  id: uuid('id').primaryKey().notNull().defaultRandom(),
  taskId: uuid('taskId')
    .notNull()
    .references(() => task.id, { onDelete: 'cascade' }),
  agentId: uuid('agentId')
    .notNull()
    .references(() => agent.id, { onDelete: 'cascade' }),
  status: executionStatusEnum('status').notNull().default('running'),
  startedAt: timestamp('startedAt').defaultNow().notNull(),
  completedAt: timestamp('completedAt'),
  error: text('error'),
  tokenUsage: jsonb('tokenUsage').$type<{
    inputTokens: number
    outputTokens: number
    cost?: number
  }>()
})

export type TaskExecution = InferSelectModel<typeof taskExecution>

export const taskExecutionEvent = pgTable('task_execution_event', {
  id: uuid('id').primaryKey().notNull().defaultRandom(),
  executionId: uuid('executionId')
    .notNull()
    .references(() => taskExecution.id, { onDelete: 'cascade' }),
  eventType: text('eventType').notNull(),
  payload: jsonb('payload').$type<Record<string, unknown>>(),
  createdAt: timestamp('createdAt').defaultNow().notNull()
})

export type TaskExecutionEvent = InferSelectModel<typeof taskExecutionEvent>

// ─── Execution plan (P0-2) ────────────────────────────────────────────────────
// Each Group keeps exactly one active conversation_plan. The PM lays out the
// plan first, then delegates step-by-step; the UI mirrors progress live. The
// DB is the source of truth and a markdown mirror is written to
// ~/.actovia/groups/{conversationId}/plan.md on every change.

export const planStatusEnum = pgEnum('plan_status', [
  'drafting',
  'active',
  'completed',
  'aborted'
])

export const stepStatusEnum = pgEnum('step_status', [
  'pending',
  'running',
  'done',
  'skipped',
  'failed'
])

export const conversationPlan = pgTable('conversation_plan', {
  id: uuid('id').primaryKey().notNull().defaultRandom(),
  conversationId: uuid('conversationId')
    .notNull()
    .references(() => conversation.id, { onDelete: 'cascade' }),
  summary: text('summary').notNull(),
  status: planStatusEnum('status').notNull().default('active'),
  createdAt: timestamp('createdAt').defaultNow().notNull(),
  updatedAt: timestamp('updatedAt').defaultNow().notNull(),
  archivedAt: timestamp('archivedAt')
})

export type ConversationPlan = InferSelectModel<typeof conversationPlan>

export const planStep = pgTable('plan_step', {
  id: uuid('id').primaryKey().notNull().defaultRandom(),
  planId: uuid('planId')
    .notNull()
    .references(() => conversationPlan.id, { onDelete: 'cascade' }),
  ordinal: integer('ordinal').notNull(),
  title: text('title').notNull(),
  intent: text('intent'),
  // SET NULL on agent delete: a past step's record survives the agent being deleted.
  assignedAgentId: uuid('assignedAgentId').references(() => agent.id, {
    onDelete: 'set null'
  }),
  status: stepStatusEnum('status').notNull().default('pending'),
  output: text('output'),
  note: text('note'),
  // Links to the execution trace (task table). SET NULL so step survives the task row going away.
  taskId: uuid('taskId').references(() => task.id, { onDelete: 'set null' }),
  startedAt: timestamp('startedAt'),
  completedAt: timestamp('completedAt'),
  createdAt: timestamp('createdAt').defaultNow().notNull(),
  updatedAt: timestamp('updatedAt').defaultNow().notNull()
})

export type PlanStep = InferSelectModel<typeof planStep>

// ─── Philharmonic LCM (P0-3) ─────────────────────────────────────────────────
// Rolling single-paragraph summary per conversation. One row per group;
// rewritten in place when the conversation grows past the configured budget.
// Intentionally simpler than Chat's DAG-based LCM — see the P0-3 spec.

export const philharmonicSessionSummary = pgTable(
  'philharmonic_session_summary',
  {
    id: uuid('id').primaryKey().notNull().defaultRandom(),
    conversationId: uuid('conversationId')
      .notNull()
      .references(() => conversation.id, { onDelete: 'cascade' })
      .unique(),
    content: text('content').notNull(),
    // Boundary: everything up to (and including) this message ID is
    // represented by the summary; messages after it are still raw.
    coversThroughMessageId: uuid('coversThroughMessageId').references(
      () => conversationMessage.id,
      { onDelete: 'set null' }
    ),
    tokenCount: integer('tokenCount').notNull(),
    messageCount: integer('messageCount').notNull(),
    createdAt: timestamp('createdAt').defaultNow().notNull(),
    updatedAt: timestamp('updatedAt').defaultNow().notNull()
  },
  (t) => [index('ph_session_summary_conv_idx').on(t.conversationId)]
)

export type PhilharmonicSessionSummary = InferSelectModel<
  typeof philharmonicSessionSummary
>

// ─── Knowledge Base ──────────────────────────────────────────────────────────
// Source-of-truth documents, authored in Settings → Knowledge Base and synced
// into a self-hosted LightRAG server (the retrieval index) by the `kb-sync`
// job. Per-doc sync state lives here; LightRAG owns the graph + vectors.

export const knowledgeIndexStatusEnum = pgEnum('knowledge_index_status', [
  'pending', // never synced, or content changed and a kb-sync job is queued
  'processing', // submitted to LightRAG; track_id outstanding
  'processed', // LightRAG reports the doc indexed
  'failed', // submit or processing failed; see indexError
  'stale' // hash != syncedHash but no sync running (needs Reindex all)
])

export const knowledgeDoc = pgTable('knowledge_doc', {
  id: uuid('id').primaryKey().notNull().defaultRandom(),
  title: text('title').notNull(),
  content: text('content').notNull(),
  lightragDocId: text('lightragDocId'),
  lightragTrackId: text('lightragTrackId'),
  indexStatus: knowledgeIndexStatusEnum('indexStatus')
    .notNull()
    .default('pending'),
  indexError: text('indexError'),
  syncedHash: text('syncedHash'),
  createdAt: timestamp('createdAt').defaultNow().notNull(),
  updatedAt: timestamp('updatedAt').defaultNow().notNull()
})

export type KnowledgeDoc = InferSelectModel<typeof knowledgeDoc>

// ─── Discover ────────────────────────────────────────────────────────────────
// A single cached feed, regenerated wholesale by the discover-refresh job.
// No relational columns / no FK to `memory` — the whole cache is replaced
// atomically on every refresh, so a stale memoryId inside old JSON is
// harmless and never queried against the memory table.

export const discoverFeedStatusEnum = pgEnum('discover_feed_status', [
  'idle',
  'refreshing',
  'failed'
])

export const discoverFeed = pgTable('discover_feed', {
  id: text('id').primaryKey(), // always 'global'
  groups: jsonb('groups')
    .$type<DiscoverGroup[]>()
    .notNull()
    .default(sql`'[]'::jsonb`),
  generatedAt: timestamp('generatedAt'),
  status: discoverFeedStatusEnum('status').notNull().default('idle'),
  error: text('error')
})

export type DiscoverFeedRow = InferSelectModel<typeof discoverFeed>

// ─── Memory & Personalization ───────────────────────────────────────────────

// Coarse sections, mirroring how a durable user memory is naturally organized.
// The LLM classifies far more consistently into 3 buckets than into 6.
export const memorySectionEnum = pgEnum('memory_section', [
  'profile', // durable identity, environment, hard constraints, preferences
  'topic', // an interest / project / recurring subject
  'person' // someone in the user's life
])

export const memorySourceEnum = pgEnum('memory_source', [
  'explicit',
  'implicit',
  'system'
])

// One row per topic/person, not per fact. `summary` is the one-liner; `details`
// accumulates bullet points that the consolidation judge revises over time.
export const memory = pgTable('memory', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('userId').notNull(),
  section: memorySectionEnum('section').notNull().default('topic'),
  key: text('key').notNull(),
  summary: text('summary').notNull(),
  details: jsonb('details')
    .$type<string[]>()
    .notNull()
    .default(sql`'[]'::jsonb`),
  confidence: real('confidence').default(0.8),
  source: memorySourceEnum('source').notNull(),
  createdAt: timestamp('createdAt').defaultNow(),
  updatedAt: timestamp('updatedAt').defaultNow(),
  lastUsedAt: timestamp('lastUsedAt'),
  isActive: boolean('isActive').default(true)
})

// Written whenever a memory is surfaced into a chat — powers "why did it say
// that" traces and an age-out policy. `runId`/`key`/`section` (migration
// 0009) let a chat announce which memories a specific run used and keep
// rendering that after the entry itself is edited or deleted — the log
// carries its own copy of the title/section rather than joining `memory`.
// Rows from before the migration keep them null; `getMemoryUsageByChat`
// skips a null `runId` rather than grouping old data under "null".
export const memoryUsageLog = pgTable('memory_usage_log', {
  id: uuid('id').defaultRandom().primaryKey(),
  memoryId: uuid('memoryId'),
  sessionId: uuid('sessionId'),
  runId: uuid('runId'),
  key: text('key'),
  section: text('section').$type<'profile' | 'topic' | 'person'>(),
  reason: text('reason'),
  createdAt: timestamp('createdAt').defaultNow()
})

// ─── LCM (Lossless Context Management) ──────────────────────────────────────

// DAG nodes: leaf summaries (depth=0) and condensed summaries (depth>=1)
export const lcmSummary = pgTable('lcm_summary', {
  id: text('id').primaryKey(), // 'sum_' + 16 hex chars (SHA-256 of content+ts)
  chatId: uuid('chatId')
    .notNull()
    .references(() => chat.id, { onDelete: 'cascade' }),
  kind: text('kind').notNull().$type<'leaf' | 'condensed'>(),
  depth: integer('depth').notNull().default(0),
  content: text('content').notNull(),
  tokenCount: integer('tokenCount').notNull(),
  descendantCount: integer('descendantCount').notNull().default(0),
  earliestAt: timestamp('earliestAt').notNull(),
  latestAt: timestamp('latestAt').notNull(),
  createdAt: timestamp('createdAt').notNull().defaultNow()
})

export type LcmSummary = InferSelectModel<typeof lcmSummary>

// Leaf summary → source messages (many-to-many)
export const lcmSummaryMessages = pgTable(
  'lcm_summary_messages',
  {
    summaryId: text('summaryId')
      .notNull()
      .references(() => lcmSummary.id, { onDelete: 'cascade' }),
    messageId: uuid('messageId')
      .notNull()
      .references(() => message.id, { onDelete: 'cascade' })
  },
  (t) => [primaryKey({ columns: [t.summaryId, t.messageId] })]
)

// Condensed summary → parent summaries (DAG edges)
export const lcmSummaryParents = pgTable(
  'lcm_summary_parents',
  {
    childId: text('childId')
      .notNull()
      .references(() => lcmSummary.id, { onDelete: 'cascade' }),
    parentId: text('parentId')
      .notNull()
      .references(() => lcmSummary.id, { onDelete: 'cascade' })
  },
  (t) => [primaryKey({ columns: [t.childId, t.parentId] })]
)

// Ordered context sequence per chat session (messages + summaries interleaved)
export const lcmContextItems = pgTable(
  'lcm_context_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    chatId: uuid('chatId')
      .notNull()
      .references(() => chat.id, { onDelete: 'cascade' }),
    ordinal: integer('ordinal').notNull(),
    kind: text('kind').notNull().$type<'message' | 'summary'>(),
    refId: text('refId').notNull(), // message.id or lcmSummary.id
    tokenCount: integer('tokenCount')
  },
  (t) => [index('lcm_context_chat_idx').on(t.chatId, t.ordinal)]
)

export type LcmContextItem = InferSelectModel<typeof lcmContextItems>
