# Dynamic Model Catalog + Single Model/Effort Selection — Design

> Cost/price parts superseded by 2026-10-27-remove-cost-context-panel-design.md (ISSUE-235).

**Date**: 2026-09-12

**Status**: approved (brainstorming 2026-09-12)

---

## Context

Two things converged in the same session and turned out to be the same fix:

1. `src/shared/constants/models.ts` hardcodes each provider's selectable chat/
   reasoning model ids, and `src/main/lib/ai/providers/resolve-model.ts`
   (`MODEL_OVERRIDES`) hand-maintains cost/context/reasoning metadata for every
   model newer than the installed `@mariozechner/pi-ai` registry. Both lists
   need a manual edit every time a provider ships or retires a model — this is
   exactly what broke OpenAI chat earlier in this session (a stale model id +
   a stale `api` string).
2. Settings today asks for two separate model ids per provider — "Chat Model"
   and "Reasoning Model" (`provider-config.tsx`) — and the composer's
   "Reasoning" advanced-tool is a binary on/off that switches between them
   (`chat.ts`: `isReasoningModel ? reasoningModel : chatModel`, effort hardcoded
   to `'high'` when on). All four providers' current list-models APIs (checked
   directly against their docs, 2026-09-12) report reasoning as a _level_, not
   a separate model: Anthropic's `capabilities.effort` names exact supported
   levels (none/low/medium/high/xhigh/max) per model id. Picking two model ids
   is the wrong shape for what these APIs now describe.

Checked each provider's real list-models response before designing this
(2026-09-12):

| Provider      | Model IDs | Context/max tokens                        | Reasoning levels             | Cost |
| ------------- | --------- | ----------------------------------------- | ---------------------------- | ---- |
| Anthropic     | ✅        | ✅ (`max_input_tokens`, `max_tokens`)     | ✅ (`capabilities.effort.*`) | ❌   |
| Google Gemini | ✅        | ✅ (`inputTokenLimit`/`outputTokenLimit`) | boolean only (`thinking`)    | ❌   |
| xAI           | ✅        | ✅ (`context_length`)                     | ❌                           | ✅   |
| OpenAI        | ✅        | ❌                                        | ❌                           | ❌   |

Every provider gives us the _list of model ids_ live. Only Anthropic gives us
everything else live. This spec fixes "which models exist" universally and
narrows — but does not eliminate — hand-maintained metadata to exactly the
gaps each provider's own API leaves.

## Decisions (from brainstorming, 2026-09-12)

1. Combine both changes into one design — the live catalog is the data source
   the effort-level picker needs anyway.
2. All 6 providers in scope, including Azure OpenAI and Ollama.
3. Fetch is **manual**: a "Refresh model list" button next to each provider's
   API key field. No auto-fetch on blur/keystroke.
4. ~~The fetched _list_ is never persisted~~ — **superseded 2026-09-15**: the
   user asked for it to survive closing Settings / app restarts, not just the
   session. The fetched catalog is now persisted too, in a new
   `settings.modelCatalog` jsonb column (`ModelCatalogSchema`, keyed by the
   `AiProviders` enum value), written via the same per-field settings
   autosave as everything else — `ModelPicker` sets
   `modelCatalog.<provider>` on a successful Refresh. Still no TTL, still no
   separate cache table (it lives on the existing `settings` row); Refresh
   remains the only thing that overwrites an entry. The _selected_ model's
   capability snapshot is unchanged, written into `providerConfig` at
   selection time.
5. No backward-compat shim for existing `providerConfig.{chatModel,
   reasoningModel}` rows — the field is renamed to `model` and old rows simply
   read as unset; the user re-picks once after updating.
6. The composer's binary Reasoning toggle becomes a full level picker (off/
   low/medium/high/xhigh/max), populated from the active model's persisted
   snapshot. No separate Settings-level default effort.

## 1. Data model

`ProviderConfigSchema` (`src/shared/schemas/settings-schema.ts`):

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
  reasoningLevels: z.array(EffortLevelSchema), // [] = no reasoning support
  cost: z.object({ input: z.number(), output: z.number() }).nullish() // null when the provider's list API doesn't report price
})
export type ModelSnapshot = z.infer<typeof ModelSnapshotSchema>

