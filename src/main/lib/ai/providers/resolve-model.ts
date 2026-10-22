import type { ModelSnapshot } from '@actovia/shared/schemas/settings-schema'
import type { Api, KnownProvider, Model } from '@earendil-works/pi-ai'

import { getKernelModels } from '../kernel/models'

interface FallbackDefaults {
  contextWindow: number
  maxTokens: number
}

const PROVIDER_DEFAULTS: Partial<Record<string, FallbackDefaults>> = {
  openai: { contextWindow: 1_050_000, maxTokens: 128_000 },
  anthropic: { contextWindow: 1_000_000, maxTokens: 128_000 },
  azure: { contextWindow: 1_050_000, maxTokens: 128_000 },
  google: { contextWindow: 1_000_000, maxTokens: 65_536 },
  xai: { contextWindow: 500_000, maxTokens: 128_000 },
  ollama: { contextWindow: 128_000, maxTokens: 8192 }
}

/**
 * Metadata for a model id when no live-fetched snapshot is available (e.g. an
 * Ollama id typed free-hand, or a settings row saved before this feature
 * existed). Scoped to exactly what each provider's own list-models API omits
 * — see `src/main/lib/ai/providers/list-models/` for what's fetched live.
 * Numbers ported from the previous hand-maintained MODEL_OVERRIDES table.
 */
export const MODEL_METADATA_FALLBACK: Record<string, Partial<ModelSnapshot>> = {
  // ── OpenAI — its list API returns only id/created/owned_by, nothing else.
  'gpt-6-astra': {
    contextWindow: 1_050_000,
    maxOutputTokens: 128_000,
    reasoningLevels: ['off', 'low', 'medium', 'high', 'xhigh'],
    cost: { input: 10, output: 50 }
  },
  'gpt-5.6': {
    contextWindow: 1_050_000,
    maxOutputTokens: 128_000,
    reasoningLevels: ['off', 'low', 'medium', 'high', 'xhigh'],
    cost: { input: 4, output: 20 }
  },
  'gpt-5.6-terra': {
    contextWindow: 1_050_000,
    maxOutputTokens: 128_000,
    reasoningLevels: ['off', 'low', 'medium', 'high', 'xhigh'],
    cost: { input: 2, output: 12 }
  },
  'gpt-5.6-luna': {
    contextWindow: 1_050_000,
    maxOutputTokens: 128_000,
    reasoningLevels: ['off', 'low', 'medium'],
    cost: { input: 0.2, output: 1.2 }
  },
  // ── Google — list API gives context/tokens/boolean-thinking live; cost only here.
  'gemini-3.8-flash': { cost: { input: 0.75, output: 3.75 } },
  'gemini-3.7-flash': { cost: { input: 0.75, output: 3.75 } },
  'gemini-3.5-flash-lite': { cost: { input: 0.3, output: 2.5 } },
  // ── xAI — list API gives context + cost live; reasoning levels only here.
  'grok-4.6': { reasoningLevels: [] },
  'grok-4.5': { reasoningLevels: [] },
  'grok-4.1-fast': { reasoningLevels: [] }
  // Anthropic needs no entries — its list API is complete (see spec §Context).
}

type ThinkingLevelMap = NonNullable<Model<string>['thinkingLevelMap']>

/**
 * Claude families that take adaptive thinking (`{type:"adaptive"}` plus an
 * effort). A snapshot saved before list-models read the Models API's
 * `capabilities.thinking.types` has no say, so for an id pi-ai's registry
 * doesn't carry (a dated or newer release) this conservative rule decides:
 * these families get adaptive thinking — the budget form 400s on the newest
 * ones and is deprecated on the rest.
 */
const ADAPTIVE_CLAUDE =
  /^claude-(opus-5|sonnet-5|fable-|mythos-|opus-4-[6-9]|sonnet-4-6)/
/**
 * The subset of those where thinking can't be turned off — a
 * `{type:"disabled"}` request 400s or the model writes its thinking into the
 * answer instead. The 4.6–4.8 generation can still disable it.
 */
const ALWAYS_THINKING_CLAUDE = /^claude-(opus-5|sonnet-5|fable-|mythos-)/

/**
 * Where we keep thinking on although pi-ai's registry says it can be turned
 * off. pi-ai 1.3 lets Opus 5 send `{type:"disabled"}` (the API accepts it at
 * effort `high` or below), but with thinking disabled Opus 5 sometimes writes a
 * tool call into its visible text — the call never runs — and can leak
 * `<thinking>` tags; Anthropic recommends low effort instead.
 */
const KEEP_THINKING_CLAUDE = /^claude-opus-5(-\d{8})?$/

/** `map` with "off" marked unsupported for a model we keep thinking on. */
function keepThinkingOn(
  provider: KnownProvider,
  id: string,
  map: ThinkingLevelMap | undefined
): ThinkingLevelMap | undefined {
  if (provider !== 'anthropic' || !KEEP_THINKING_CLAUDE.test(id)) return map
  return { ...map, off: null }
}

/**
 * How an Anthropic model not in pi-ai's registry thinks: from the snapshot's
 * live capability when it has one, else from the id rule above. Adaptive-only
 * (adaptive, no budget form) also means thinking can't be disabled.
 */
