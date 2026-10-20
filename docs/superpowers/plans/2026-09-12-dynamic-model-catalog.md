# Dynamic Model Catalog + Single Model/Effort Selection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the hardcoded per-provider model lists (`src/shared/constants/models.ts`, `MODEL_OVERRIDES`) with a live, manually-refreshed fetch against each provider's real list-models API, and collapse the "Chat Model" / "Reasoning Model" pair into one selected model plus a reasoning-effort level (off/low/medium/high/xhigh/max) applied per message.

**Architecture:** A new `GET`-shaped-but-`POST`-transmitted `/api/settings/models` route (POST to keep the API key out of query strings/logs) dispatches to one handler per provider, each normalizing that provider's real response into `{ id, displayName, snapshot: ModelSnapshot }`, filling whatever the provider's own API omits from a small `MODEL_METADATA_FALLBACK` table. Settings persists only the _selected_ model's id + snapshot (`providerConfig.model` / `providerConfig.modelSnapshot`) — the fetched list itself is never stored. `resolveModel()` reads that persisted snapshot directly instead of consulting a hardcoded table. The composer's binary "Reasoning" toggle becomes a level picker sourced from that same persisted snapshot.

**Tech Stack:** Hono (backend routes), Zod (schema), React Hook Form + the existing per-field autosave (`useSettingsAutosave`), Jotai (composer state), Vitest (unit tests), Playwright (UI tests via `TEST_IDS`).

**Spec:** `docs/superpowers/specs/2026-09-12-dynamic-model-catalog-design.md`

## Global Constraints

- No backward-compat shim for existing `providerConfig.{chatModel,reasoningModel}` rows — the field is renamed to `model`; old rows read as unset and the user re-picks once (spec Decision 5).
- The fetched model _list_ is never persisted, no TTL, no cache table — only the selected model's snapshot is (spec Decision 4).
- Model-list fetch is manual only (a button) — no auto-fetch on blur/keystroke (spec Decision 3).
- All 6 providers in scope: OpenAI, Azure OpenAI, Anthropic, Google Gemini, xAI, Ollama (spec Decision 2).
- Azure's fetch mechanism and xAI's price-field units are **unverified** against real APIs — each relevant task's first step is a verification step against the real endpoint, not an assumption to implement blind.
- Per CLAUDE.md: adding a route/changing architecture updates CLAUDE.md in the same change (Task 19), and any interactive element needing a `data-testid` goes through the `TEST_IDS` registry, never a raw string (Tasks 12, 15).
- Deviation from the spec, made explicit here: the spec wrote the route as `GET /api/settings/models?provider=X`. This plan uses `POST /api/settings/models` with the API key in the JSON body instead — a GET query string containing an API key ends up in server access logs and Hono's trace attributes; nothing about the design changes, only the transport.

---

## Phase 1 — Schema & core model resolution

### Task 1: Schema — `EffortLevel` + `ModelSnapshot` + `ProviderConfigSchema` rename

**Files:**

- Modify: `src/shared/schemas/settings-schema.ts:44-49` (`ProviderConfigSchema`)
- Test: `tests/unit/shared/schemas/settings-schema.test.ts` (new file)

**Interfaces:**

- Produces: `EffortLevelSchema`, `EffortLevel`, `ModelSnapshotSchema`, `ModelSnapshot`, updated `ProviderConfigSchema` — every later task imports these from `@shared/schemas/settings-schema`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/shared/schemas/settings-schema.test.ts
import {
  EffortLevelSchema,
  ModelSnapshotSchema,
  ProviderConfigSchema
} from '@shared/schemas/settings-schema'
import { describe, expect, it } from 'vitest'

describe('EffortLevelSchema', () => {
  it('accepts every defined level', () => {
    for (const level of ['off', 'low', 'medium', 'high', 'xhigh', 'max']) {
      expect(EffortLevelSchema.safeParse(level).success).toBe(true)
    }
  })

  it('rejects an unknown level', () => {
    expect(EffortLevelSchema.safeParse('extreme').success).toBe(false)
  })
})

describe('ModelSnapshotSchema', () => {
  it('accepts a full snapshot', () => {
    const result = ModelSnapshotSchema.safeParse({
      contextWindow: 200_000,
      maxOutputTokens: 8_000,
      reasoningLevels: ['off', 'high'],
      cost: { input: 2, output: 10 }
    })
    expect(result.success).toBe(true)
  })

  it('accepts null cost and empty reasoningLevels (Ollama shape)', () => {
    const result = ModelSnapshotSchema.safeParse({
      contextWindow: null,
      maxOutputTokens: null,
      reasoningLevels: [],
      cost: null
    })
    expect(result.success).toBe(true)
  })
})

