import type { UseFormReturn } from 'react-hook-form'
import { z } from 'zod'

import { LOCALE_IDS } from '../i18n/locales'

// Optional URL: nullish input, validates as URL only when non-empty.
// No transform so input/output types stay identical (no RHF type mismatch).
const optionalUrl = z
  .string()
  .nullish()
  .refine(
    (val) => {
      if (val == null || val === '') return true
      return z.string().url().safeParse(val).success
    },
    { message: 'Invalid URL' }
  )

// Stricter variant of `optionalUrl` that also requires an explicit http(s)
// scheme — `optionalUrl` accepts scheme-less values like `localhost:9621`,
// which a client building requests from it cannot use. Deliberately NOT
// applied to the other provider URL fields, whose looser behavior is relied
// upon.
const optionalHttpUrl = optionalUrl.refine(
  (val) => val == null || val === '' || /^https?:\/\//.test(val),
  { message: 'Must start with http:// or https://' }
)

// HTML <input type="number"> emits string values via onChange, so a form
// library stores strings while the user is typing. Wrap numeric fields with
// this preprocess to coerce on validation: '' → undefined, '1.5' → 1.5,
// anything non-numeric passes through so ZodNumber can flag it. The cast
// keeps the inferred input type as `number` (matching the inner schema).
const formNumber = <T extends z.ZodNumber>(inner: T): T =>
  z.preprocess((v) => {
    if (v === '' || v === null || v === undefined) return undefined
    if (typeof v === 'string') {
      const n = Number(v)
      return Number.isNaN(n) ? v : n
    }
    return v
  }, inner) as unknown as T

export const EffortLevelSchema = z.enum([
  'off',
  'low',
  'medium',
  'high',
  'xhigh',
  'max'
])
export type EffortLevel = z.infer<typeof EffortLevelSchema>

export const ModelSnapshotSchema = z.object({
  contextWindow: z.number().nullish(),
  maxOutputTokens: z.number().nullish(),
  reasoningLevels: z.array(EffortLevelSchema).default([]),
  // Which Anthropic thinking modes the model accepts, from the Models API's
  // `capabilities.thinking.types` — adaptive (`{type:"adaptive"}` + effort)
  // and budget-based (`{type:"enabled", budget_tokens}`). Optional: snapshots
  // saved before these existed, and every other provider, leave them unset
  // (resolveModel then falls back to an id rule).
  adaptiveThinking: z.boolean().nullish(),
  budgetThinking: z.boolean().nullish()
})
export type ModelSnapshot = z.infer<typeof ModelSnapshotSchema>

export const ProviderConfigSchema = z.object({
  provider: z.string().nullish(),
  model: z.string().nullish(),
  modelSnapshot: ModelSnapshotSchema.nullish()
  // TODO: RAG / embedding model — will be redesigned
})

export const CachedModelEntrySchema = z.object({
  id: z.string(),
  displayName: z.string(),
  snapshot: ModelSnapshotSchema,
  // The day the provider shuts the model down (`YYYY-MM-DD`), when its list
  // says so — only OpenAI's does today (`shutdown_date`).
  retiresAt: z.string().nullish()
})
export type CachedModelEntry = z.infer<typeof CachedModelEntrySchema>

// Keyed by the `AiProviders` enum value (e.g. "OpenAI GPT") — a live-fetched
// catalog, persisted so it survives closing Settings, switching tabs, and
// app restarts; only a manual Refresh click ever overwrites an entry.
export const ModelCatalogSchema = z.record(
  z.string(),
  z.array(CachedModelEntrySchema)
)
export type ModelCatalog = z.infer<typeof ModelCatalogSchema>

export const ProvidersSchema = z.object({
  openaiApiKey: z.string().nullish(),
  openaiBaseUrl: optionalUrl,
  azureOpenaiApiKey: z.string().nullish(),
  azureOpenAiEndpoint: optionalUrl,
  azureOpenAiApiVersion: z.string().nullish(),
  anthropicApiKey: z.string().nullish(),
  anthropicBaseUrl: optionalUrl,
  googleGeminiApiKey: z.string().nullish(),
  googleGeminiBaseUrl: optionalUrl,
  xAiApiKey: z.string().nullish(),
  xAiBaseUrl: optionalUrl,
  ollamaBaseUrl: z.string().nullish()
})