export const ProviderConfigSchema = z.object({
  provider: z.string().nullish(),
  model: z.string().nullish(),
  modelSnapshot: ModelSnapshotSchema.nullish()
  // chatModel / reasoningModel removed — no migration, see Decision 5
})
```

`resolve-model.ts` simplifies: `resolveModel()` gains an optional
`snapshot?: ModelSnapshot` parameter. When present, it's used directly instead
of consulting the pi-ai registry or `MODEL_OVERRIDES`. The registry/override
path stays only as the fallback for callers with no snapshot (Ollama's
free-typed ids when the user skips the dropdown, and a defensive default if a
settings row somehow has `model` but no `modelSnapshot`).

`MODEL_OVERRIDES` is replaced by a much smaller `MODEL_METADATA_FALLBACK`,
keyed by model id, holding **only** what a provider's own list API omits:

- OpenAI entries: full `{ contextWindow, maxOutputTokens, reasoningLevels, cost }`
  (their API gives us nothing but the id — this table's burden is unchanged
  from today for OpenAI specifically).
- Google entries: `{ cost }` only.
- xAI entries: `{ reasoningLevels }` only.
- Anthropic: no entries needed — its API is complete.

This fallback table is consulted by the new `/api/settings/models` route (§2)
when normalizing a provider's response, not by `resolveModel()` — by the time
`resolveModel()` runs, the gaps have already been filled into the persisted
`modelSnapshot`.

## 2. Fetch route

`GET /api/settings/models?provider=<AiProviders>` — main process only, one
handler per provider under `src/main/lib/ai/providers/list-models/`:

- Reads the API key **from the request** (query/body), not from saved
  settings — the button must work before the user has saved the key.
- Calls that provider's real list-models endpoint (Anthropic `GET /v1/models`,
  Google `models.list`, xAI `GET /v1/models`, OpenAI `GET /v1/models`).
- Normalizes into `{ id: string; displayName: string; snapshot: ModelSnapshot }[]`,
  filling gaps from `MODEL_METADATA_FALLBACK[id]` (missing fallback entry for
  an unknown new id just means that field stays `null`/`[]` — never throws).
- Google's `thinking` field is boolean, not leveled. Normalization maps
  `thinking: true` → `reasoningLevels: ['off', 'high']` and `thinking: false`
  → `reasoningLevels: []`. This is a fixed convention, not a per-model value —
  pi-ai's own `thinkingLevelMap` already collapses named levels to Gemini's
  numeric thinking-budget underneath, so the composer only ever needs to offer
  a two-state choice for Gemini models.
- **Azure**: expected to call `{endpoint}/openai/models?api-version=...` with
  the same `api-key` header already used for chat completions (no separate
  ARM/subscription credentials — Actovia doesn't collect those). **Unverified
  against a real Azure resource — flagged as a spike for the implementation
  plan.** If it doesn't pan out, Azure keeps a free-text model field instead of
  a dropdown, same as the Ollama fallback below.
- **Ollama**: `GET {ollamaBaseUrl}/api/tags` (no auth). Returns local model
  names only — `snapshot` is always `{ contextWindow: null, maxOutputTokens:
  null, reasoningLevels: [], cost: null }`. Dropdown still allows free-text
  entry for a model not yet pulled.
- Errors (invalid key, network, rate limit) surface as a normal JSON error the
  renderer turns into a toast — reuse the `toFriendlyChatError`-style mapping,
  don't invent a second one.

## 3. Settings UI

- `ProviderConfig` (top of the Providers tab) shrinks to just the "Provider"
  `<Select>` — which of the 6 is active for chat.
- Each provider-specific tab (`providers/openai-gpt.tsx` etc.) gains, directly
  below its API key field: a **"Refresh model list"** button (disabled with a
  hint until the key field is non-empty) and a Model `<Select>`.
- Before any refresh this session: if `providerConfig.model` already holds a
  value for _this_ provider, pre-select it as the sole option with a "Refresh
  to see all available models" hint. Otherwise show a "Click refresh to load
  models" placeholder.
- Refresh calls the route in §2 with the currently-typed (possibly unsaved)
  key, populates the dropdown. Picking a model writes `providerConfig.model` +
  `providerConfig.modelSnapshot` together through the existing autosave path —
  no new persistence mechanism.
- If the previously-saved model isn't in a fresh refresh's results, keep it
  selected and show it with the existing stale-model warning style
  (`staleModelWarning` in `provider-config.tsx` today) — now checked against a
  live list instead of a hardcoded one, so it's strictly more accurate.

## 4. Composer + chat.ts wiring

- `composer-tools.tsx`: the Reasoning advanced-tool toggle becomes a level
  picker (off/low/medium/high/xhigh/max), reading options from
  `providerConfig.modelSnapshot.reasoningLevels`. Hidden entirely when that
  array is empty. Still mutually exclusive with Deep Research.
- `AdvancedTools.Reasoning` is removed from the enum (`src/shared/types/ai.ts`)
  — DeepResearch stays as the only member.
- `postRequestBodySchema` (`src/main/lib/server/schemas/chat.ts`) gains
  `reasoningEffort: EffortLevelSchema.optional()`.
- `chat.ts`: `getModelFromProvider()` returns `{ model, apiKey }`. The
  `isReasoningModel` ternary is deleted; `reasoning:` is
  `reasoningEffort && reasoningEffort !== 'off' ? reasoningEffort : undefined`,
  still forced to a strong level when Deep Research is selected regardless of
  the picker (unchanged behavior, just a different source value).
- `getStaleModelSelections()` and the per-launch "your model dropped off the
  lineup" chat notice are **removed outright**, not adapted. That check
  existed to catch drift against our _hardcoded_ list; once a model is chosen
  from a live fetch, real staleness surfaces as an actual provider error on
  the next call, which `toFriendlyChatError`'s existing "model not found"
  branch already translates into the same guidance. Re-checking a live list on
  every chat request just to pre-empt a rare case isn't worth the latency.
- `getModelFromProvider()` (`src/main/lib/ai/utils/model-util.ts`) is called
  in 10 places beyond chat.ts: `discover/manager.ts`, `memory.ts`,
  `deep-research.ts` (currently destructures `reasoningModel` specifically —
  becomes `model`), `philharmonic/{pm-coordinator,employee-loop,recruit}.ts`,
  `calling-tools/{web-search,computer-use}.ts`. Every call site switches from
  `chatModel`/`reasoningModel` to the single `model`; none needs new logic
  beyond the rename.

## 5. Testing

- `resolve-model.test.ts`: `resolveModel()` prefers a passed `snapshot` over
  the registry/fallback path; falls back correctly when `snapshot` is absent.
- New `list-models` route tests per provider: normalization fills gaps from
  `MODEL_METADATA_FALLBACK`, never throws on an unknown id, surfaces
  provider errors as the expected JSON shape.
- `tool-binding-util.test.ts` / `chat.test.ts`: `reasoningEffort` flows through
  to the `reasoning` option; `'off'`/absent maps to `undefined`; Deep Research
  still forces a strong level.
- `providers.test.ts`: update the existing table-driven test for the schema
  rename (`model` instead of `chatModel`/`reasoningModel`).
- Settings UI: Playwright coverage for the refresh button's disabled→enabled
  transition on key entry, and the stale-model warning against a mocked fetch
  response (new `TEST_IDS` entries per the project's test-id-checkpoint rule).

## 6. Non-goals

- No live model-list caching layer / TTL / background refresh — manual button
  only, per Decision 3.
- No migration of existing `chatModel`/`reasoningModel` settings rows, per
  Decision 5.
- No attempt to source pricing from OpenAI or Google's APIs — both omit it;
  `MODEL_METADATA_FALLBACK` remains the only source for those two.
- Azure's exact fetch mechanism is a design assumption pending verification
  during implementation, not a settled fact of this spec. **Verification
  outcome (SDD execution, 2026-09-12): no Azure OpenAI resource or
  credentials were available in the execution environment, so
  `listAzureModels` was not implemented in this pass.** Azure's Settings tab
  keeps a free-text model `Input` (no live dropdown) per the plan's own
  documented fallback. Implementing the live handler is follow-up work for
  whoever has a real Azure resource to verify the `{endpoint}/openai/models`
  assumption against.