describe('ProviderConfigSchema', () => {
  it('no longer has chatModel/reasoningModel fields', () => {
    const parsed = ProviderConfigSchema.parse({
      provider: 'OpenAI GPT',
      model: 'gpt-5.6'
    })
    expect(parsed).not.toHaveProperty('chatModel')
    expect(parsed).not.toHaveProperty('reasoningModel')
  })

  it('accepts a full modelSnapshot alongside model', () => {
    const parsed = ProviderConfigSchema.parse({
      provider: 'OpenAI GPT',
      model: 'gpt-5.6',
      modelSnapshot: {
        contextWindow: 1_050_000,
        maxOutputTokens: 128_000,
        reasoningLevels: ['off', 'high'],
        cost: { input: 4, output: 20 }
      }
    })
    expect(parsed.modelSnapshot?.contextWindow).toBe(1_050_000)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- settings-schema`
Expected: FAIL — `EffortLevelSchema`/`ModelSnapshotSchema` don't exist yet, and `ProviderConfigSchema` still has `chatModel`/`reasoningModel`.

- [ ] **Step 3: Implement the schema change**

In `src/shared/schemas/settings-schema.ts`, replace lines 44-49:

```ts
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
  cost: z.object({ input: z.number(), output: z.number() }).nullish()
})
export type ModelSnapshot = z.infer<typeof ModelSnapshotSchema>

export const ProviderConfigSchema = z.object({
  provider: z.string().nullish(),
  model: z.string().nullish(),
  modelSnapshot: ModelSnapshotSchema.nullish()
  // TODO: RAG / embedding model — will be redesigned
})
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- settings-schema`
Expected: PASS

- [ ] **Step 5: Run full typecheck to see the blast radius**

Run: `pnpm typecheck`
Expected: FAIL — every reader of `providerConfig.chatModel`/`.reasoningModel` now has a type error. Do not fix these yet; Tasks 2-17 fix them one by one. Note the list of errors so you can confirm it shrinks to zero by Task 17.

- [ ] **Step 6: Commit**

```bash
git add src/shared/schemas/settings-schema.ts tests/unit/shared/schemas/settings-schema.test.ts
git commit -m "feat(settings): add EffortLevel/ModelSnapshot, collapse chatModel+reasoningModel into model"
```

---

### Task 2: `resolveModel()` accepts a snapshot; `MODEL_OVERRIDES` → `MODEL_METADATA_FALLBACK`

**Files:**

- Modify: `src/main/lib/ai/providers/resolve-model.ts` (whole file)
- Modify: `tests/unit/main/lib/ai/providers/resolve-model.test.ts`

**Interfaces:**

- Consumes: `ModelSnapshot` from Task 1.
- Produces: `resolveModel(provider, id, baseUrl, api, snapshot?: ModelSnapshot): Model<string>` — Task 3 calls this with the persisted snapshot.

- [ ] **Step 1: Write the failing test**

Add to `tests/unit/main/lib/ai/providers/resolve-model.test.ts`:

```ts
it('prefers a passed snapshot over the registry and MODEL_METADATA_FALLBACK', () => {
  const model = resolveModel(
    'openai',
    'gpt-5.6',
    'https://api.openai.com/v1',
    'openai-responses',
    {
      contextWindow: 999,
      maxOutputTokens: 111,
      reasoningLevels: ['off', 'max'],
      cost: { input: 1, output: 2 }
    }
  )
  expect(model.contextWindow).toBe(999)
  expect(model.maxTokens).toBe(111)
  expect(model.cost.input).toBe(1)
  expect(model.cost.output).toBe(2)
  expect(model.reasoning).toBe(true) // reasoningLevels has more than just 'off'
})

it('falls back to MODEL_METADATA_FALLBACK when no snapshot is passed (Ollama free-typed ids)', () => {
  const model = resolveModel(
    'openai',
    'gpt-5.6',
    'https://api.openai.com/v1',
    'openai-responses'
  )
  // gpt-5.6 has a MODEL_METADATA_FALLBACK entry (OpenAI's own list API gives us nothing else)
  expect(model.cost.input).toBeGreaterThan(0)
})

it('falls back to PROVIDER_DEFAULTS for a snapshot with null fields (Ollama live-fetch shape)', () => {
  const model = resolveModel(
    'ollama',
    'llama3.1:70b',
    'http://localhost:11434',
    'openai-completions',
    {
      contextWindow: null,
      maxOutputTokens: null,
      reasoningLevels: [],
      cost: null
    }
  )
  expect(model.contextWindow).toBe(128_000)
  expect(model.maxTokens).toBe(8192)
  expect(model.cost.input).toBe(0)
  expect(model.reasoning).toBe(false)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- resolve-model`
Expected: FAIL — `resolveModel` doesn't accept a 5th argument yet.

- [ ] **Step 3: Implement**

Replace `src/main/lib/ai/providers/resolve-model.ts` in full:

```ts
import type { Api, KnownProvider, Model } from '@mariozechner/pi-ai'
import { getModel } from '@mariozechner/pi-ai'
import type { ModelSnapshot } from '@shared/schemas/settings-schema'

interface FallbackDefaults {
  contextWindow: number
  maxTokens: number
}

const PROVIDER_DEFAULTS: Partial<Record<string, FallbackDefaults>> = {
  openai: { contextWindow: 1_050_000, maxTokens: 128_000 },
  anthropic: { contextWindow: 1_000_000, maxTokens: 128_000 },
  'azure-openai-responses': { contextWindow: 1_050_000, maxTokens: 128_000 },
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
    return {
      id,
      name: id,
      provider,
      api,
      baseUrl,
      input: ['text', 'image'],
      reasoning: snapshot.reasoningLevels.some((l) => l !== 'off'),
      contextWindow: snapshot.contextWindow ?? defaults.contextWindow,
      maxTokens: snapshot.maxOutputTokens ?? defaults.maxTokens,
      cost: snapshot.cost
        ? { ...snapshot.cost, cacheRead: 0, cacheWrite: 0 }
        : { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
    } as Model<string>
  }

  try {
    // @ts-expect-error — model ID is user-configured, may not be in registry; fallback below handles it
    const registered = getModel(provider, id)
    return baseUrl !== registered.baseUrl
      ? { ...registered, baseUrl }
      : registered
  } catch {
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
```

Note: the previous `thinkingLevelMap` field (`{ xhigh: 'xhigh' }` etc.) is dropped from the override path — it was pi-ai's mechanism for clamping a requested effort to what a model supports. Task 16 replaces its role: the composer only ever offers levels present in `modelSnapshot.reasoningLevels`, so an unsupported level is never requested in the first place.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- resolve-model`
Expected: PASS. Also re-run the two existing tests in this file that referenced `claude-opus-4-8` / `claude-opus-4-7` / `totally-made-up-model-xyz` / `some-local-model` — they call `resolveModel` with 4 args (no snapshot), so they exercise the fallback path. `claude-opus-4-8` no longer has a `MODEL_METADATA_FALLBACK` entry (Anthropic needs none) — update that test's expectations: change the assertion `expect(model.cost.input).toBe(5)` etc. to instead assert the _no-fallback_ defaults (`cost.input === 0`, `contextWindow === PROVIDER_DEFAULTS.anthropic.contextWindow`), since Anthropic models are now expected to always carry a live-fetched snapshot in real use — the registry/fallback path is only the local-Ollama/pre-migration safety net.

- [ ] **Step 5: Commit**

```bash
git add src/main/lib/ai/providers/resolve-model.ts tests/unit/main/lib/ai/providers/resolve-model.test.ts
git commit -m "feat(providers): resolveModel prefers a live snapshot; MODEL_OVERRIDES -> MODEL_METADATA_FALLBACK"
```

---

### Task 3: `providers/index.ts` — one model per provider, snapshot passthrough

**Files:**

- Modify: `src/main/lib/ai/providers/index.ts` (whole file)
- Modify: `src/main/lib/ai/providers/ollama.ts`
- Modify: `tests/unit/main/lib/ai/providers/providers.test.ts`

**Interfaces:**

- Consumes: `resolveModel(provider, id, baseUrl, api, snapshot?)` from Task 2.
- Produces: `ProviderFn = (setting: Settings) => Model<string>` (was `=> ProviderResult` with `.chatModel`/`.reasoningModel`) — Task 4 (`model-util.ts`) is the only other caller.

- [ ] **Step 1: Write the failing test**

Rewrite `tests/unit/main/lib/ai/providers/providers.test.ts` in full:

```ts
import { providers } from '@main/lib/ai/providers'
import type { Settings } from '@main/lib/db/schema'
import { AiProviders } from '@shared/types/ai'
import { describe, expect, it } from 'vitest'

const settings = (over: Partial<Settings> = {}): Settings =>
  ({ id: 's', ...over }) as unknown as Settings

describe('providers table', () => {
  it('each registry-backed provider resolves its pi-ai provider + default id + api', () => {
    const cases: [AiProviders, string, string, string][] = [
      [AiProviders.OpenAiGpt, 'openai', 'gpt-5.6', 'openai-responses'],
      [
        AiProviders.AzureOpenAi,
        'azure-openai-responses',
        'gpt-5.6',
        'azure-openai-responses'
      ],
      [
        AiProviders.AnthropicClaude,
        'anthropic',
        'claude-opus-5',
        'anthropic-messages'
      ],
      [
        AiProviders.GoogleGemini,
        'google',
        'gemini-3.1-pro-preview',
        'google-generative-ai'
      ],
      // xAI's API mimics the legacy OpenAI Chat Completions shape and has no
      // Responses-API equivalent — must stay 'openai-completions'.
      [AiProviders.XaiGrok, 'xai', 'grok-4.6', 'openai-completions']
    ]
    for (const [key, provider, defaultId, api] of cases) {
      const model = providers[key](settings())
      expect(model.provider, key).toBe(provider)
      expect(model.id, key).toBe(defaultId)
      expect(model.api, key).toBe(api)
    }
  })

  it('honours an explicit model id, snapshot, and a custom base URL', () => {
    const model = providers[AiProviders.AnthropicClaude](
      settings({
        providers: { anthropicBaseUrl: 'https://proxy.example.com' },
        providerConfig: {
          model: 'my-model',
          modelSnapshot: {
            contextWindow: 12345,
            maxOutputTokens: 999,
            reasoningLevels: ['off', 'max'],
            cost: { input: 1, output: 2 }
          }
        }
      } as Partial<Settings>)
    )
    expect(model.id).toBe('my-model')
    expect(model.baseUrl).toBe('https://proxy.example.com')
    expect(model.contextWindow).toBe(12345)
    expect(model.cost.input).toBe(1)
  })

  it('falls back to each provider default base URL', () => {
    expect(providers[AiProviders.OpenAiGpt](settings()).baseUrl).toBe(
      'https://api.openai.com/v1'
    )
    expect(providers[AiProviders.XaiGrok](settings()).baseUrl).toBe(
      'https://api.x.ai/v1'
    )
  })

  it('ollama builds a hand-rolled model from the typed id', () => {
    const model = providers[AiProviders.Ollama](
      settings({
        providerConfig: { model: 'llama3.1:70b' }
      } as Partial<Settings>)
    )
    expect(model.id).toBe('llama3.1:70b')
    expect(model.contextWindow).toBe(128000)
    expect(model.cost.input).toBe(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- providers.test`
Expected: FAIL — `providers[key](settings())` still returns `{ chatModel, reasoningModel }`, not a bare `Model`.

- [ ] **Step 3: Implement**

Replace `src/main/lib/ai/providers/index.ts` in full:

```ts
import type { Api, KnownProvider, Model } from '@mariozechner/pi-ai'
import { AiProviders } from '@shared/types/ai'
import type { Settings } from '@shared/types/db'

import { getOllama } from './ollama'
import { resolveModel } from './resolve-model'

export type ProviderFn = (setting: Settings) => Model<string>

interface ProviderSpec {
  provider: KnownProvider
  api: Api
  baseUrl: (setting: Settings) => string
  defaultModel: string
}

const SPECS: Record<Exclude<AiProviders, AiProviders.Ollama>, ProviderSpec> = {
  [AiProviders.OpenAiGpt]: {
    provider: 'openai',
    // Every OpenAI model in pi-ai's own registry resolves through the
    // Responses API, not Chat Completions — the legacy endpoint outright
    // rejects function tools + reasoning_effort together on current models.
    // xAI/Ollama stay on 'openai-completions': their APIs mimic the legacy
    // Chat Completions shape and have no Responses-API equivalent.
    api: 'openai-responses',
    baseUrl: (s) => s.providers?.openaiBaseUrl ?? 'https://api.openai.com/v1',
    defaultModel: 'gpt-5.6'
  },
  [AiProviders.AzureOpenAi]: {
    provider: 'azure-openai-responses',
    api: 'azure-openai-responses',
    baseUrl: (s) => s.providers?.azureOpenAiEndpoint ?? '',
    defaultModel: 'gpt-5.6'
  },
  [AiProviders.AnthropicClaude]: {
    provider: 'anthropic',
    api: 'anthropic-messages',
    baseUrl: (s) =>
      s.providers?.anthropicBaseUrl ?? 'https://api.anthropic.com',
    defaultModel: 'claude-opus-5'
  },
  [AiProviders.GoogleGemini]: {
    provider: 'google',
    api: 'google-generative-ai',
    baseUrl: (s) =>
      s.providers?.googleGeminiBaseUrl ??
      'https://generativelanguage.googleapis.com/v1beta',
    defaultModel: 'gemini-3.1-pro-preview'
  },
  [AiProviders.XaiGrok]: {
    provider: 'xai',
    api: 'openai-completions',
    baseUrl: (s) => s.providers?.xAiBaseUrl ?? 'https://api.x.ai/v1',
    defaultModel: 'grok-4.6'
  }
}

function fromSpec(spec: ProviderSpec): ProviderFn {
  return (setting) => {
    const baseUrl = spec.baseUrl(setting)
    const id = setting.providerConfig?.model ?? spec.defaultModel
    const snapshot = setting.providerConfig?.modelSnapshot ?? undefined
    return resolveModel(spec.provider, id, baseUrl, spec.api, snapshot)
  }
}

export const providers: Record<AiProviders, ProviderFn> = {
  [AiProviders.Ollama]: getOllama,
  [AiProviders.OpenAiGpt]: fromSpec(SPECS[AiProviders.OpenAiGpt]),
  [AiProviders.AzureOpenAi]: fromSpec(SPECS[AiProviders.AzureOpenAi]),
  [AiProviders.AnthropicClaude]: fromSpec(SPECS[AiProviders.AnthropicClaude]),
  [AiProviders.GoogleGemini]: fromSpec(SPECS[AiProviders.GoogleGemini]),
  [AiProviders.XaiGrok]: fromSpec(SPECS[AiProviders.XaiGrok])
}
```

Open `src/main/lib/ai/providers/ollama.ts` and confirm `getOllama`'s signature is already `(setting: Settings) => Model<string>` (not `ProviderResult`) — if it currently reads `setting.providerConfig?.chatModel`, change that one field access to `setting.providerConfig?.model`. Everything else in that file (the hand-built `Model` construction) is unaffected by this task.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- providers.test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/lib/ai/providers/index.ts src/main/lib/ai/providers/ollama.ts tests/unit/main/lib/ai/providers/providers.test.ts
git commit -m "feat(providers): one resolved model per provider instead of chat+reasoning pair"
```

---

### Task 4: `model-util.ts` — single `model`; delete `getStaleModelSelections`

**Files:**

- Modify: `src/main/lib/ai/utils/model-util.ts` (whole file)
- Modify: `src/main/lib/ai/utils/chat-message-util.ts:7-13` (re-export list)
- Delete: `tests/unit/main/lib/ai/utils/model-util.test.ts`

**Interfaces:**

- Consumes: `providers[key](setting): Model<string>` from Task 3.
- Produces: `getModelFromProvider(setting): { model: Model<string>; apiKey: string }` — consumed by Tasks 16 and 17 (10 call sites total).

- [ ] **Step 1: Update the implementation** (no new test — this file has no independent logic left to test once `getStaleModelSelections` is gone; its behavior is exercised end-to-end by Task 16/17's tests)

Replace `src/main/lib/ai/utils/model-util.ts` in full:

```ts
import type { Model } from '@mariozechner/pi-ai'
import { ErrorCode } from '@shared/constants/error-codes'
import { ConfigurationError, NotFoundError } from '@shared/errors/app-error'
import { AiProviders } from '@shared/types/ai'

import { Settings } from '../../db/schema'
import { providers } from '../providers'

export const PROVIDER_API_KEY_LABELS: Record<AiProviders, string> = {
  [AiProviders.OpenAiGpt]: 'OpenAI API Key',
  [AiProviders.AnthropicClaude]: 'Anthropic API Key',
  [AiProviders.GoogleGemini]: 'Google Gemini API Key',
  [AiProviders.XaiGrok]: 'xAI API Key',
  [AiProviders.AzureOpenAi]: 'Azure OpenAI API Key',
  [AiProviders.Ollama]: 'Ollama'
}

export function getApiKeyFromSetting(setting: Settings): string {
  const provider = setting.providerConfig?.provider as AiProviders | undefined
  if (!provider) return ''

  switch (provider) {
    case AiProviders.OpenAiGpt:
      return setting.providers?.openaiApiKey ?? ''
    case AiProviders.AnthropicClaude:
      return setting.providers?.anthropicApiKey ?? ''
    case AiProviders.GoogleGemini:
      return setting.providers?.googleGeminiApiKey ?? ''
    case AiProviders.XaiGrok:
      return setting.providers?.xAiApiKey ?? ''
    case AiProviders.AzureOpenAi:
      return setting.providers?.azureOpenaiApiKey ?? ''
    case AiProviders.Ollama:
      return 'ollama'
    default:
      return ''
  }
}

export function getModelFromProvider(setting: Settings): {
  model: Model<string>
  apiKey: string
} {
  if (!('id' in setting)) {
    throw new NotFoundError(
      ErrorCode.SETTING_NOT_FOUND,
      'Settings not initialized. Please restart the app.'
    )
  }

  if (!setting.providerConfig?.provider) {
    throw new ConfigurationError(ErrorCode.CONFIG_MISSING_PROVIDER)
  }

  const providerEnum = setting.providerConfig.provider as AiProviders
  const model = providers[providerEnum](setting)
  const apiKey = getApiKeyFromSetting(setting)

  if (!apiKey) {
    const label = PROVIDER_API_KEY_LABELS[providerEnum] ?? providerEnum
    throw new ConfigurationError(ErrorCode.CONFIG_MISSING_API_KEY, undefined, {
      label
    })
  }

  return { model, apiKey }
}
```

`getStaleModelSelections` and its `StaleModelSelection` interface are deleted outright (spec §4 — real staleness now surfaces as an actual provider error, translated by `toFriendlyChatError`'s existing "model not found" branch, instead of a proactive pre-check against a list we no longer keep hardcoded).

In `src/main/lib/ai/utils/chat-message-util.ts`, update the re-export block (currently lines 7-13):

```ts
export {
  getApiKeyFromSetting,
  getModelFromProvider,
  PROVIDER_API_KEY_LABELS
} from './model-util'
```

- [ ] **Step 2: Delete the now-obsolete test file**

```bash
rm tests/unit/main/lib/ai/utils/model-util.test.ts
```

- [ ] **Step 3: Run typecheck to confirm this file compiles standalone**

Run: `pnpm typecheck:node`
Expected: still FAILs (chat.ts and the 9 other call sites haven't been updated — Tasks 16/17), but the errors should now all be about `.chatModel`/`.reasoningModel`/`getStaleModelSelections` at _call sites_, not inside `model-util.ts` or `chat-message-util.ts` themselves. Confirm no error is reported against those two files.

- [ ] **Step 4: Commit**

```bash
git add src/main/lib/ai/utils/model-util.ts src/main/lib/ai/utils/chat-message-util.ts
git rm tests/unit/main/lib/ai/utils/model-util.test.ts
git commit -m "feat(ai): getModelFromProvider returns a single model; remove stale-model-list notice"
```

---

## Phase 2 — Live model-list fetch (backend)

### Task 5: Shared types, fallback re-export, and the Anthropic handler

Anthropic goes first because its list API is complete (spec §Context table) — it establishes the normalized shape with zero fallback-filling, which is the simplest case to get right before adding gap-filling logic in Tasks 6-9.

**Files:**

- Create: `src/main/lib/ai/providers/list-models/types.ts`
- Create: `src/main/lib/ai/providers/list-models/anthropic.ts`
- Test: `tests/unit/main/lib/ai/providers/list-models/anthropic.test.ts`

**Interfaces:**

- Produces: `NormalizedModel { id, displayName, snapshot: ModelSnapshot }`, `ListModelsArgs { apiKey: string; baseUrl?: string | null }`, `listAnthropicModels(args: ListModelsArgs): Promise<NormalizedModel[]>` — Tasks 6-10 each produce one more `list<Provider>Models` function with this same `(args: ListModelsArgs) => Promise<NormalizedModel[]>` signature; Task 11 wires all six into the route.

- [ ] **Step 1: Create the shared types file**

```ts
// src/main/lib/ai/providers/list-models/types.ts
import type { ModelSnapshot } from '@shared/schemas/settings-schema'

export interface NormalizedModel {
  id: string
  displayName: string
  snapshot: ModelSnapshot
}

export interface ListModelsArgs {
  apiKey: string
  baseUrl?: string | null
  /** Azure only. */
  apiVersion?: string | null
}

export type ListModelsFn = (args: ListModelsArgs) => Promise<NormalizedModel[]>
```

- [ ] **Step 2: Write the failing test**

```ts
// tests/unit/main/lib/ai/providers/list-models/anthropic.test.ts
import { listAnthropicModels } from '@main/lib/ai/providers/list-models/anthropic'
import { afterEach, describe, expect, it, vi } from 'vitest'

describe('listAnthropicModels', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('normalizes capabilities.effort into reasoningLevels, in level order', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [
            {
              id: 'claude-opus-5',
              display_name: 'Claude Opus 5',
              max_input_tokens: 1_000_000,
              max_tokens: 128_000,
              capabilities: {
                effort: {
                  supported: true,
                  low: { supported: true },
                  medium: { supported: true },
                  high: { supported: true },
                  xhigh: { supported: true },
                  max: { supported: true }
                }
              }
            }
          ]
        }),
        { status: 200 }
      )
    )
    vi.stubGlobal('fetch', fetchMock)

    const models = await listAnthropicModels({ apiKey: 'sk-ant-test' })

    expect(models).toEqual([
      {
        id: 'claude-opus-5',
        displayName: 'Claude Opus 5',
        snapshot: {
          contextWindow: 1_000_000,
          maxOutputTokens: 128_000,
          reasoningLevels: ['off', 'low', 'medium', 'high', 'xhigh', 'max'],
          cost: null
        }
      }
    ])
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.anthropic.com/v1/models',
      expect.objectContaining({
        headers: expect.objectContaining({
          'x-api-key': 'sk-ant-test',
          'anthropic-version': '2023-06-01'
        })
      })
    )
  })

  it('reports reasoningLevels: [] for a model with no effort support', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            data: [
              {
                id: 'claude-haiku-4-5',
                display_name: 'Claude Haiku 4.5',
                max_input_tokens: 200_000,
                max_tokens: 64_000,
                capabilities: { effort: { supported: false } }
              }
            ]
          }),
          { status: 200 }
        )
      )
    )
    const models = await listAnthropicModels({ apiKey: 'sk-ant-test' })
    expect(models[0].snapshot.reasoningLevels).toEqual([])
  })

  it('throws with the raw error body on a non-2xx response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({ error: { message: 'invalid x-api-key' } }),
          {
            status: 401
          }
        )
      )
    )
    await expect(listAnthropicModels({ apiKey: 'bad' })).rejects.toThrow(
      /invalid x-api-key/
    )
  })

  it('respects a custom baseUrl', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ data: [] }), { status: 200 })
      )
    vi.stubGlobal('fetch', fetchMock)
    await listAnthropicModels({
      apiKey: 'k',
      baseUrl: 'https://proxy.example.com'
    })
    expect(fetchMock).toHaveBeenCalledWith(
      'https://proxy.example.com/v1/models',
      expect.anything()
    )
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm test -- list-models/anthropic`
Expected: FAIL — module doesn't exist.

- [ ] **Step 4: Implement**

```ts
// src/main/lib/ai/providers/list-models/anthropic.ts
import type { EffortLevel } from '@shared/schemas/settings-schema'