export const VoiceSchema = z.object({
  speechToTextModel: z.string().nullish(),
  textToSpeechVoice: z.string().nullish(),
  textToSpeechModel: z.string().nullish(),
  textToSpeechSpeed: formNumber(z.number().min(0.25).max(4.0)).nullish(),
  textToSpeechFormat: z.string().nullish(),
  textToSpeechInstructions: z.string().nullish()
})

export const GoogleCloudSchema = z.object({
  googleApiKey: z.string().nullish()
})

export const WebSearchSchema = z.object({
  braveApiKey: z.string().nullish(),
  country: z.string().nullish(),
  languages: z.array(z.string()).nullish(),
  maxResults: formNumber(z.number().gte(1).lte(50)).nullish(),
  recencyFilter: z.enum(['hour', 'day', 'week', 'month', 'year']).nullish(),
  domainFilter: z.string().nullish(), // comma-separated domain list
  // Run the grounding call AND a parallel web/search breadth pass, merging the
  // results — broader recall (forums, news clusters, URLs the grounding
  // threshold drops) at ~2x Brave API usage per search. Default on.
  deepRecall: z.boolean().nullish()
})

export const KnowledgeBaseSchema = z.object({
  url: optionalHttpUrl, // self-hosted LightRAG server, e.g. http://localhost:9621
  apiKey: z.string().nullish(), // sent as the X-API-Key header
  queryMode: z.enum(['naive', 'local', 'global', 'hybrid', 'mix']).nullish(), // default 'mix'
  topK: formNumber(z.number().gte(1).lte(200)).nullish(), // default 60
  chunkTopK: formNumber(z.number().gte(1).lte(100)).nullish() // default 10
})

export const ComputerUseSchema = z.object({
  enabled: z.boolean().default(false),
  targetAllowlist: z.array(z.string()).default([]),
  model: z.enum(['claude']).default('claude'),
  maxSteps: formNumber(z.number().gte(1).lte(100)).nullish(),
  settleMs: formNumber(z.number().gte(100).lte(5000)).nullish(),
  askHumanTimeoutMs: formNumber(z.number().gte(10_000).lte(1_800_000)).nullish()
})

/**
 * Coding-agent employees (spec 2026-10-09). Unset numbers take their
 * defaults where they are used (`src/main/lib/agents/settings.ts`): the
 * projects folder `~/Actovia Projects`, 2 running at once, 10 minutes kept.
 */
export const AgentsSettingsSchema = z.object({
  projectsDir: z.string().nullish(),
  maxRunning: formNumber(z.number().int().gte(1).lte(8)).nullish(),
  keepAliveMinutes: formNumber(z.number().int().gte(0).lte(120)).nullish(),
  worktrees: z.boolean().default(true),
  /** A path the owner set by hand, per CLI id; empty = look it up. */
  cliPaths: z.record(z.string(), z.string()).default({}),
  /** Per CLI: its default employee was added once; never again (the owner may delete it). Server-owned. */
  defaultEmployeesCreated: z.record(z.string(), z.boolean()).optional()
})
export type AgentsSettings = z.infer<typeof AgentsSettingsSchema>

export const DiscoverSchema = z.object({
  enabled: z.boolean().default(false),
  topicCount: formNumber(z.number().gte(1).lte(8)).nullish(), // default 4
  articlesPerTopic: formNumber(z.number().gte(1).lte(5)).nullish() // default 3
})

export const ImageSchema = z.object({
  model: z.string().nullish(),
  size: z.string().nullish(),
  quality: z.string().nullish(),
  outputFormat: z.string().nullish(),
  generatedCounts: formNumber(z.number().nonnegative().lte(10)).nullish(),
  background: z.string().nullish()
})

export const DeepResearchSchema = z.object({
  breadth: formNumber(z.number().gte(3).lte(10)).nullish(),
  depth: formNumber(z.number().gte(1).lte(5)).nullish()
})

export const S3Schema = z
  .object({
    region: z.string().nullish(),
    bucket: z.string().nullish(),
    accessKeyId: z.string().nullish(),
    secretAccessKey: z.string().nullish()
  })
  .superRefine((val, ctx) => {
    const fields = [
      'region',
      'bucket',
      'accessKeyId',
      'secretAccessKey'
    ] as const

    const values = fields.map((f) => val[f])
    const filledCount = values.filter(
      (v) => v != null && v.trim() !== ''
    ).length

    if (filledCount === 0) return
    if (filledCount === fields.length) return

    fields.forEach((f) => {
      if (val[f] == null) {
        ctx.addIssue({
          path: [f],
          code: z.ZodIssueCode.custom,
          message: 'S3 configuration must be filled in completely.'
        })
      }
    })
  })