function claudeThinking(
  provider: KnownProvider,
  id: string,
  snapshot: ModelSnapshot
): { adaptive: boolean; canDisable: boolean } | undefined {
  if (provider !== 'anthropic') return undefined
  if (typeof snapshot.adaptiveThinking === 'boolean') {
    const adaptiveOnly =
      snapshot.adaptiveThinking && snapshot.budgetThinking !== true
    return {
      adaptive: adaptiveOnly,
      canDisable: !adaptiveOnly
    }
  }
  return {
    adaptive: ADAPTIVE_CLAUDE.test(id),
    canDisable: !ALWAYS_THINKING_CLAUDE.test(id)
  }
}

export function resolveModel(
  provider: KnownProvider,
  id: string,
  baseUrl: string,
  api: Api,
  snapshot?: ModelSnapshot
): Model<string> {
  const defaults = PROVIDER_DEFAULTS[provider] ?? {
    contextWindow: 128000,
    maxTokens: 8192
  }

  // A live-fetched snapshot can still have null/empty fields (Ollama's is
  // always all-null; an unknown OpenAI id with no MODEL_METADATA_FALLBACK
  // entry has none either) — fall back to the same PROVIDER_DEFAULTS used
  // below rather than letting contextWindow/maxTokens/cost end up undefined,
  // which would silently break LCM's context-budget math downstream.
  if (snapshot) {
    const hasReasoning = snapshot.reasoningLevels.some((l) => l !== 'off')

    // pi-ai sends `thinkingLevelMap[level]` as the effort, and treats a level
    // with no 'xhigh'/'max' entry as unsupported (its default for an unmapped
    // level is "high"). The composer passes 'xhigh' and 'max' through as they
    // are (see chat.ts), so each tier the snapshot reports maps to itself.
    const levelMap: ThinkingLevelMap = {}
    if (hasReasoning) {
      for (const level of ['xhigh', 'max'] as const) {
        if (snapshot.reasoningLevels.includes(level)) levelMap[level] = level
      }
    }

    // How the request asks for thinking (adaptive + effort vs. a token
    // budget, and whether it can be turned off) is API behaviour the snapshot
    // doesn't carry — pi-ai's registry does, for the models it knows.
    const registered = getKernelModels().getModel(provider, id) as
      | Model<string>
      | undefined
    const known = registered?.api === api ? registered : undefined
    const derived = known ? undefined : claudeThinking(provider, id, snapshot)

    const thinkingLevelMap: ThinkingLevelMap | undefined = hasReasoning
      ? keepThinkingOn(provider, id, {
          ...levelMap,
          ...known?.thinkingLevelMap,
          ...(derived?.canDisable === false ? { off: null } : {})
        })
      : undefined

    const compat = known?.compat
      ? known.compat
      : derived?.adaptive
        ? { forceAdaptiveThinking: true }
        : undefined

    return {
      id,
      name: id,
      provider,
      api,
      baseUrl,
      input: known?.input ?? ['text', 'image'],
      reasoning: hasReasoning,
      thinkingLevelMap:
        thinkingLevelMap && Object.keys(thinkingLevelMap).length > 0
          ? thinkingLevelMap
          : undefined,
      ...(known?.headers ? { headers: known.headers } : {}),
      ...(compat ? { compat } : {}),
      contextWindow: snapshot.contextWindow ?? defaults.contextWindow,
      maxTokens: snapshot.maxOutputTokens ?? defaults.maxTokens,
      // ModelSnapshotSchema (packages/shared/src/schemas/settings-schema.ts)
      // has no field for cache pricing — none of the list-models handlers
      // this snapshot came from report cache read/write rates, so cost
      // estimates under-report for any model that gets a real cache
      // discount. This is a known gap in the schema, not fixed here (too
      // large/risky for a one-shot fix) — revisit if ModelSnapshotSchema
      // ever gains cache-rate fields.
      // Anthropic's list API carries no prices at all (`cost: null`): the
      // registry's, cache rates included, rather than $0 for every request.
      cost: snapshot.cost
        ? { ...snapshot.cost, cacheRead: 0, cacheWrite: 0 }
        : (known?.cost ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 })
    } as Model<string>
  }

  // The model id is user-configured and may not be in the provider's
  // catalog; the fallback below covers that.
  const registered = getKernelModels().getModel(provider, id) as
    | Model<string>
    | undefined
  if (registered) {
    const thinkingLevelMap = registered.reasoning
      ? keepThinkingOn(provider, id, registered.thinkingLevelMap)
      : registered.thinkingLevelMap
    return baseUrl === registered.baseUrl &&
      thinkingLevelMap === registered.thinkingLevelMap
      ? registered
      : { ...registered, baseUrl, thinkingLevelMap }
  }
  {
    const fallback = MODEL_METADATA_FALLBACK[id]
    return {
      id,
      name: id,
      api,
      provider,
      baseUrl,
      reasoning: (fallback?.reasoningLevels ?? []).some((l) => l !== 'off'),
      input: ['text', 'image'],
      cost: fallback?.cost
        ? { ...fallback.cost, cacheRead: 0, cacheWrite: 0 }
        : { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: fallback?.contextWindow ?? defaults.contextWindow,
      maxTokens: fallback?.maxOutputTokens ?? defaults.maxTokens
    }
  }
}