import type { ListModelsFn, NormalizedModel } from './types'

const EFFORT_LEVELS_IN_ORDER: Exclude<EffortLevel, 'off'>[] = [
  'low',
  'medium',
  'high',
  'xhigh',
  'max'
]

interface AnthropicModel {
  id: string
  display_name: string
  max_input_tokens: number | null
  max_tokens: number | null
  capabilities: {
    effort?: {
      supported: boolean
      low?: { supported: boolean }
      medium?: { supported: boolean }
      high?: { supported: boolean }
      xhigh?: { supported: boolean } | null
      max?: { supported: boolean }
    }
  } | null
}

export const listAnthropicModels: ListModelsFn = async ({
  apiKey,
  baseUrl
}) => {
  const url = `${baseUrl ?? 'https://api.anthropic.com'}/v1/models`
  const response = await fetch(url, {
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    }
  })

  if (!response.ok) {
    const body = await response.text()
    throw new Error(
      `Anthropic list-models failed (${response.status}): ${body}`
    )
  }

  const { data } = (await response.json()) as { data: AnthropicModel[] }

  return data.map((m): NormalizedModel => {
    const effort = m.capabilities?.effort
    const levels: EffortLevel[] = effort?.supported
      ? [
          'off',
          ...EFFORT_LEVELS_IN_ORDER.filter((level) => effort[level]?.supported)
        ]
      : []
    return {
      id: m.id,
      displayName: m.display_name,
      snapshot: {
        contextWindow: m.max_input_tokens,
        maxOutputTokens: m.max_tokens,
        reasoningLevels: levels,
        cost: null // Anthropic's list API doesn't report price
      }
    }
  })
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm test -- list-models/anthropic`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/main/lib/ai/providers/list-models/types.ts src/main/lib/ai/providers/list-models/anthropic.ts tests/unit/main/lib/ai/providers/list-models/anthropic.test.ts
git commit -m "feat(providers): live Anthropic model list with capabilities.effort -> reasoningLevels"
```

---

### Task 6: OpenAI handler (id-only API, full fallback dependency)

**Files:**

- Create: `src/main/lib/ai/providers/list-models/openai.ts`
- Test: `tests/unit/main/lib/ai/providers/list-models/openai.test.ts`

**Interfaces:**

- Consumes: `MODEL_METADATA_FALLBACK` (Task 2), `NormalizedModel`/`ListModelsFn` (Task 5).
- Produces: `listOpenAiModels: ListModelsFn`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/main/lib/ai/providers/list-models/openai.test.ts
import { listOpenAiModels } from '@main/lib/ai/providers/list-models/openai'
import { afterEach, describe, expect, it, vi } from 'vitest'

describe('listOpenAiModels', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('fills every field from MODEL_METADATA_FALLBACK for a known id', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            data: [{ id: 'gpt-5.6', created: 1, owned_by: 'openai' }]
          }),
          { status: 200 }
        )
      )
    )
    const models = await listOpenAiModels({ apiKey: 'sk-test' })
    expect(models).toEqual([
      {
        id: 'gpt-5.6',
        displayName: 'gpt-5.6', // OpenAI's API has no display name — use the id
        snapshot: {
          contextWindow: 1_050_000,
          maxOutputTokens: 128_000,
          reasoningLevels: ['off', 'low', 'medium', 'high', 'xhigh'],
          cost: { input: 4, output: 20 }
        }
      }
    ])
  })

  it('never throws for an id with no fallback entry — everything nulls/empties', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            data: [
              { id: 'some-brand-new-model', created: 1, owned_by: 'openai' }
            ]
          }),
          { status: 200 }
        )
      )
    )
    const models = await listOpenAiModels({ apiKey: 'sk-test' })
    expect(models[0].snapshot).toEqual({
      contextWindow: null,
      maxOutputTokens: null,
      reasoningLevels: [],
      cost: null
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- list-models/openai`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement**

```ts
// src/main/lib/ai/providers/list-models/openai.ts
import { MODEL_METADATA_FALLBACK } from '../resolve-model'
import type { ListModelsFn, NormalizedModel } from './types'

export const listOpenAiModels: ListModelsFn = async ({ apiKey, baseUrl }) => {
  const url = `${baseUrl ?? 'https://api.openai.com/v1'}/models`
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${apiKey}` }
  })

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`OpenAI list-models failed (${response.status}): ${body}`)
  }

  const { data } = (await response.json()) as {
    data: { id: string }[]
  }

  return data.map((m): NormalizedModel => {
    const fallback = MODEL_METADATA_FALLBACK[m.id]
    return {
      id: m.id,
      displayName: m.id,
      snapshot: {
        contextWindow: fallback?.contextWindow ?? null,
        maxOutputTokens: fallback?.maxOutputTokens ?? null,
        reasoningLevels: fallback?.reasoningLevels ?? [],
        cost: fallback?.cost ?? null
      }
    }
  })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- list-models/openai`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/lib/ai/providers/list-models/openai.ts tests/unit/main/lib/ai/providers/list-models/openai.test.ts
git commit -m "feat(providers): live OpenAI model list, gap-filled from MODEL_METADATA_FALLBACK"
```

---

### Task 7: Google Gemini handler (boolean thinking → 2-level convention, cost fallback)

**Files:**

- Create: `src/main/lib/ai/providers/list-models/google.ts`
- Test: `tests/unit/main/lib/ai/providers/list-models/google.test.ts`

**Interfaces:**

- Produces: `listGoogleModels: ListModelsFn`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/main/lib/ai/providers/list-models/google.test.ts
import { listGoogleModels } from '@main/lib/ai/providers/list-models/google'
import { afterEach, describe, expect, it, vi } from 'vitest'

describe('listGoogleModels', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('strips the "models/" id prefix and maps thinking:true to the 2-level convention', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          models: [
            {
              name: 'models/gemini-3.8-flash',
              displayName: 'Gemini 3.8 Flash',
              inputTokenLimit: 1_000_000,
              outputTokenLimit: 65_536,
              thinking: true
            }
          ]
        }),
        { status: 200 }
      )
    )
    vi.stubGlobal('fetch', fetchMock)

    const models = await listGoogleModels({ apiKey: 'goog-key' })

    expect(models).toEqual([
      {
        id: 'gemini-3.8-flash',
        displayName: 'Gemini 3.8 Flash',
        snapshot: {
          contextWindow: 1_000_000,
          maxOutputTokens: 65_536,
          reasoningLevels: ['off', 'high'],
          // gemini-3.8-flash has a MODEL_METADATA_FALLBACK cost entry
          cost: { input: 0.75, output: 3.75 }
        }
      }
    ])
    const calledUrl = fetchMock.mock.calls[0][0] as string
    expect(calledUrl).toContain('key=goog-key')
  })

  it('maps thinking:false to an empty reasoningLevels array', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            models: [
              {
                name: 'models/gemini-2.5-flash',
                displayName: 'Gemini 2.5 Flash',
                inputTokenLimit: 1_000_000,
                outputTokenLimit: 8_192,
                thinking: false
              }
            ]
          }),
          { status: 200 }
        )
      )
    )
    const models = await listGoogleModels({ apiKey: 'goog-key' })
    expect(models[0].snapshot.reasoningLevels).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- list-models/google`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement**

```ts
// src/main/lib/ai/providers/list-models/google.ts
import { MODEL_METADATA_FALLBACK } from '../resolve-model'
import type { ListModelsFn, NormalizedModel } from './types'

interface GoogleModel {
  name: string
  displayName: string
  inputTokenLimit: number | null
  outputTokenLimit: number | null
  thinking?: boolean
}

export const listGoogleModels: ListModelsFn = async ({ apiKey, baseUrl }) => {
  const base = baseUrl ?? 'https://generativelanguage.googleapis.com/v1beta'
  const response = await fetch(`${base}/models?key=${apiKey}`)

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`Google list-models failed (${response.status}): ${body}`)
  }

  const { models } = (await response.json()) as { models: GoogleModel[] }

  return models.map((m): NormalizedModel => {
    const id = m.name.replace(/^models\//, '')
    const fallback = MODEL_METADATA_FALLBACK[id]
    // Gemini's `thinking` flag is boolean, not leveled — this 2-state mapping
    // is a fixed convention (spec §2), not per-model data. pi-ai's own
    // thinkingLevelMap collapses named levels to Gemini's numeric
    // thinking-budget underneath, so a 2-state choice is all the composer
    // ever needs to offer for a Gemini model.
    const reasoningLevels = m.thinking ? (['off', 'high'] as const) : []
    return {
      id,
      displayName: m.displayName,
      snapshot: {
        contextWindow: m.inputTokenLimit,
        maxOutputTokens: m.outputTokenLimit,
        reasoningLevels: [...reasoningLevels],
        cost: fallback?.cost ?? null
      }
    }
  })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- list-models/google`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/lib/ai/providers/list-models/google.ts tests/unit/main/lib/ai/providers/list-models/google.test.ts
git commit -m "feat(providers): live Google model list with boolean-thinking convention + cost fallback"
```

---

### Task 8: xAI handler (context + price live; reasoning-levels fallback; **price-unit verification required**)

**Files:**

- Create: `src/main/lib/ai/providers/list-models/xai.ts`
- Test: `tests/unit/main/lib/ai/providers/list-models/xai.test.ts`

**Interfaces:**

- Produces: `listXaiModels: ListModelsFn`.

- [ ] **Step 1: Verify the real response against a live xAI key before writing any code**

xAI's docs (checked during brainstorming) confirm the field names `context_length`, `prompt_text_token_price`, `completion_text_token_price` exist, but not their unit scale. Run, with a real xAI key:

```bash
curl -s https://api.x.ai/v1/models -H "Authorization: Bearer $XAI_API_KEY" | head -c 2000
```

Look at `prompt_text_token_price` for a known model (e.g. `grok-4.6`) and compare it to the price already in `MODEL_METADATA_FALLBACK`-adjacent numbers in the current `resolve-model.ts` history (`grok-4.6: cost.input = 2` meaning $2 per **million** tokens). If the raw API field is per-token (not per-million-tokens), it will be a tiny fractional number like `0.000002`. Confirm the divisor in Step 3 below matches what you actually see — the code below assumes **price is returned in dollars per token** and multiplies by 1,000,000 to match this codebase's "per-million-tokens" cost convention; adjust the `PER_TOKEN_TO_PER_MILLION` constant if the real response uses a different scale (e.g. already per-million, or in cents).

- [ ] **Step 2: Write the failing test** (using whatever scale Step 1 confirmed — this test assumes dollars-per-token, matching the implementation below)

```ts
// tests/unit/main/lib/ai/providers/list-models/xai.test.ts
import { listXaiModels } from '@main/lib/ai/providers/list-models/xai'
import { afterEach, describe, expect, it, vi } from 'vitest'

describe('listXaiModels', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('normalizes context_length and converts per-token price to per-million', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            data: [
              {
                id: 'grok-4.6',
                context_length: 500_000,
                prompt_text_token_price: 0.000002,
                completion_text_token_price: 0.000006
              }
            ]
          }),
          { status: 200 }
        )
      )
    )
    const models = await listXaiModels({ apiKey: 'xai-key' })
    expect(models).toEqual([
      {
        id: 'grok-4.6',
        displayName: 'grok-4.6',
        snapshot: {
          contextWindow: 500_000,
          maxOutputTokens: null,
          reasoningLevels: [], // from MODEL_METADATA_FALLBACK
          cost: { input: 2, output: 6 }
        }
      }
    ])
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm test -- list-models/xai`
Expected: FAIL — module doesn't exist.

- [ ] **Step 4: Implement**

```ts
// src/main/lib/ai/providers/list-models/xai.ts
import { MODEL_METADATA_FALLBACK } from '../resolve-model'
import type { ListModelsFn, NormalizedModel } from './types'