export const ToolsSchema = z.object({
  disabledTools: z.array(z.string()).default([])
})

export const MemorySchema = z.object({
  // User memory: consolidate durable facts into memory after conversations
  autoCapture: z.boolean().default(true),
  // User memory: surface relevant memory into the system prompt of new chats
  useInChat: z.boolean().default(true),
  // LCM: enable lossless context management for long conversations
  lcmEnabled: z.boolean().default(true),
  // LCM: trigger compaction when context exceeds this % of the context window (50-95)
  contextWindowPercent: formNumber(z.number().gte(50).lte(95)).nullish(),
  // LCM: number of most recent runs — a user message with every model step
  // and tool result that answered it — protected from compaction (2-24). It
  // counted messages (8-64) before the chat kernel rewrite; a stored value
  // from then is clamped where it is read (`freshTailRuns()`).
  freshTailSize: formNumber(z.number().gte(2).lte(24)).nullish()
})

export const PersonalitySchema = z.object({
  // About you
  nickname: z.string().nullish(),
  occupation: z.string().nullish(),
  aboutYou: z.string().nullish(),
  // Personalization
  baseStyle: z
    .enum([
      'default',
      'professional',
      'friendly',
      'candid',
      'quirky',
      'efficient',
      'cynical'
    ])
    .default('default'),
  warm: z.enum(['default', 'more', 'less']).default('default'),
  enthusiastic: z.enum(['default', 'more', 'less']).default('default'),
  headersAndLists: z.enum(['default', 'more', 'less']).default('default'),
  emoji: z.enum(['default', 'more', 'less']).default('default'),
  customInstructions: z.string().nullish()
})

export const KeyboardShortcutsSchema = z.object({
  // Ids of toggleable shortcuts (ShortcutDef.id in use-keyboard-shortcuts.ts)
  // the user has turned off. Absent/empty = everything enabled.
  disabled: z.array(z.string()).nullish()
})

export const ColorToneSchema = z.enum([
  'neutral',
  'emerald',
  'blue',
  'violet',
  'rose',
  'orange',
  'yellow'
])
export type ColorTone = z.infer<typeof ColorToneSchema>
export const COLOR_TONES = ColorToneSchema.options

export const SettingsSchema = z.object({
  id: z.string(),
  providerConfig: ProviderConfigSchema.nullish(),
  providers: ProvidersSchema.nullish(),
  modelCatalog: ModelCatalogSchema.nullish(),
  tools: ToolsSchema.nullish(),
  voice: VoiceSchema.nullish(),
  userAvatar: z.string().nullish(),
  googleCloud: GoogleCloudSchema.nullish(),
  webSearch: WebSearchSchema.nullish(),
  knowledgeBase: KnowledgeBaseSchema.nullish(),
  computerUse: ComputerUseSchema.nullish(),
  agents: AgentsSettingsSchema.nullish(),
  discover: DiscoverSchema.nullish(),
  image: ImageSchema.nullish(),
  deepResearch: DeepResearchSchema.nullish(),
  s3: S3Schema.nullish(),
  autoUpdate: z.boolean().nullish(),
  runOnStartup: z.boolean().nullish(),
  menuBar: z.boolean().nullish(),
  language: z.union([z.enum(LOCALE_IDS), z.literal('auto')]).nullish(),
  autoBackup: z.boolean().nullish(),
  lastBackupAt: z.any().nullish(),
  memory: MemorySchema.nullish(),
  personality: PersonalitySchema.nullish(),
  keyboardShortcuts: KeyboardShortcutsSchema.nullish(),
  // Settings → General → Color tone: which `[data-tone]` palette globals.css
  // paints. null (older rows) = neutral.
  colorTone: ColorToneSchema.nullish(),
  createdAt: z.any(),
  updatedAt: z.any()
})

export type Settings = z.infer<typeof SettingsSchema>

export type SettingsInput = z.input<typeof SettingsSchema>

export type UseFormReturnType = UseFormReturn<SettingsInput>