// Confirmed against a live response during Task 8, Step 1 — adjust here if
// xAI's field turns out to be scaled differently than dollars-per-token.
const PER_TOKEN_TO_PER_MILLION = 1_000_000

interface XaiModel {
  id: string
  context_length: number | null
  prompt_text_token_price?: number
  completion_text_token_price?: number
}

export const listXaiModels: ListModelsFn = async ({ apiKey, baseUrl }) => {
  const response = await fetch(`${baseUrl ?? 'https://api.x.ai/v1'}/models`, {
    headers: { Authorization: `Bearer ${apiKey}` }
  })

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`xAI list-models failed (${response.status}): ${body}`)
  }

  const { data } = (await response.json()) as { data: XaiModel[] }

  return data.map((m): NormalizedModel => {
    const fallback = MODEL_METADATA_FALLBACK[m.id]
    const cost =
      m.prompt_text_token_price !== undefined &&
      m.completion_text_token_price !== undefined
        ? {
            input: m.prompt_text_token_price * PER_TOKEN_TO_PER_MILLION,
            output: m.completion_text_token_price * PER_TOKEN_TO_PER_MILLION
          }
        : null
    return {
      id: m.id,
      displayName: m.id,
      snapshot: {
        contextWindow: m.context_length,
        maxOutputTokens: null, // xAI's list API doesn't report this
        reasoningLevels: fallback?.reasoningLevels ?? [],
        cost
      }
    }
  })
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm test -- list-models/xai`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/main/lib/ai/providers/list-models/xai.ts tests/unit/main/lib/ai/providers/list-models/xai.test.ts
git commit -m "feat(providers): live xAI model list with context+price, reasoning-levels fallback"
```

---

### Task 9: Ollama handler (local, no auth)

**Files:**

- Create: `src/main/lib/ai/providers/list-models/ollama.ts`
- Test: `tests/unit/main/lib/ai/providers/list-models/ollama.test.ts`

**Interfaces:**

- Produces: `listOllamaModels: ListModelsFn` (ignores `apiKey` — Ollama needs none).

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/main/lib/ai/providers/list-models/ollama.test.ts
import { listOllamaModels } from '@main/lib/ai/providers/list-models/ollama'
import { afterEach, describe, expect, it, vi } from 'vitest'

describe('listOllamaModels', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('lists local model names with no metadata', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          models: [{ name: 'llama3.1:70b' }, { name: 'mistral:7b' }]
        }),
        { status: 200 }
      )
    )
    vi.stubGlobal('fetch', fetchMock)

    const models = await listOllamaModels({
      apiKey: '',
      baseUrl: 'http://localhost:11434'
    })

    expect(models).toEqual([
      {
        id: 'llama3.1:70b',
        displayName: 'llama3.1:70b',
        snapshot: {
          contextWindow: null,
          maxOutputTokens: null,
          reasoningLevels: [],
          cost: null
        }
      },
      {
        id: 'mistral:7b',
        displayName: 'mistral:7b',
        snapshot: {
          contextWindow: null,
          maxOutputTokens: null,
          reasoningLevels: [],
          cost: null
        }
      }
    ])
    expect(fetchMock).toHaveBeenCalledWith('http://localhost:11434/api/tags')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- list-models/ollama`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement**

```ts
// src/main/lib/ai/providers/list-models/ollama.ts
import type { ListModelsFn, NormalizedModel } from './types'

export const listOllamaModels: ListModelsFn = async ({ baseUrl }) => {
  const base = baseUrl ?? 'http://localhost:11434'
  const response = await fetch(`${base}/api/tags`)

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`Ollama list-models failed (${response.status}): ${body}`)
  }

  const { models } = (await response.json()) as { models: { name: string }[] }

  return models.map((m): NormalizedModel => ({
    id: m.name,
    displayName: m.name,
    snapshot: {
      contextWindow: null,
      maxOutputTokens: null,
      reasoningLevels: [],
      cost: null
    }
  }))
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- list-models/ollama`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/lib/ai/providers/list-models/ollama.ts tests/unit/main/lib/ai/providers/list-models/ollama.test.ts
git commit -m "feat(providers): live Ollama model list via local /api/tags"
```

---

### Task 10: Azure handler (**unverified data-plane endpoint — verify first**)

**Files:**

- Create: `src/main/lib/ai/providers/list-models/azure.ts`
- Test: `tests/unit/main/lib/ai/providers/list-models/azure.test.ts`

**Interfaces:**

- Produces: `listAzureModels: ListModelsFn`.

- [ ] **Step 1: Verify the endpoint exists before writing any code**

Against a real Azure OpenAI resource:

```bash
curl -s "https://$AZURE_RESOURCE.openai.azure.com/openai/models?api-version=2024-10-21" \
  -H "api-key: $AZURE_OPENAI_API_KEY" | head -c 2000
```

- **If this returns a 200 with a `data` array of deployed models:** note the exact field names for id/context/max-tokens (they may differ from OpenAI's own shape) and adjust Step 3 below to match before writing the test.
- **If this 404s or errors:** the data-plane models endpoint isn't available on this resource/API version. In that case, skip this task's handler entirely — instead, in Task 12 (Settings UI), the Azure tab keeps a plain free-text `Input` for the model field (same treatment as the Ollama free-text fallback in the spec) rather than a `ModelPicker` dropdown, and this task is done with no new file. Record which outcome occurred in the commit message either way.

- [ ] **Step 2: Write the failing test** (adjust field names to match what Step 1 actually returned)

```ts
// tests/unit/main/lib/ai/providers/list-models/azure.test.ts
import { listAzureModels } from '@main/lib/ai/providers/list-models/azure'
import { afterEach, describe, expect, it, vi } from 'vitest'

describe('listAzureModels', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('lists deployed models using the api-key header', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: [{ id: 'gpt-5.6' }] }), {
        status: 200
      })
    )
    vi.stubGlobal('fetch', fetchMock)

    const models = await listAzureModels({
      apiKey: 'azure-key',
      baseUrl: 'https://my-resource.openai.azure.com',
      apiVersion: '2024-10-21'
    })

    expect(models).toEqual([
      {
        id: 'gpt-5.6',
        displayName: 'gpt-5.6',
        snapshot: {
          contextWindow: null,
          maxOutputTokens: null,
          reasoningLevels: [],
          cost: null
        }
      }
    ])
    expect(fetchMock).toHaveBeenCalledWith(
      'https://my-resource.openai.azure.com/openai/models?api-version=2024-10-21',
      expect.objectContaining({ headers: { 'api-key': 'azure-key' } })
    )
  })
})
```

- [ ] **Step 3: Implement** (only if Step 1 confirmed the endpoint works)

```ts
// src/main/lib/ai/providers/list-models/azure.ts
import { MODEL_METADATA_FALLBACK } from '../resolve-model'
import type { ListModelsFn, NormalizedModel } from './types'

export const listAzureModels: ListModelsFn = async ({
  apiKey,
  baseUrl,
  apiVersion
}) => {
  const url = `${baseUrl}/openai/models?api-version=${apiVersion}`
  const response = await fetch(url, { headers: { 'api-key': apiKey } })

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`Azure list-models failed (${response.status}): ${body}`)
  }

  const { data } = (await response.json()) as { data: { id: string }[] }

  return data.map((m): NormalizedModel => {
    const fallback = MODEL_METADATA_FALLBACK[m.id]
    return {
      id: m.id,
      displayName: m.id,
      snapshot: {
        contextWindow: fallback?.contextWindow ?? null,
        maxOutputTokens: fallback?.maxOutputTokens ?? null,
        reasoningLevels: fallback?.reasoningLevels ?? [],
        cost: fallback?.cost ?? null
      }
    }
  })
}
```

- [ ] **Step 4: Run test to verify it passes** (skip if Step 1 concluded the endpoint isn't available — see Task 12 note)

Run: `pnpm test -- list-models/azure`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/lib/ai/providers/list-models/azure.ts tests/unit/main/lib/ai/providers/list-models/azure.test.ts
git commit -m "feat(providers): live Azure model list via data-plane /openai/models"
```

(If Step 1 concluded the endpoint isn't available, commit a one-line note in `docs/superpowers/specs/2026-09-12-dynamic-model-catalog-design.md`'s Non-goals section instead: "Azure's data-plane models endpoint is unavailable on \[api-version tested] — Azure keeps free-text model entry," and skip straight to Task 11.)

---

### Task 11: The route — `POST /api/settings/models`

**Files:**

- Create: `src/main/lib/ai/providers/list-models/index.ts`
- Modify: `src/main/lib/server/routes/settings.ts`
- Modify: `src/main/lib/server/schemas/settings.ts`
- Test: `tests/api/settings-models.spec.ts`

**Interfaces:**

- Consumes: all six `list<Provider>Models` functions (Tasks 5-10).
- Produces: `POST /api/settings/models` — consumed by Task 12's `ModelPicker`.

- [ ] **Step 1: Write the dispatch map**

Typed as `Partial<Record<...>>`, not `Record<...>` — deliberately, so this compiles regardless of which outcome Task 10 landed on (a full `Record` would force every `AiProviders` key to be present, including Azure even if Task 10 concluded there's no live endpoint for it).

```ts
// src/main/lib/ai/providers/list-models/index.ts
import { AiProviders } from '@shared/types/ai'

import { listAnthropicModels } from './anthropic'
import { listGoogleModels } from './google'
import { listOllamaModels } from './ollama'
import { listOpenAiModels } from './openai'
import type { ListModelsFn } from './types'
import { listXaiModels } from './xai'

export const listModelsByProvider: Partial<Record<AiProviders, ListModelsFn>> =
  {
    [AiProviders.OpenAiGpt]: listOpenAiModels,
    [AiProviders.AnthropicClaude]: listAnthropicModels,
    [AiProviders.GoogleGemini]: listGoogleModels,
    [AiProviders.XaiGrok]: listXaiModels,
    [AiProviders.Ollama]: listOllamaModels
  }

export type { ListModelsArgs, NormalizedModel } from './types'
```

If Task 10 did implement a working Azure handler, add both the import and the `[AiProviders.AzureOpenAi]: listAzureModels` entry above.

- [ ] **Step 2: Add the request schema**

In `src/main/lib/server/schemas/settings.ts`, alongside the existing `updateSettingsSchema`:

```ts
import { AiProviders } from '@shared/types/ai'

export const listModelsRequestSchema = z.object({
  provider: z.enum(AiProviders),
  apiKey: z.string().optional(),
  baseUrl: z.string().optional(),
  apiVersion: z.string().optional()
})
```

(Check the file's existing import line for `z` — it should already import `z` from `'zod'` for `updateSettingsSchema`'s neighbors; add the `AiProviders` import as a new line above it.)

- [ ] **Step 3: Add the route**

In `src/main/lib/server/routes/settings.ts`, add near the other `POST` handlers (after the `/full-text-search/reindex` block, before `export default settingsRouter`):

```ts
settingsRouter.post('/models', async (c) => {
  const { provider, apiKey, baseUrl, apiVersion } = validateSchema(
    listModelsRequestSchema,
    await c.req.json(),
    'Invalid model-list request'
  )

  const listFn = listModelsByProvider[provider]
  if (!listFn) {
    throw new ValidationError(
      ErrorCode.VALIDATION_FAILED,
      'Live model listing is not available for this provider'
    )
  }
  if (provider !== AiProviders.Ollama && !apiKey) {
    throw new ValidationError(
      ErrorCode.VALIDATION_FAILED,
      'API key is required'
    )
  }

  try {
    const models = await listFn({
      apiKey: apiKey ?? '',
      baseUrl,
      apiVersion
    })
    return successResponse(c, { models })
  } catch (error) {
    throw new ValidationError(
      ErrorCode.VALIDATION_FAILED,
      error instanceof Error ? error.message : 'Failed to fetch model list'
    )
  }
})
```

Add the new imports at the top of the file:

```ts
import { AiProviders } from '@shared/types/ai'

import { listModelsByProvider } from '../../ai/providers/list-models'
import {
  listModelsRequestSchema,
  updateSettingsSchema
} from '../schemas/settings'
```

(`updateSettingsSchema` is already imported today — fold `listModelsRequestSchema` into that same import line rather than adding a duplicate.)

- [ ] **Step 4: Write the Playwright API test**

```ts
// tests/api/settings-models.spec.ts
/**
 * API integration tests for /api/settings/models
 */
import { apiTest as test, expect } from '../fixtures/api-client'

test.describe('POST /api/settings/models', () => {
  test('rejects an unknown provider', async ({ api }) => {
    const { status } = await api.post('/api/settings/models', {
      provider: 'not-a-real-provider'
    })
    expect(status).toBe(400)
  })

  test('rejects a missing API key for a non-Ollama provider', async ({
    api
  }) => {
    const { status } = await api.post('/api/settings/models', {
      provider: 'OpenAI GPT'
    })
    expect(status).toBe(400)
  })
})
```

(`ApiClient.post<T>(path, body)` — from `tests/fixtures/api-client.ts`, already read during planning — returns `{ status: number; data: T }`, matching the existing `tests/api/settings.spec.ts`'s style exactly.)

- [ ] **Step 5: Run the test**

Run: `pnpm exec playwright test tests/api/settings-models.spec.ts` (check `package.json`'s `test:api`-style script name and use that if one exists; the project's Playwright config in `playwright.config.ts` determines whether this needs the app already running on port 60223 — check how `tests/api/settings.spec.ts` is normally invoked in CI/local docs before running)
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/main/lib/ai/providers/list-models/index.ts src/main/lib/server/routes/settings.ts src/main/lib/server/schemas/settings.ts tests/api/settings-models.spec.ts
git commit -m "feat(settings): POST /api/settings/models dispatches to per-provider live fetch"
```

---

## Phase 3 — Settings UI

### Task 12: `ModelPicker` shared component; wire into the OpenAI tab

**Files:**

- Create: `src/renderer/components/settings/settings-form/providers/model-picker.tsx`
- Modify: `src/renderer/components/settings/settings-form/providers/openai-gpt.tsx`
- Modify: `src/shared/constants/test-ids.ts`
- Test: `tests/e2e/settings-model-picker.spec.ts` (Playwright Electron E2E, matching `tests/e2e/` convention)

**Interfaces:**

- Consumes: `POST /api/settings/models` (Task 11), `ModelSnapshot`/`EffortLevel` (Task 1), `SettingsSelect` (existing).
- Produces: `<ModelPicker provider={AiProviders} form={form} apiKeyField={FieldPath} baseUrlField={FieldPath} />` — Task 13 wires this same component into the other 5 tabs.

- [ ] **Step 1: Add the two new TEST_IDS entries**

In `src/shared/constants/test-ids.ts`, add a new top-level group (alongside `settings`, `logger`, etc.):

```ts
  providerModels: {
    refreshButton: 'provider-models.refresh-button',
    modelSelect: 'provider-models.model-select'
  },
```

- [ ] **Step 2: Implement the component**

```tsx
import { TEST_IDS } from '@shared/constants/test-ids'
// src/renderer/components/settings/settings-form/providers/model-picker.tsx
import {
  ModelSnapshot,
  UseFormReturnType
} from '@shared/schemas/settings-schema'
import { AiProviders } from '@shared/types/ai'
import { getHttpErrorMessage } from '@shared/utils/http'
import { fetcher } from '@shared/utils/http'
import { useState } from 'react'
import { FieldPath } from 'react-hook-form'
import { sileo } from 'sileo'

import { Button } from '@/components/ui/button'

import { SettingsRow, SettingsSection } from '../../settings-row'
import { SettingsSelect } from '../../settings-select'

interface FetchedModel {
  id: string
  displayName: string
  snapshot: ModelSnapshot
}

interface ModelPickerProps {
  provider: AiProviders
  form: UseFormReturnType
  apiKeyField: FieldPath<Parameters<UseFormReturnType['watch']>[0]>
  baseUrlField?: FieldPath<Parameters<UseFormReturnType['watch']>[0]>
  /** Azure only — `providers.azureOpenAiApiVersion`. */
  apiVersionField?: FieldPath<Parameters<UseFormReturnType['watch']>[0]>
}

/** Warning shown when the saved model isn't in the freshest fetched list. */
function staleWarning(
  fetched: FetchedModel[] | null,
  savedId: string | null | undefined
): string | undefined {
  if (!fetched || !savedId) return undefined
  if (fetched.some((m) => m.id === savedId)) return undefined
  return `"${savedId}" is no longer offered by this provider — pick a current model.`
}

export function ModelPicker({
  provider,
  form,
  apiKeyField,
  baseUrlField,
  apiVersionField
}: ModelPickerProps) {
  const [fetched, setFetched] = useState<FetchedModel[] | null>(null)
  const [loading, setLoading] = useState(false)

  const apiKey = form.watch(apiKeyField) as string | undefined
  const baseUrl = baseUrlField
    ? (form.watch(baseUrlField) as string | undefined)
    : undefined
  const apiVersion = apiVersionField
    ? (form.watch(apiVersionField) as string | undefined)
    : undefined
  const activeProvider = form.watch('providerConfig.provider')
  const savedModel =
    activeProvider === provider
      ? (form.watch('providerConfig.model') as string | undefined)
      : undefined

  const options =
    fetched?.map((m) => ({ value: m.id, label: m.displayName })) ??
    (savedModel ? [{ value: savedModel, label: savedModel }] : [])

  const handleRefresh = async () => {
    setLoading(true)
    try {
      const { models } = await fetcher<{ models: FetchedModel[] }>(
        '/api/settings/models',
        {
          method: 'POST',
          body: { provider, apiKey, baseUrl, apiVersion }
        }
      )
      setFetched(models)
    } catch (error) {
      sileo.error({
        title: 'Could not fetch model list',
        description: getHttpErrorMessage(error) ?? 'Failed to fetch model list'
      })
    } finally {
      setLoading(false)
    }
  }

  const handleSelect = (id: string) => {
    const model = fetched?.find((m) => m.id === id)
    form.setValue('providerConfig.model', id, { shouldDirty: true })
    form.setValue('providerConfig.modelSnapshot', model?.snapshot ?? null, {
      shouldDirty: true
    })
  }

  return (
    <SettingsSection>
      <SettingsRow label="Model" description="The model used for this provider">
        <div className="flex items-center gap-2">
          <SettingsSelect
            testId={TEST_IDS.providerModels.modelSelect}
            disabled={options.length === 0}
            value={activeProvider === provider ? (savedModel ?? '') : ''}
            onValueChange={handleSelect}
            options={options}
            placeholder={
              fetched
                ? 'Select a model'
                : savedModel
                  ? undefined
                  : 'Click refresh to load models'
            }
          />
          <Button
            type="button"
            variant="outline"
            data-testid={TEST_IDS.providerModels.refreshButton}
            disabled={!apiKey || loading}
            onClick={handleRefresh}
          >
            {loading ? 'Refreshing…' : 'Refresh model list'}
          </Button>
        </div>
        {!fetched && savedModel && (
          <p className="text-muted-foreground text-xs">
            Refresh to see all available models.
          </p>
        )}
        {staleWarning(fetched, savedModel) && (
          <p className="text-destructive text-xs">
            {staleWarning(fetched, savedModel)}
          </p>
        )}
      </SettingsRow>
    </SettingsSection>
  )
}
```

- [ ] **Step 3: Wire into the OpenAI tab**

```tsx
// src/renderer/components/settings/settings-form/providers/openai-gpt.tsx
import { UseFormReturnType } from '@shared/schemas/settings-schema'
import { AiProviders } from '@shared/types/ai'

import { ModelPicker } from './model-picker'
import { ProviderFields } from './provider-fields'

export function OpenAiGpt({ form }: { form: UseFormReturnType }) {
  return (
    <>
      <ProviderFields
        form={form}
        fields={[
          {
            name: 'providers.openaiApiKey',
            label: 'API Key',
            description: 'Your OpenAI API key',
            placeholder: 'sk-...',
            type: 'password'
          },
          {
            name: 'providers.openaiBaseUrl',
            label: 'Base URL',
            description: 'Custom API endpoint. Leave empty for default',
            placeholder: 'https://api.openai.com/v1'
          }
        ]}
      />
      <ModelPicker
        provider={AiProviders.OpenAiGpt}
        form={form}
        apiKeyField="providers.openaiApiKey"
        baseUrlField="providers.openaiBaseUrl"
      />
    </>
  )
}
```

- [ ] **Step 4: Write the E2E test**

Reuses the exact `openSettings` navigation helper already defined in `tests/e2e/settings-e2e.spec.ts` (read during planning) — copy it verbatim rather than re-deriving selectors, since that file is the established, working reference for reaching the Settings page in this app.

```ts
// tests/e2e/settings-model-picker.spec.ts
import { TEST_IDS } from '../../src/shared/constants/test-ids'
import { electronTest as test, expect } from '../fixtures/electron'

async function openSettings(mainWindow: import('@playwright/test').Page) {
  const settingsLink = mainWindow.locator(
    '[data-testid="nav-settings"], a[href*="settings"], button:has-text("Settings")'
  )
  if (
    await settingsLink
      .first()
      .isVisible({ timeout: 5_000 })
      .catch(() => false)
  ) {
    await settingsLink.first().click()
    await mainWindow.waitForTimeout(1_000)
  }
}

test.describe('Settings model picker', () => {
  test('refresh button is disabled until an API key is entered', async ({
    mainWindow
  }) => {
    await openSettings(mainWindow)
    await mainWindow.getByRole('tab', { name: 'OpenAI' }).click()

    const refreshButton = mainWindow.getByTestId(
      TEST_IDS.providerModels.refreshButton
    )
    await refreshButton.waitFor({ state: 'visible', timeout: 10_000 })
    await expect(refreshButton).toBeDisabled()

    await mainWindow.getByPlaceholder('sk-...').fill('sk-test-key-not-real')
    await expect(refreshButton).toBeEnabled()
  })
})
```

The `sk-...` placeholder comes straight from `openai-gpt.tsx`'s existing field config (read during planning) — if Task 13 hasn't run yet in your working tree when you write this test, confirm that placeholder string is still exactly `'sk-...'` before relying on it.

- [ ] **Step 5: Run the tests**

Run: `pnpm exec playwright test tests/e2e/settings-model-picker.spec.ts` (this requires a built app at `out/main/index.js` per `tests/fixtures/electron.ts` — run `pnpm build:unpack` first if it's stale)
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/renderer/components/settings/settings-form/providers/model-picker.tsx src/renderer/components/settings/settings-form/providers/openai-gpt.tsx src/shared/constants/test-ids.ts tests/e2e/settings-model-picker.spec.ts
git commit -m "feat(settings): ModelPicker component with live refresh, wired into the OpenAI tab"
```

---

### Task 13: Wire `ModelPicker` into the remaining 5 provider tabs; shrink top-level `ProviderConfig`

**Files:**

- Modify: `src/renderer/components/settings/settings-form/providers/azure-openai.tsx`
- Modify: `src/renderer/components/settings/settings-form/providers/anthropic-claude.tsx`
- Modify: `src/renderer/components/settings/settings-form/providers/google-gemini.tsx`
- Modify: `src/renderer/components/settings/settings-form/providers/xai-grok.tsx`
- Modify: `src/renderer/components/settings/settings-form/providers/ollama.tsx`
- Modify: `src/renderer/components/settings/settings-form/provider-config.tsx` (whole file)
- Modify: `tests/api/settings.spec.ts` (schema rename)
- Delete (conditionally — see Step 3): `src/shared/constants/models.ts`, `tests/unit/shared/constants/models.test.ts`

**Interfaces:**

- Consumes: `<ModelPicker />` from Task 12.

- [ ] **Step 1: Read each of the 5 tab files to get their exact current field names**

Each mirrors `openai-gpt.tsx`'s `<ProviderFields fields={[...]} />` pattern with different `name`/`label`/`placeholder` values for that provider's key/base-URL settings fields (`providers.azureOpenaiApiKey` + `providers.azureOpenAiEndpoint`, `providers.anthropicApiKey` + `providers.anthropicBaseUrl`, `providers.googleGeminiApiKey` + `providers.googleGeminiBaseUrl`, `providers.xAiApiKey` + `providers.xAiBaseUrl` — confirmed field names from `ProvidersSchema` in Task 1's file). `ollama.tsx` is structurally different (no API key, just `providers.ollamaBaseUrl` + a status indicator, see the file already read during planning).

- [ ] **Step 2: Add `<ModelPicker />` after each tab's fields**

For `azure-openai.tsx`, `anthropic-claude.tsx`, `google-gemini.tsx`, `xai-grok.tsx`: apply the exact same pattern as Task 12 Step 3, changing only the `provider` prop and the two field-name props:

```tsx
<ModelPicker
  provider={AiProviders.AzureOpenAi}
  form={form}
  apiKeyField="providers.azureOpenaiApiKey"
  baseUrlField="providers.azureOpenAiEndpoint"
  apiVersionField="providers.azureOpenAiApiVersion"
/>
```

```tsx
<ModelPicker
  provider={AiProviders.AnthropicClaude}
  form={form}
  apiKeyField="providers.anthropicApiKey"
  baseUrlField="providers.anthropicBaseUrl"
/>
```

```tsx
<ModelPicker
  provider={AiProviders.GoogleGemini}
  form={form}
  apiKeyField="providers.googleGeminiApiKey"
  baseUrlField="providers.googleGeminiBaseUrl"
/>
```

```tsx
<ModelPicker
  provider={AiProviders.XaiGrok}
  form={form}
  apiKeyField="providers.xAiApiKey"
  baseUrlField="providers.xAiBaseUrl"
/>
```

**If Task 10 concluded Azure's live endpoint doesn't exist:** skip the Azure `<ModelPicker />` above entirely, and instead add a plain free-text field to `azure-openai.tsx`'s existing `<ProviderFields fields={[...]}>` array:

```ts
{
  name: 'providerConfig.model',
  label: 'Model',
  description: 'The Azure deployment name to use',
  placeholder: 'gpt-5.6'
}
```

For `ollama.tsx`, add after the existing `Status` row, inside the same `<SettingsSection>`:

```tsx
<ModelPicker
  provider={AiProviders.Ollama}
  form={form}
  apiKeyField="providers.ollamaBaseUrl" // unused by listOllamaModels, but ModelPicker's disabled-until-truthy check needs *some* field; ollamaBaseUrl serves the same "is this configured yet" role an API key does elsewhere
  baseUrlField="providers.ollamaBaseUrl"
/>
```

- [ ] **Step 3: Shrink `ProviderConfig` to just the Provider select**

Replace `src/renderer/components/settings/settings-form/provider-config.tsx` in full:

```tsx
import { UseFormReturnType } from '@shared/schemas/settings-schema'
import { AiProviders } from '@shared/types/ai'
import { Controller } from 'react-hook-form'

import { SettingsRow, SettingsSection } from '../settings-row'
import { SettingsSelect } from '../settings-select'

const providerOptions = Object.values(AiProviders).map((val) => ({
  value: val,
  label: val
}))

export function ProviderConfig({ form }: { form: UseFormReturnType }) {
  return (
    <SettingsSection>
      <Controller
        control={form.control}
        name="providerConfig.provider"
        render={({ field, fieldState }) => (
          <SettingsRow
            label="Provider"
            description="The AI provider to use for chat"
            error={fieldState.error}
          >
            <SettingsSelect
              value={field.value ?? ''}
              onValueChange={(value) => {
                field.onChange(value)
                form.setValue('providerConfig.model', '')
                form.setValue('providerConfig.modelSnapshot', null)
              }}
              options={providerOptions}
              placeholder="Select a provider"
            />
          </SettingsRow>
        )}
      />
    </SettingsSection>
  )
}
```

The per-provider `staleModelWarning` logic that used to live here moved into `ModelPicker`'s `staleWarning` (Task 12) — it's now checked against the live-fetched list instead of the hardcoded `models` constant, so `@shared/constants/models` and its `isCurrentModel`/`ModelRole` exports should have no remaining importers by this point (Task 4 already dropped `model-util.ts`'s import when it rewrote that file). Confirm with:

```bash
grep -rln "constants/models'" src/ tests/
```

This should return only two files: this one (`provider-config.tsx`, being fixed in this very step) and `tests/unit/shared/constants/models.test.ts` (a test file that exclusively tests `isCurrentModel`/`models` from the file about to be deleted — it has nothing left to test once the source file is gone). If it returns anything else, stop and investigate before deleting — something still depends on the file. Otherwise, delete both `src/shared/constants/models.ts` and `tests/unit/shared/constants/models.test.ts` in this step, and re-run the grep to confirm zero remaining references anywhere in the repo.

- [ ] **Step 4: Fix the existing Settings API test that asserts the old field names**

`tests/api/settings.spec.ts:13-28` (read during planning) posts `providerConfig: { provider, chatModel, reasoningModel }` and asserts `config.chatModel`. Replace that test:

```ts
test('POST /api/settings updates provider config', async ({ api }) => {
  const { status } = await api.updateSettings({
    providerConfig: {
      provider: 'openai',
      model: 'gpt-4.1-mini',
      modelSnapshot: {
        contextWindow: 1_047_576,
        maxOutputTokens: 32_768,
        reasoningLevels: [],
        cost: { input: 0.4, output: 1.6 }
      }
    }
  })
  expect(status).toBe(200)

  // Verify persistence
  const { data } = await api.getSettings()
  const config = data.providerConfig as Record<string, unknown>
  expect(config.provider).toBe('openai')
  expect(config.model).toBe('gpt-4.1-mini')
})
```

- [ ] **Step 5: Run typecheck across renderer + node**

Run: `pnpm typecheck`
Expected: FAIL only on files not yet touched (chat.ts, composer, the 9 non-chat.ts call sites, `AdvancedTools` enum, the 3 `advancedTools: ['Reasoning']` spec files fixed in Task 14) — no errors remaining in any Settings file or `tests/api/settings.spec.ts`.

- [ ] **Step 6: Run the fixed test**

Run: `pnpm exec playwright test tests/api/settings.spec.ts`
Expected: PASS

- [ ] **Step 7: Manually verify in the running app**

Run: `pnpm dev`, open Settings → Providers, click through all 6 provider tabs, confirm each shows a Model row with a Refresh button, and that switching the top-level Provider select clears the model field on the newly-selected tab.

- [ ] **Step 8: Commit**

```bash
git add -A src/renderer/components/settings/settings-form/providers/ src/renderer/components/settings/settings-form/provider-config.tsx tests/api/settings.spec.ts src/shared/constants/models.ts tests/unit/shared/constants/models.test.ts
git commit -m "feat(settings): wire ModelPicker into all provider tabs; shrink ProviderConfig to just Provider select"
```

(`git add -A` on those paths picks up the deletion cleanly whether or not Step 3 actually deleted `models.ts`/`models.test.ts` — if they weren't deleted, `-A` on an unchanged path is a no-op.)

---

## Phase 4 — Composer effort picker, chat.ts wiring, remaining call sites

### Task 14: `AdvancedTools` enum, request schema, and the composer's effort atom

**Files:**

- Modify: `src/shared/types/ai.ts:12-15`
- Modify: `src/main/lib/server/schemas/chat.ts`
- Modify: `src/renderer/stores/chat.ts`
- Modify: `tests/unit/main/lib/server/schemas/chat.test.ts` (already exists — appending a new `describe` block)
- Modify: `tests/fixtures/api-client.ts` (`sendChatMessage` gains a `reasoningEffort` passthrough)
- Modify: `tests/api/chat-claude.spec.ts:74`, `tests/providers/openai.spec.ts:89`, `tests/providers/claude.spec.ts:91`

**Interfaces:**

- Produces: `AdvancedTools` (DeepResearch only), `postRequestBodySchema` with `reasoningEffort?: EffortLevel`, `reasoningEffortAtom` (Jotai, renderer) — Task 15 (composer UI) and Task 16 (chat.ts) both consume these.

- [ ] **Step 1: Write the failing schema test**

`tests/unit/main/lib/server/schemas/chat.test.ts` already exists (read during planning) with a `describe('postRequestBodySchema — message passthrough', ...)` block using `.parse()`/`toThrow()` and a shared `CHAT_ID` constant. Append a new block matching that style, after the existing one:

```ts
describe('postRequestBodySchema — reasoningEffort', () => {
  it('accepts a request with no reasoningEffort', () => {
    const parsed = postRequestBodySchema.parse({
      id: CHAT_ID,
      advancedTools: [],
      messages: []
    })
    expect(parsed.reasoningEffort).toBeUndefined()
  })

  it('accepts every valid effort level', () => {
    for (const level of ['off', 'low', 'medium', 'high', 'xhigh', 'max']) {
      const parsed = postRequestBodySchema.parse({
        id: CHAT_ID,
        advancedTools: [],
        messages: [],
        reasoningEffort: level
      })
      expect(parsed.reasoningEffort, level).toBe(level)
    }
  })

  it('rejects an invalid effort level', () => {
    expect(() =>
      postRequestBodySchema.parse({
        id: CHAT_ID,
        advancedTools: [],
        messages: [],
        reasoningEffort: 'ultra'
      })
    ).toThrow()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- chat.test`
Expected: FAIL — `reasoningEffort` isn't accepted/validated by `postRequestBodySchema` yet.

- [ ] **Step 3: Implement the enum + schema changes**

In `src/shared/types/ai.ts`, replace lines 12-15:

```ts
export enum AdvancedTools {
  DeepResearch = 'Deep Research'
}
```

In `src/main/lib/server/schemas/chat.ts`, add the import and field:

```ts
import { EffortLevelSchema } from '@shared/schemas/settings-schema'
```

```ts
export const postRequestBodySchema = z.object({
  id: z.uuid('v4'),
  message: userMessageSchema.optional(),
  messages: z.array(messageSchema),
  advancedTools: z.array(z.enum(AdvancedTools)),
  reasoningEffort: EffortLevelSchema.optional(),
  projectId: z.string().uuid().optional()
})
```

- [ ] **Step 4: Add the renderer-side atom**

In `src/renderer/stores/chat.ts`, alongside the existing `advancedToolsAtom` (add the import for `EffortLevel` at the top of the file):

```ts
import type { EffortLevel } from '@shared/schemas/settings-schema'
```

```ts
export const reasoningEffortAtom = atom<EffortLevel>('off')
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm test -- chat.test`
Expected: PASS

- [ ] **Step 6: Fix the 3 existing specs that use `advancedTools: ['Reasoning']`**

Removing `AdvancedTools.Reasoning` breaks three existing provider/chat tests that exercise reasoning mode via the now-gone enum value. First extend the shared fixture so they can express the same intent with the new field — in `tests/fixtures/api-client.ts`, add `reasoningEffort` to `sendChatMessage`'s options and forward it in the request body:

```ts
  async sendChatMessage(opts: {
    chatId: string
    text: string
    advancedTools?: string[]
    reasoningEffort?: string
    projectId?: string
    signal?: AbortSignal
  }) {
    const userMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: opts.text
    }

    const res = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: opts.chatId,
        messages: [userMessage],
        advancedTools: opts.advancedTools ?? [],
        reasoningEffort: opts.reasoningEffort,
        projectId: opts.projectId
      }),
      signal: opts.signal
    })

    return this.consumeSseStream(res)
  }
```

Then in each of the three spec files, replace `advancedTools: ['Reasoning']` with `advancedTools: [], reasoningEffort: 'high'`:

- `tests/api/chat-claude.spec.ts:74` (test `'reasoning mode with Claude'`)
- `tests/providers/openai.spec.ts:89` (test `'reasoning mode (o4-mini)'`)
- `tests/providers/claude.spec.ts:91` (test `'reasoning mode (extended thinking)'`)

Each is a single-line change inside an existing `api.sendChatMessage({ ... })` call — the rest of each test (assertions on the response text) is unaffected.

- [ ] **Step 7: Run the three fixed specs**

Run: `pnpm exec playwright test tests/api/chat-claude.spec.ts tests/providers/openai.spec.ts tests/providers/claude.spec.ts` (these hit real provider APIs — only run with real keys configured, same as their pre-existing requirement)
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add src/shared/types/ai.ts src/main/lib/server/schemas/chat.ts src/renderer/stores/chat.ts tests/unit/main/lib/server/schemas/chat.test.ts tests/fixtures/api-client.ts tests/api/chat-claude.spec.ts tests/providers/openai.spec.ts tests/providers/claude.spec.ts
git commit -m "feat(chat): reasoningEffort replaces the binary Reasoning advanced-tool"
```

---

### Task 15: Composer — replace the binary toggle with a full effort-level picker

**Files:**

- Modify: `src/renderer/components/composer-tools.tsx` (whole file)
- Modify: `src/renderer/components/chat.tsx:92-98` (`prepareBody`)
- Modify: `src/shared/constants/test-ids.ts`
- Test: `tests/e2e/composer-reasoning-effort.spec.ts`

**Interfaces:**

- Consumes: `reasoningEffortAtom` (Task 14), `providerConfig.modelSnapshot.reasoningLevels` (persisted by Task 12/13's `ModelPicker`).
- Produces: the composer now sends `reasoningEffort` in the chat POST body — Task 16 (chat.ts) reads it.

- [ ] **Step 1: Add the TEST_IDS entries**

In `src/shared/constants/test-ids.ts`, add a new `composer` group:

```ts
  composer: {
    reasoningEffortItem: 'composer.reasoning-effort-item',
    reasoningEffortLevel: 'composer.reasoning-effort-level'
  },
```

- [ ] **Step 2: Implement the composer changes**

Replace `src/renderer/components/composer-tools.tsx` in full — the diff from the current version: `TOGGLES` drops the `Reasoning` entry (leaving only `DeepResearch`); a new `EFFORT_LEVELS` list and a `useReasoningEffort` hook are added; the dropdown menu gains a `DropdownMenuSub` for effort levels; `ActiveToolPills` gains a pill for the active effort level.

```tsx
import { TEST_IDS } from '@shared/constants/test-ids'
import type { EffortLevel } from '@shared/schemas/settings-schema'
import { AdvancedTools as AdvancedToolsType } from '@shared/types/ai'
import { produce } from 'immer'
import { useAtom, useAtomValue } from 'jotai'
import {
  BrainIcon,
  HammerIcon,
  PaperclipIcon,
  PlusIcon,
  TelescopeIcon,
  XIcon
} from 'lucide-react'
import { ChangeEvent, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import useSWR from 'swr'

import Markdown from '@/components/markdown'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { useSettings } from '@/hooks/use-settings'
import { useUpload } from '@/hooks/use-upload'
import { cn } from '@/lib/utils'
import { advancedToolsAtom, reasoningEffortAtom } from '@/stores/chat'

interface McpToolInfo {
  name: string
  description: string
}
interface McpToolsGroup {
  mcpServerName: string
  tools: McpToolInfo[]
}

const TOGGLES = [
  {
    key: AdvancedToolsType.DeepResearch,
    label: 'Deep research',
    icon: TelescopeIcon
  }
] as const

const EFFORT_LEVELS: { value: EffortLevel; label: string }[] = [
  { value: 'off', label: 'Off' },
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'xhigh', label: 'Extra high' },
  { value: 'max', label: 'Max' }
]

function useAdvancedToolToggle() {
  const [advancedTools, setAdvancedTools] = useAtom(advancedToolsAtom)
  const [reasoningEffort, setReasoningEffort] = useAtom(reasoningEffortAtom)

  const toggle = (name: AdvancedToolsType) =>
    setAdvancedTools(
      produce((draft) => {
        const idx = draft.indexOf(name)
        if (idx > -1) {
          draft.splice(idx, 1)
          return
        }
        draft.push(name)
        // Deep Research and reasoning effort are mutually exclusive.
        if (name === AdvancedToolsType.DeepResearch) setReasoningEffort('off')
      })
    )

  const setEffort = (level: EffortLevel) => {
    setReasoningEffort(level)
    // Picking a non-off effort turns off Deep Research, same mutual exclusion
    // as before, just from the other direction.
    if (level !== 'off') {
      setAdvancedTools(
        produce((draft) => {
          const idx = draft.indexOf(AdvancedToolsType.DeepResearch)
          if (idx > -1) draft.splice(idx, 1)
        })
      )
    }
  }

  return { advancedTools, toggle, reasoningEffort, setEffort }
}

/** Levels the currently-selected model actually supports, off first. */
function useAvailableEffortLevels(): typeof EFFORT_LEVELS {
  const { data: settings } = useSettings()
  const supported = settings?.providerConfig?.modelSnapshot?.reasoningLevels
  return useMemo(
    () =>
      supported && supported.length > 0
        ? EFFORT_LEVELS.filter((l) => supported.includes(l.value))
        : [],
    [supported]
  )
}

/** The composer's `+` button: attachments, reasoning effort/deep-research, MCP tools. */
export function ComposerToolsButton() {
  const { t } = useTranslation('common')
  const { uploadFile } = useUpload()
  const fileRef = useRef<HTMLInputElement>(null)
  const { advancedTools, toggle, reasoningEffort, setEffort } =
    useAdvancedToolToggle()
  const availableEffortLevels = useAvailableEffortLevels()
  const [mcpOpen, setMcpOpen] = useState(false)

  const { data } = useSWR<{ tools: McpToolsGroup[] }>('/api/mcp/tools')
  const mcpCount = useMemo(
    () => data?.tools?.reduce((acc, g) => acc + g.tools.length, 0) ?? 0,
    [data?.tools]
  )

  const handleFiles = (event: ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files
    if (!files) return
    uploadFile([...files], () => {
      if (fileRef.current) fileRef.current.value = ''
    })
  }

  const hasActiveTool = advancedTools.length > 0 || reasoningEffort !== 'off'

  return (
    <>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        multiple
        aria-hidden="true"
        tabIndex={-1}
        className="hidden"
        onChange={handleFiles}
      />
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label={t('action.add')}
          className={cn(
            'text-muted-foreground hover:bg-muted hover:text-foreground data-popup-open:bg-muted flex size-8 shrink-0 items-center justify-center rounded-full transition-colors [&_svg]:size-[18px]',
            hasActiveTool && 'text-[#0285ff] dark:text-[#48aaff]'
          )}
        >
          <PlusIcon />
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          side="top"
          className="w-52 rounded-xl"
        >
          <DropdownMenuItem
            onClick={() => setTimeout(() => fileRef.current?.click(), 0)}
          >
            <PaperclipIcon />
            Attach files
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          {availableEffortLevels.length > 0 && (
            <DropdownMenuSub>
              <DropdownMenuSubTrigger
                data-testid={TEST_IDS.composer.reasoningEffortItem}
              >
                <BrainIcon />
                Reasoning
                {reasoningEffort !== 'off' && (
                  <span className="text-muted-foreground ml-auto text-xs">
                    {
                      EFFORT_LEVELS.find((l) => l.value === reasoningEffort)
                        ?.label
                    }
                  </span>
                )}
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuRadioGroup
                  value={reasoningEffort}
                  onValueChange={(v) => setEffort(v as EffortLevel)}
                >
                  {availableEffortLevels.map((level) => (
                    <DropdownMenuRadioItem
                      key={level.value}
                      value={level.value}
                      data-testid={`${TEST_IDS.composer.reasoningEffortLevel}-${level.value}`}
                    >
                      {level.label}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          )}
          {TOGGLES.map(({ key, label, icon: Icon }) => (
            <DropdownMenuCheckboxItem
              key={key}
              checked={advancedTools.includes(key)}
              onCheckedChange={() => toggle(key)}
            >
              <Icon />
              {label}
            </DropdownMenuCheckboxItem>
          ))}
          {mcpCount > 0 && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => setMcpOpen(true)}>
                <HammerIcon />
                MCP tools
                <span className="text-muted-foreground ml-auto text-xs">
                  {mcpCount}
                </span>
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={mcpOpen} onOpenChange={setMcpOpen}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Available MCP Tools</DialogTitle>
            <DialogDescription>
              Tools provided by active MCP servers. Manage servers in{' '}
              <strong>Settings &gt; MCP Servers</strong>.
            </DialogDescription>
          </DialogHeader>
          <div className="flex max-h-125 flex-col gap-4 overflow-y-auto">
            {data?.tools?.map(({ mcpServerName, tools }) => (
              <div key={mcpServerName} className="flex flex-col gap-3">
                <p className="text-muted-foreground text-xs font-semibold tracking-wider uppercase">
                  {mcpServerName}
                </p>
                {tools.map((tool) => (
                  <div key={tool.name} className="flex flex-col gap-0.5">
                    <p className="text-sm font-medium">{tool.name}</p>
                    <div className="[&_.markdown]:text-muted-foreground [&_.markdown]:text-xs [&_.markdown]:leading-snug [&_.markdown_li]:leading-normal [&_.markdown_ol]:mb-0.5 [&_.markdown_ul]:mb-0.5">
                      <Markdown
                        src={
                          tool.description || `No description for ${tool.name}.`
                        }
                      />
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}

/** Removable pills shown above the textarea for each active advanced tool. */
export function ActiveToolPills() {
  const { advancedTools, toggle, reasoningEffort, setEffort } =
    useAdvancedToolToggle()
  const active = TOGGLES.filter((t) => advancedTools.includes(t.key))
  const effortLabel =
    reasoningEffort !== 'off'
      ? EFFORT_LEVELS.find((l) => l.value === reasoningEffort)?.label
      : null

  if (active.length === 0 && !effortLabel) return null

  return (
    <div className="flex flex-wrap gap-1 px-1">
      {effortLabel && (
        <button
          type="button"
          onClick={() => setEffort('off')}
          className="flex items-center gap-1 rounded-full bg-[#0285ff]/10 px-2 py-0.5 text-xs font-medium text-[#0285ff] transition-colors hover:bg-[#0285ff]/16 dark:text-[#48aaff] [&_svg]:size-3.5"
        >
          <BrainIcon />
          Reasoning: {effortLabel}
          <XIcon className="opacity-60" />
        </button>
      )}
      {active.map(({ key, label, icon: Icon }) => (
        <button
          key={key}
          type="button"
          onClick={() => toggle(key)}
          className="flex items-center gap-1 rounded-full bg-[#0285ff]/10 px-2 py-0.5 text-xs font-medium text-[#0285ff] transition-colors hover:bg-[#0285ff]/16 dark:text-[#48aaff] [&_svg]:size-3.5"
        >
          <Icon />
          {label}
          <XIcon className="opacity-60" />
        </button>
      ))}
    </div>
  )
}
```

- [ ] **Step 3: Wire `reasoningEffort` into the outgoing chat request**

In `src/renderer/components/chat.tsx`, add the atom read next to the existing `getAdvancedTools` (around line 66-68):

```tsx
const getReasoningEffort = useAtomCallback(
  useCallback((get) => get(reasoningEffortAtom), [])
)
```

And add `reasoningEffort: getReasoningEffort()` inside `prepareBody`'s returned object (line 92-98), alongside the existing `advancedTools: getAdvancedTools()`.

Add the import: `import { advancedToolsAtom, reasoningEffortAtom } from '@/stores/chat'` (extends the existing import line).

- [ ] **Step 4: Write the E2E test**

`tests/fixtures/electron.ts` (read during planning) launches the real app against whatever is already in `~/.actovia/database` — it has no settings-seeding fixture of its own. Seed `providerConfig.modelSnapshot` directly through the running app's own `/api/settings` endpoint at the start of the test, the same way `tests/api/settings.spec.ts` does with `providerConfig` today (`api.updateSettings({...})`) — this test needs both fixtures together.

```ts
// tests/e2e/composer-reasoning-effort.spec.ts
import { TEST_IDS } from '../../src/shared/constants/test-ids'
import { ApiClient } from '../fixtures/api-client'
import { electronTest as test, expect } from '../fixtures/electron'

test.describe('Composer reasoning effort picker', () => {
  test('reasoning menu shows only the levels the active model supports', async ({
    mainWindow
  }) => {
    const api = new ApiClient()
    await api.updateSettings({
      providerConfig: {
        provider: 'OpenAI GPT',
        model: 'gpt-5.6',
        modelSnapshot: {
          contextWindow: 1_050_000,
          maxOutputTokens: 128_000,
          reasoningLevels: ['off', 'low', 'medium'],
          cost: { input: 4, output: 20 }
        }
      }
    })
    await mainWindow.reload()
    await mainWindow.waitForLoadState('domcontentloaded')

    await mainWindow.getByLabel('Add').click()
    await mainWindow.getByTestId(TEST_IDS.composer.reasoningEffortItem).click()

    await expect(
      mainWindow.getByTestId(`${TEST_IDS.composer.reasoningEffortLevel}-low`)
    ).toBeVisible()
    await expect(
      mainWindow.getByTestId(`${TEST_IDS.composer.reasoningEffortLevel}-high`)
    ).toHaveCount(0)
  })

  test('reasoning menu item is absent when the model has no reasoning levels', async ({
    mainWindow
  }) => {
    const api = new ApiClient()
    await api.updateSettings({
      providerConfig: {
        provider: 'OpenAI GPT',
        model: 'gpt-5.6-luna',
        modelSnapshot: {
          contextWindow: 1_050_000,
          maxOutputTokens: 128_000,
          reasoningLevels: [],
          cost: { input: 0.2, output: 1.2 }
        }
      }
    })
    await mainWindow.reload()
    await mainWindow.waitForLoadState('domcontentloaded')

    await mainWindow.getByLabel('Add').click()
    await expect(
      mainWindow.getByTestId(TEST_IDS.composer.reasoningEffortItem)
    ).toHaveCount(0)
  })
})
```

The `getByLabel('Add')` locator matches `ComposerToolsButton`'s `aria-label={t('action.add')}` — confirm the English catalog's `common:action.add` value is literally `"Add"` (`src/shared/i18n/locales/en/common.json`) before relying on it; use whatever string is actually there instead if it differs.

- [ ] **Step 5: Run the tests**

Run: `pnpm exec playwright test tests/e2e/composer-reasoning-effort.spec.ts` (requires a built app — see Task 12 Step 5)
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/renderer/components/composer-tools.tsx src/renderer/components/chat.tsx src/shared/constants/test-ids.ts tests/e2e/composer-reasoning-effort.spec.ts
git commit -m "feat(composer): full reasoning-effort level picker replaces the binary toggle"
```

---

### Task 16: `chat.ts` — remove `isReasoningModel`, wire `reasoningEffort` through

`chatModel` is referenced in chat.ts well beyond the `agentLoop` call this task's title implies — six places total, including two job-enqueue payloads whose _receiving_ interfaces live in `jobs/handlers.ts`. All six are plain renames (`chatModel` → `model`); none change behavior.

**Files:**

- Modify: `src/main/lib/server/routes/chat.ts:110-114, 139, 159, 184, 200-206, 264-276, 293-318, 548-551, 561-569`
- Modify: `src/main/lib/jobs/handlers.ts:23-36, 54, 64`
- Test: existing chat route tests — locate with `find tests/unit -iname "chat.test.ts" -path "*routes*"` and extend

**Interfaces:**

- Consumes: `getModelFromProvider(setting): { model, apiKey }` (Task 4), `body.reasoningEffort` (Task 14).
- Produces: `LcmPostTurnPayload`/`MemoryConsolidatePayload` (in `jobs/handlers.ts`) gain a `model: Model<string>` field, replacing `chatModel`.

- [ ] **Step 1: Locate and read the existing chat route test file**

```bash
find tests/unit -path "*server/routes*" -iname "chat*.test.ts"
```

Read whatever this returns in full before editing — it almost certainly mocks `getModelFromProvider` and asserts on the options passed into a mocked `agentLoop`; match its existing mocking style exactly (don't introduce a second mocking convention in the same file).

- [ ] **Step 2: Update the mocked expectations to match the new shape**

Wherever the existing test mocks `getModelFromProvider` to return `{ chatModel, reasoningModel, apiKey }`, change it to return `{ model, apiKey }`. Wherever it asserts the `reasoning` option passed to `agentLoop` based on `advancedTools` including `AdvancedTools.Reasoning`, change it to assert based on a `reasoningEffort` field in the request body instead — e.g.:

```ts
it('passes reasoningEffort through to agentLoop as the reasoning option', async () => {
  // ... existing request-building setup from this file ...
  const response = await app.request('/', {
    method: 'POST',
    body: JSON.stringify({
      id: '11111111-1111-4111-8111-111111111111',
      messages: [/* existing fixture message */],
      advancedTools: [],
      reasoningEffort: 'high'
    })
  })
  // ... existing assertion style from this file, adapted to check
  // the mocked agentLoop was called with { reasoning: 'high', ... } ...
})

it('omits reasoning when reasoningEffort is "off" or absent', async () => {
  // same shape, reasoningEffort: 'off' (or omitted) — assert reasoning: undefined
})
```

- [ ] **Step 3: Run the existing test suite to confirm it currently fails against the still-unedited chat.ts**

Run: `pnpm test -- chat.test` (adjust path to match Step 1's actual filename)
Expected: FAIL on the updated assertions — chat.ts still reads `chatModel`/`reasoningModel`/`isReasoningModel`.

- [ ] **Step 4: Implement the chat.ts changes**

Replace lines 110-114:

```ts
const { model, apiKey } = getModelFromProvider(setting)
```

(Delete the `staleModelSelections` line and the `isReasoningModel` block entirely — no replacement statement for either.)

Replace line 206 (`const activeModel = isReasoningModel ? reasoningModel : chatModel`) — delete it; every later reference to `activeModel` becomes `model` directly (see Step 4b).

Delete lines 264-276 (the `for (const stale of staleModelSelections) { ... }` block) — including its containing comment.

At the top of the file, delete the now-unused `noticedStaleModelKeys` module-level `Set` (lines 76-81) and its comment.

In the `agentLoop` call (around line 300-303), change:

```ts
{
  model: activeModel,
  apiKey,
  reasoning: isReasoningModel ? 'high' : undefined,
  ...
```

to:

```ts
{
  model,
  apiKey,
  reasoning:
    reasoningEffort && reasoningEffort !== 'off' ? reasoningEffort : undefined,
  ...
```

And destructure `reasoningEffort` from the validated request body at the top of the handler, alongside the existing destructure at line 103:

```ts
const { id, messages, advancedTools, reasoningEffort, projectId } =
  validateSchema(
    postRequestBodySchema,
    await c.req.json(),
    'Invalid request body'
  )
```

Deep Research still forces a strong effort regardless of the composer's picker — find wherever the request sets up `deepResearchBootPrompt`/the `AdvancedTools.DeepResearch` branch (line ~247-248 area, `systemContent = advancedTools?.includes(AdvancedTools.DeepResearch) ? deepResearchBootPrompt : ...`) and add one line right before the `agentLoop` call:

```ts
const effectiveReasoning = advancedTools?.includes(AdvancedTools.DeepResearch)
  ? 'high'
  : reasoningEffort && reasoningEffort !== 'off'
    ? reasoningEffort
    : undefined
```

then use `reasoning: effectiveReasoning` in the `agentLoop` options object instead of the inline ternary above.

- [ ] **Step 5: Rename every other `chatModel` reference in this file to `model`**

Four more usages, all in the pre-chat/post-chat sections, all a bare rename with no logic change:

- Line 139: `generateTitleFromUserMessage({ message: userMessage, model: chatModel, apiKey })` → the `model: chatModel` property becomes shorthand `model,` (the property name already matches the renamed local variable).
- Line 159: `new LcmManager(id, chatModel, apiKey, {...})` → `new LcmManager(id, model, apiKey, {...})`.
- Line 184: `loadRelevantMemories(getTextFromMessage(userMessage), chatModel, apiKey, id)` → `loadRelevantMemories(getTextFromMessage(userMessage), model, apiKey, id)`.
- Lines 548-551 (`enqueueAndProcess('lcm-post-turn', { chatId: id, chatModel, apiKey, ... })`) → change the `chatModel,` property to `model,` (shorthand, since the payload's field is being renamed too — see Step 6).
- Lines 561-569 (`enqueueAndProcess('memory-consolidate', { messages: ..., chatModel, apiKey })`) → same, `chatModel,` becomes `model,`.

- [ ] **Step 6: Rename the `chatModel` field in the two job-payload interfaces it feeds**

In `src/main/lib/jobs/handlers.ts`:

```ts
interface LcmPostTurnPayload {
  chatId: string
  model: Model<string>
  apiKey: string
  freshTailSize: number
  contextWindowPercent: number
  newMessages: Array<{ id: string; content: unknown }>
}

interface MemoryConsolidatePayload {
  messages: Array<{ role: string; content: unknown }>
  model: Model<string>
  apiKey: string
}
```

And update the two handlers that read the renamed field:

```ts
    'lcm-post-turn': async (payload) => {
      const p = payload as LcmPostTurnPayload
      const lcm = new LcmManager(p.chatId, p.model, p.apiKey, {
        freshTailSize: p.freshTailSize,
        contextWindowPercent: p.contextWindowPercent
      })
      await lcm.trackNewMessages(p.newMessages)
      await lcm.compactAfterTurn()
    },

    'memory-consolidate': async (payload) => {
      const p = payload as MemoryConsolidatePayload
      await runMemoryConsolidation(p.messages, p.model, p.apiKey)
    },
```

(Both changes are inside the same `handlers` object — the other three handlers, `index-message`/`kb-sync`/`discover-refresh`, are untouched.)

- [ ] **Step 7: Run test to verify it passes**

Run: `pnpm test -- chat.test`
Expected: PASS

- [ ] **Step 8: Run typecheck to confirm no stray `chatModel` reference remains in either file**

Run: `pnpm typecheck:node`
Expected: no errors reported against `chat.ts` or `jobs/handlers.ts` (errors in files Task 17 hasn't reached yet are expected and fine).

- [ ] **Step 9: Commit**

```bash
git add src/main/lib/server/routes/chat.ts src/main/lib/jobs/handlers.ts tests/unit/main/lib/server/routes/chat.test.ts
git commit -m "feat(chat): wire reasoningEffort through to agentLoop; drop isReasoningModel/stale-model notice"
```

---

### Task 17: Update the remaining 9 `getModelFromProvider` call sites

**Files:**

- Modify: `src/main/lib/discover/manager.ts:92-95`
- Modify: `src/main/lib/server/routes/memory.ts:65-71`
- Modify: `src/main/lib/server/routes/deep-research.ts:78, 87, 100, 114`
- Modify: `src/main/lib/ai/philharmonic/pm-coordinator.ts:130, 144, 365`
- Modify: `src/main/lib/ai/philharmonic/employee-loop.ts:65, 124, 209`
- Modify: `src/main/lib/ai/philharmonic/recruit.ts:28, 35`
- Modify: `src/main/lib/ai/calling-tools/web-search.ts:67, 70`
- Modify: `src/main/lib/ai/calling-tools/computer-use.ts:66-67`

**Interfaces:**

- Consumes: `getModelFromProvider(setting): { model, apiKey }` (Task 4).

Every one of these is a mechanical rename with no behavior change — `const { chatModel, apiKey } = getModelFromProvider(...)` becomes `const { model, apiKey } = getModelFromProvider(...)`, and every downstream use of the old local variable name (`chatModel`) becomes `model`. `deep-research.ts` is the one exception worth reading closely (it currently destructures `reasoningModel`, not `chatModel`):

- [ ] **Step 1: `discover/manager.ts`**

Line 92: `const { chatModel, apiKey } = getModelFromProvider(settings)` → `const { model, apiKey } = getModelFromProvider(settings)`. Line 95: rename the `chatModel` reference to `model`.

- [ ] **Step 2: `memory.ts`**

Line 65: same rename. Line 71: rename the `chatModel` reference to `model`.

- [ ] **Step 3: `deep-research.ts`** — read the file first to confirm exact surrounding context

```bash
sed -n '70,120p' src/main/lib/server/routes/deep-research.ts
```

Line 78 (`if (!setting.providerConfig?.reasoningModel)`) becomes `if (!setting.providerConfig?.model)`. Line 87 (`const { reasoningModel, apiKey } = getModelFromProvider(setting)`) becomes `const { model, apiKey } = getModelFromProvider(setting)`. Lines 100 and 114 (`model: reasoningModel`) become `model`.

- [ ] **Step 4: `philharmonic/pm-coordinator.ts`**

Line 130: rename. Line 144 (`new PhilharmonicLcm(conversationId, chatModel, apiKey, {...})`) — rename the argument to `model`. Line 365 (`model: chatModel`) → `model`.

- [ ] **Step 5: `philharmonic/employee-loop.ts`**

Line 65: rename. Line 124 (`model: chatModel`) → `model`. Line 209 (`calculateCost(lastUsage, chatModel)`) → `calculateCost(lastUsage, model)`.

- [ ] **Step 6: `philharmonic/recruit.ts`**

Line 28: rename. Line 35 (`chatModel,`) → `model,`.

- [ ] **Step 7: `calling-tools/web-search.ts`**

Line 67: rename. Line 70 (`chatModel,`) → `model,`.

- [ ] **Step 8: `calling-tools/computer-use.ts`**

Line 66: rename. Line 67 (`model: chatModel`) → `model`.

- [ ] **Step 9: Run full typecheck — this should now be clean**

Run: `pnpm typecheck`
Expected: PASS with zero errors. This is the point where the full type-error list from Task 1 Step 5 should have shrunk to zero — confirm nothing was missed.

- [ ] **Step 10: Run the full test suite**

Run: `pnpm test`
Expected: PASS (684+ tests, plus everything added in Tasks 1-16). If the known-flaky PGlite WASM teardown unhandled-rejection shows up (per CLAUDE.md), retry once before treating it as a real failure.

- [ ] **Step 11: Commit**

```bash
git add src/main/lib/discover/manager.ts src/main/lib/server/routes/memory.ts src/main/lib/server/routes/deep-research.ts src/main/lib/ai/philharmonic/pm-coordinator.ts src/main/lib/ai/philharmonic/employee-loop.ts src/main/lib/ai/philharmonic/recruit.ts src/main/lib/ai/calling-tools/web-search.ts src/main/lib/ai/calling-tools/computer-use.ts
git commit -m "refactor: rename chatModel/reasoningModel to model across remaining 9 call sites"
```

---

## Phase 5 — Wrap-up

### Task 18: Update CLAUDE.md

**Files:**

- Modify: `/Users/yanceyleo/Code/actovia/actovia/CLAUDE.md`

**Interfaces:** none — documentation only.

- [ ] **Step 1: Update the affected sections**

In the "AI/LLM Integration" section, update the `resolveModel()` description to mention it now accepts an optional live-fetched `snapshot` and that `MODEL_OVERRIDES` is renamed `MODEL_METADATA_FALLBACK` with narrower scope (only what a provider's own list API omits).

In "Server Routes", add `models` under the existing `/api/settings` entry's description, or note the new `POST /api/settings/models` sub-route in prose near where `/api/settings` is first introduced.

Add a new bullet under "Code Structure → Main process" for the new directory: `src/main/lib/ai/providers/list-models/` — one handler per provider (`anthropic.ts`, `openai.ts`, `google.ts`, `xai.ts`, `ollama.ts`, `azure.ts` if implemented), normalizing each provider's real list-models API into `{ id, displayName, snapshot: ModelSnapshot }`, dispatched by `index.ts` and called from `POST /api/settings/models`.

Update "When Working with AI Providers" to note that selectable models are no longer a static list in `src/shared/constants/models.ts` (delete that bullet's reference if the file was deleted in Task 13) — model selection is now a live fetch per provider from Settings.

- [ ] **Step 2: Run the CLAUDE.md freshness/staleness tests**

Run: `pnpm test -- claude-md`
Expected: PASS (`claude-md-freshness.test.ts` checks referenced paths exist; `claude-md-staleness.test.ts` checks for retired claims — confirm neither flags anything from this change).

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md for the dynamic model catalog + single-model architecture"
```

---

### Task 19: Full gate pass

**Files:** none — verification only.

- [ ] **Step 1: Run the complete pre-commit gate**

```bash
pnpm format
pnpm lint
pnpm typecheck
pnpm i18n:check
pnpm test
```

Expected: all PASS. This is the same gate the husky pre-commit hook runs — running it manually here catches anything before the final commit attempt.

- [ ] **Step 2: Manual smoke test in the running app**

Run: `pnpm dev`. For at least one real provider you have a key for: enter the key in Settings → Providers, click "Refresh model list," pick a model, send a chat message, then open the composer's `+` menu and confirm the Reasoning submenu shows only the levels that model actually supports (or is absent if it supports none). Confirm no console errors in the Electron DevTools.

- [ ] **Step 3: Final commit if anything was fixed during Steps 1-2**

```bash
git add -A
git commit -m "fix: address gate/smoke-test findings from the dynamic model catalog rollout"
```
