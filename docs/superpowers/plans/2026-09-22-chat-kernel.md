# Chat Kernel on pi 0.85 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the chat kernel — send → model steps → tool results → rows in the database — on `@earendil-works/pi-ai` + `@earendil-works/pi-agent-core` 0.85, with the **run** (`message.runId`) as the unit that context assembly, compaction and rendering work in, snake_case tool names, and an MCP toolbox instead of per-tool binding.

**Architecture:** A new `src/main/lib/ai/kernel/` owns the process's `Models` collection (`models.ts`), the agent run (`run.ts`: pi's `Agent` wrapped as `runAgent(): AsyncIterable<KernelEvent>`), persistence (`record.ts`: `RunRecorder`) and the context invariant (`invariant.ts`). `chat.ts` shrinks to validate → build → `for await` → SSE. Context assembly becomes run-aligned so a provider request can never contain a `tool_result` without its `tool_use`. The renderer groups by `runId` and renders one assistant message per run.

**Tech Stack:** Electron main process (Node), Hono, PGlite + Drizzle, `@earendil-works/pi-ai` 0.85.1, `@earendil-works/pi-agent-core` 0.85.1 (TypeBox re-exported), Vitest 4 (faux provider, in-memory PGlite), React 19 renderer, Playwright e2e.

**Spec:** `docs/superpowers/specs/2026-09-22-chat-kernel-design.md`

## Global Constraints

- Branch: create `feat/chat-kernel` off `feat/lan-pairing-sandbox-isolation` before Task 1. Never push or merge; stage files by name (never `git add -A`).
- Package versions: `@earendil-works/pi-ai` `^0.85.1`, `@earendil-works/pi-agent-core` `^0.85.1`. No `/compat` entrypoint anywhere in `src/`. Any `package.json` change ships with the regenerated `bun.lock` in the same commit (CI runs `--frozen-lockfile`).
- Tool names are snake_case per the spec's table: `computer_use` `deep_research` `create_artifact` `image_generation` `find_files` `edit_file` `lcm_grep` `grep` `lcm_describe` `search_knowledge_base` `map_itinerary` `web_search` `lcm_expand` `weather` `list_directory` `terminal` `read_file` `web_fetch` `write_file`. One spelling in the database after the migration; no alias layer.
- `message.runId` is a `uuid`, indexed with `chatId`, equal to the run's user message id for every row of the run.
- `memory.freshTailSize` means **runs** (default 6, range 2–24) after Task 5; the settings copy follows in all 10 locales.
- Invariant (Task 5, property-tested): an assembled message list starts with a `user` message, and every `toolResult` has its `toolCall` earlier in the list.
- The SSE wire format keeps every event shape; every message on the wire gains `runId`. The iOS app changes nothing.
- Philharmonic (`src/main/lib/ai/philharmonic/`) changes package names and the `agentLoop` call shape only — no behaviour changes.
- New user-facing strings go in `packages/shared/src/i18n/locales/en/<ns>.json` and all 9 other locales in the same commit (`bun run i18n:check` gates it). No Chinese in the UI.
- Pre-commit gate for every commit: `bun run fmt` → `bun run lint` → `bun run typecheck` → `bun run i18n:check` → `bun run test`. Never repo-wide `bun run lint:fix`.
- Tests live under `tests/unit/`, mirroring `src/`, importing via `@main/...`, `@/...`, `@actovia/shared/...`. Kernel tests use pi's `fauxProvider()`; no provider key anywhere in unit tests.
- CLAUDE.md is updated in the same change as any architecture/route/directory change (Task 12, plus the `claude-md-freshness.test.ts` path check on every commit).
- Every commit message ends with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

---

## File map

**Create**

- `src/main/lib/ai/kernel/models.ts` — the `Models` collection (5 built-in providers + Ollama via `createProvider`), `streamFn`, `getKernelModels()`.
- `src/main/lib/ai/kernel/invariant.ts` — `dropBrokenRuns(messages)`: the run invariant as a pure function.
- `src/main/lib/ai/kernel/events.ts` — `KernelEvent` union.
- `src/main/lib/ai/kernel/run.ts` — `runAgent(input)`.
- `src/main/lib/ai/kernel/record.ts` — `RunRecorder`.
- `src/main/lib/ai/kernel/faux.ts` — `registerFauxProvider()` for tests and the `ACTOVIA_FAUX_PROVIDER=1` e2e switch.
- `src/main/lib/ai/calling-tools/mcp-toolbox.ts` — `list_mcp_tools` + `call_mcp_tool`.
- `packages/shared/src/constants/tool-names.ts` — `TOOL_NAMES`, `LEGACY_TOOL_NAMES`.
- `resources/drizzle/0007_snake_case_tool_names.sql`, `resources/drizzle/0008_message_run_id.sql` (+ journal entries).
- Tests: `tests/unit/main/lib/ai/kernel/{models,invariant,run,record,mcp-toolbox}.test.ts`, `tests/unit/main/lib/db/migrations/{0007-tool-names,0008-run-id}.test.ts`, `tests/unit/main/lib/ai/context-management/context-assembler.property.test.ts`, `tests/unit/shared/constants/tool-names.test.ts`, `tests/e2e/chat-faux-provider.spec.ts`.

**Modify**

- `package.json` / `bun.lock` — packages.
- Every file importing `@mariozechner/*` (58 sites, listed in Task 2).
- `src/main/lib/ai/utils/complete.ts`, `src/main/lib/ai/providers/{resolve-model,index,ollama}.ts`, `src/main/lib/ai/computer-use/agent.ts`.
- `src/main/lib/ai/calling-tools/*.ts` (19 `name:` fields), `index.ts`.
- `src/main/lib/ai/utils/tool-binding-util.ts` — snake_case keys, toolbox, no `MAX_TOOLS`.
- `src/main/lib/ai/prompts.ts` — tool names + MCP directory.
- `src/main/lib/db/schema.ts` (`message.runId`), `src/main/lib/db/queries.ts:182`.
- `src/main/lib/ai/context-management/{context-assembler,compaction,index}.ts`.
- `src/main/lib/server/routes/{chat,chat-persistence}.ts`, `src/main/lib/server/schemas/chat.ts`.
- `src/main/lib/jobs/handlers.ts` (freshTailSize default).
- `packages/shared/src/types/{ai,chat}.ts`, `packages/shared/src/constants/tools.ts`, `packages/shared/src/i18n/namespaces.ts`, `packages/shared/src/schemas/settings-schema.ts`, locale JSON ×10.
- `src/renderer/components/{messages,messages-calling-tools,thinking-timeline}.tsx`, `src/renderer/components/web-search/{image-lightbox,video-cards}.tsx`, `src/renderer/components/deep-research/*.tsx`, `src/renderer/components/settings/settings-form/{computer-use,deep-research,memory}.tsx`, `src/renderer/components/calling-tools/map-itinerary/types.ts`, `src/renderer/lib/utils.ts`.
- `tests/fixtures/electron.ts` (env passthrough), `CLAUDE.md`, `docs/pi-ai-review.md`.

**Delete**

- `src/main/lib/ai/utils/transform-messages.ts`, `tests/unit/main/lib/ai/utils/transform-messages.test.ts`.

---

### Task 1: The `Models` collection on pi 0.85 (both package sets installed)

**Files:**

- Modify: `package.json` (add two deps), `bun.lock`
- Create: `src/main/lib/ai/kernel/models.ts`
- Create: `src/main/lib/ai/kernel/faux.ts`
- Test: `tests/unit/main/lib/ai/kernel/models.test.ts`

**Interfaces:**

- Consumes: nothing from earlier tasks.
- Produces:
  - `getKernelModels(): MutableModels` — the process singleton, five built-in providers registered plus `ollama`.
  - `streamFn: StreamFn` — `(model, context, options) => getKernelModels().streamSimple(model, context, options)`.
  - `OLLAMA_PROVIDER_ID = 'ollama'`.
  - `registerFauxProvider(options?): FauxProviderHandle` (in `faux.ts`) — registers pi's faux provider on the singleton and returns the handle.

- [ ] **Step 1: Branch and install the 0.85 packages alongside the old ones**

```bash
git checkout -b feat/chat-kernel
bun add @earendil-works/pi-ai@^0.85.1 @earendil-works/pi-agent-core@^0.85.1
```

Expected: `package.json` gains both deps; `bun.lock` regenerated. The `@mariozechner/*` packages stay for now (Task 2 removes them). Run `bun run typecheck` — still green, nothing imports the new packages yet.

- [ ] **Step 2: Write the failing models test**

`tests/unit/main/lib/ai/kernel/models.test.ts`:

```ts
import { fauxAssistantMessage, fauxText } from '@earendil-works/pi-ai'
import { registerFauxProvider } from '@main/lib/ai/kernel/faux'
import {
  OLLAMA_PROVIDER_ID,
  getKernelModels,
  streamFn
} from '@main/lib/ai/kernel/models'
import { describe, expect, it } from 'vitest'

describe('kernel models collection', () => {
  it('registers the five built-in providers and ollama', () => {
    const ids = getKernelModels()
      .getProviders()
      .map((p) => p.id)
    for (const id of [
      'anthropic',
      'openai',
      'google',
      'xai',
      'azure-openai-responses',
      OLLAMA_PROVIDER_ID
    ]) {
      expect(ids).toContain(id)
    }
  })

  it('routes a hand-built ollama model through the ollama provider', () => {
    const provider = getKernelModels().getProvider(OLLAMA_PROVIDER_ID)
    expect(provider).toBeDefined()
    // Dynamic provider: nothing in the catalog, requests are routed by
    // `model.provider` alone.
    expect(provider!.getModels()).toEqual([])
  })

  it('streamFn streams through the collection with an explicit apiKey', async () => {
    const faux = registerFauxProvider()
    faux.setResponses([fauxAssistantMessage([fauxText('hello from faux')])])
    const stream = await streamFn(
      faux.getModel(),
      { messages: [{ role: 'user', content: 'hi', timestamp: Date.now() }] },
      { apiKey: 'explicit-key' }
    )
    const message = await stream.result()
    expect(message.content).toEqual([
      expect.objectContaining({ type: 'text', text: 'hello from faux' })
    ])
    expect(faux.state.callCount).toBe(1)
  })
})
```

- [ ] **Step 3: Run it to see it fail**

Run: `bun run test tests/unit/main/lib/ai/kernel/models.test.ts`
Expected: FAIL — `Cannot find module '@main/lib/ai/kernel/models'`.

- [ ] **Step 4: Write `kernel/models.ts`**

```ts
import type { StreamFn } from '@earendil-works/pi-agent-core'
import {
  createModels,
  createProvider,
  type MutableModels,
  type Provider
} from '@earendil-works/pi-ai'
import { openAICompletionsApi } from '@earendil-works/pi-ai/api/openai-completions.lazy'
import { anthropicProvider } from '@earendil-works/pi-ai/providers/anthropic'
import { azureOpenAIResponsesProvider } from '@earendil-works/pi-ai/providers/azure-openai-responses'
import { googleProvider } from '@earendil-works/pi-ai/providers/google'
import { openaiProvider } from '@earendil-works/pi-ai/providers/openai'
import { xaiProvider } from '@earendil-works/pi-ai/providers/xai'

/**
 * The process's one `Models` collection. pi 0.85 routes every request by
 * `model.provider` to a registered provider, which resolves auth and owns the
 * stream; there is no global registry any more. Actovia passes the API key
 * from Settings explicitly on each request (`options.apiKey` wins over
 * anything a provider would resolve from the environment), so nothing here
 * reads env vars in practice.
 */

export const OLLAMA_PROVIDER_ID = 'ollama'

/**
 * Ollama is a dynamic provider with an empty catalog: `getOllama()` in
 * `providers/ollama.ts` hand-builds a `Model` per request with
 * `provider: 'ollama'` and the base URL from Settings, and the collection
 * routes it here. Keyless: auth resolves as configured with no key.
 */
function ollamaProvider(): Provider<'openai-completions'> {
  return createProvider({
    id: OLLAMA_PROVIDER_ID,
    name: 'Ollama',
    auth: { apiKey: { name: 'Ollama', resolve: async () => ({ auth: {} }) } },
    models: [],
    api: openAICompletionsApi()
  })
}

let models: MutableModels | undefined

export function getKernelModels(): MutableModels {
  if (models) return models
  models = createModels()
  models.setProvider(anthropicProvider())
  models.setProvider(openaiProvider())
  models.setProvider(googleProvider())
  models.setProvider(xaiProvider())
  models.setProvider(azureOpenAIResponsesProvider())
  models.setProvider(ollamaProvider())
  return models
}

/** What every `Agent` / `agentLoop` in the app streams through. */
export const streamFn: StreamFn = (model, context, options) =>
  getKernelModels().streamSimple(model, context, options)
```

`kernel/faux.ts`:

```ts
import {
  fauxProvider,
  type FauxProviderHandle,
  type RegisterFauxProviderOptions
} from '@earendil-works/pi-ai'

import { getKernelModels } from './models'

/**
 * pi's scripted provider, registered on the kernel's collection. Unit tests
 * script replies with `setResponses([...])`; the Electron e2e (Task 11)
 * registers it at boot when `ACTOVIA_FAUX_PROVIDER=1`.
 */
export function registerFauxProvider(
  options?: RegisterFauxProviderOptions
): FauxProviderHandle {
  const handle = fauxProvider(options)
  getKernelModels().setProvider(handle.provider)
  return handle
}
```

- [ ] **Step 5: Run the test**

Run: `bun run test tests/unit/main/lib/ai/kernel/models.test.ts`
Expected: PASS (3 tests). If `openAICompletionsApi` fails to resolve, check `node_modules/@earendil-works/pi-ai/package.json` `exports["./api/*"]` — the subpath is `api/openai-completions.lazy`.

- [ ] **Step 6: Commit**

```bash
git add package.json bun.lock src/main/lib/ai/kernel/models.ts src/main/lib/ai/kernel/faux.ts tests/unit/main/lib/ai/kernel/models.test.ts
git commit -m "feat(kernel): the Models collection on pi 0.85

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Move every import to the 0.85 packages and drop `@mariozechner/*`

**Files:**

- Modify (all 58): `packages/shared/src/types/ai.ts`, `packages/shared/src/types/chat.ts`, `src/renderer/lib/utils.ts`, `src/main/lib/db/schema.ts`, `src/main/lib/analytics/snapshot.ts`, `src/main/lib/jobs/handlers.ts`, `src/main/lib/ai/utils/{cost,overflow,chat-message-util,complete,model-util,query-expansion,tool-binding-util,transform-messages}.ts`, `src/main/lib/ai/computer-use/{agent,action-tools}.ts`, `src/main/lib/ai/mcp.ts`, `src/main/lib/ai/memory/manager.ts`, `src/main/lib/ai/providers/{index,ollama,resolve-model}.ts`, `src/main/lib/ai/context-management/{compaction,context-assembler,index}.ts`, `src/main/lib/ai/deep-research/{deep-research,final-report,generate-queries,process-search-results}.ts`, `src/main/lib/ai/philharmonic/{agent-tools,employee-loop,plan-tools,pm-coordinator,pm-tools,report-tools}.ts`, `src/main/lib/ai/philharmonic/lcm/{index,summarize}.ts`, all 19 `src/main/lib/ai/calling-tools/*.ts`, `src/main/lib/server/routes/{chat,chat-persistence}.ts`, and the 17 test files under `tests/unit/` that import the packages (`tests/unit/main/lib/ai/computer-use/agent.test.ts`, `tests/unit/main/lib/ai/context-management/index.test.ts`, `tests/unit/main/lib/ai/memory/manager.test.ts`, `tests/unit/main/lib/ai/philharmonic/{employee-loop,lcm/summarize,pm-coordinator,pm-tools,recruit,report-tools}.test.ts`, `tests/unit/main/lib/ai/utils/{complete,query-expansion,transform-messages}.test.ts`, `tests/unit/main/lib/discover/manager.test.ts`, `tests/unit/main/lib/jobs/handlers.test.ts`, `tests/unit/main/lib/server/routes/chat.test.ts`, `tests/unit/shared/meta/claude-md-staleness.test.ts`)
- Modify: `package.json`, `bun.lock`

**Interfaces:**

- Consumes: `getKernelModels()`, `streamFn` from Task 1.
- Produces: `completeSimple` in `src/main/lib/ai/utils/complete.ts` keeps its signature `(model, context, options?) => Promise<AssistantMessage>`; `resolveModel()` keeps its signature; `agentLoop` call sites pass `streamFn` as the fifth argument.

- [ ] **Step 1: Mechanical import rename**

Every `from '@mariozechner/pi-ai'` → `from '@earendil-works/pi-ai'`; every `from '@mariozechner/pi-agent-core'` → `from '@earendil-works/pi-agent-core'`. Do it with one scripted pass, then review the diff:

```bash
grep -rl "@mariozechner/" src tests packages | xargs sed -i '' \
  -e "s#@mariozechner/pi-ai#@earendil-works/pi-ai#g" \
  -e "s#@mariozechner/pi-agent-core#@earendil-works/pi-agent-core#g"
grep -rn "@mariozechner" src tests packages   # expect: no output
```

Also `src/main/lib/ai/utils/model-util.ts` and any comment that names `@mariozechner/pi-ai/dist/models.generated.js` (`chat.ts:276`) — the comment goes in Task 7 when that block is deleted; leave it now.

- [ ] **Step 2: Fix the three call sites that used the removed global API**

`src/main/lib/ai/utils/complete.ts` — pi 0.85 has no global `completeSimple`; go through the collection:

```ts
import type {
  AssistantMessage,
  Context,
  Model,
  SimpleStreamOptions
} from '@earendil-works/pi-ai'

import { getKernelModels } from '../kernel/models'
```

and where the file called `completeSimple(model, context, options)` from the package, call `getKernelModels().completeSimple(model, context, options)` instead. Keep everything else (the `LlmRequestError` on `stopReason === 'error'`) exactly as is.

`src/main/lib/ai/providers/resolve-model.ts:3,125` — `getModel` from the package → `getKernelModels().getModel(provider, id)`:

```ts
import { getKernelModels } from '../kernel/models'
// ...
const registered = getKernelModels().getModel(provider, id)
```

`src/main/lib/ai/computer-use/agent.ts:12,122` — `complete` from the package → `getKernelModels().complete(model, context, options)`.

- [ ] **Step 3: Ollama routes to its own provider**

`src/main/lib/ai/providers/ollama.ts` — the hand-built `Model` sets `provider: 'openai'` today; change it to `provider: OLLAMA_PROVIDER_ID` (import from `../kernel/models`). Keep `api: 'openai-completions'` and the base URL from Settings. (The `openai` provider in 0.85 only serves `openai-responses`; a completions model routed there is a stream error.)

- [ ] **Step 4: `agentLoop` takes `streamFn` as its fifth argument**

In `src/main/lib/ai/philharmonic/employee-loop.ts:120`, `src/main/lib/ai/philharmonic/pm-coordinator.ts:356` and `src/main/lib/server/routes/chat.ts:288`, the 0.85 signature is `agentLoop(prompts, context, config, signal, streamFn)`. Add the import and the argument, changing nothing else:

```ts
import { streamFn } from '../kernel/models' // path relative to the file
// ...
const stream = agentLoop(prompts, context, config, signal, streamFn)
```

`config` still carries `apiKey`; `AgentLoopConfig extends SimpleStreamOptions extends StreamOptions extends ProviderRequestOptions { apiKey?: string }`, so it reaches `streamSimple`'s options and wins over provider auth.

- [ ] **Step 5: Reasoning level names**

0.85's `ThinkingLevel` is `'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'` — `'max'` now exists and `'off'` is gone. In `src/main/lib/server/routes/chat.ts:278-286` the mapping collapses to:

```ts
const effectiveReasoning = advancedTools?.includes(AdvancedTools.DeepResearch)
  ? 'high'
  : reasoningEffort && reasoningEffort !== 'off'
    ? reasoningEffort
    : undefined
```

Grep `'xhigh'` and `'off'` under `src/main/lib/ai/` for any other mapping (deep-research, philharmonic) and apply the same rule: `'off'` → `undefined`, everything else passes through.

- [ ] **Step 6: Remove the old packages and typecheck**

```bash
bun remove @mariozechner/pi-ai @mariozechner/pi-agent-core
bun run typecheck
```

Fix every remaining error by reading the 0.85 `.d.ts` (`node_modules/@earendil-works/pi-ai/dist/types.d.ts`, `node_modules/@earendil-works/pi-agent-core/dist/types.d.ts`). Known differences to expect: `AgentTool.execute` now has the signature `(toolCallId, params, signal?, onUpdate?)` (same as before); `AgentToolResult` requires `details` (same); `Type`/`Static`/`TSchema` and `StringEnum` are still exported from `@earendil-works/pi-ai`; `KnownProvider`/`Api`/`Usage`/`Message`/`Model` unchanged.

- [ ] **Step 7: Tests that mocked the old modules**

Any `vi.mock('@mariozechner/pi-ai', ...)` became `vi.mock('@earendil-works/pi-ai', ...)` in Step 1; tests that mocked `completeSimple` on the package now need to mock `@main/lib/ai/kernel/models` instead, e.g. in `tests/unit/main/lib/ai/utils/complete.test.ts`:

```ts
const completeSimple = vi.fn()
vi.mock('@main/lib/ai/kernel/models', () => ({
  getKernelModels: () => ({ completeSimple })
}))
```

Run the whole suite and fix each failure on its own terms: `bun run test`.

- [ ] **Step 8: Gate and commit**

```bash
bun run fmt && bun run lint && bun run typecheck && bun run i18n:check && bun run test
git add package.json bun.lock $(git diff --name-only)
git commit -m "build(ai): move to @earendil-works/pi-ai and pi-agent-core 0.85

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

(`git diff --name-only` after `git add` of the two manifests lists the rest of the modified files; review the list before committing — it must contain only the files this task touched.)

---

### Task 3: snake_case tool names — code, renderer, settings keys, and the stored-row migration

**Files:**

- Create: `packages/shared/src/constants/tool-names.ts`
- Test: `tests/unit/shared/constants/tool-names.test.ts`
- Modify: the 19 `src/main/lib/ai/calling-tools/*.ts` (`name:` fields), `src/main/lib/ai/utils/tool-binding-util.ts` (keys), `src/main/lib/ai/prompts.ts` (tool mentions), `src/main/lib/db/queries.ts:182`, `packages/shared/src/constants/tools.ts` (`key`), `packages/shared/src/i18n/namespaces.ts` (lines 9, 11), `src/renderer/components/messages.tsx` (`getToolCallPreview` cases + the two `toolName ===` checks), `src/renderer/components/messages-calling-tools.tsx` (27 literals), `src/renderer/components/thinking-timeline.tsx`, `src/renderer/components/web-search/{image-lightbox,video-cards}.tsx`, `src/renderer/components/deep-research/{index,message-item,source-item}.tsx`, `src/renderer/components/settings/settings-form/{computer-use,deep-research}.tsx`, `src/renderer/components/calling-tools/map-itinerary/types.ts`, `packages/shared/src/schemas/settings-schema.ts` (`disabledTools` normalisation), and the renderer/e2e tests that name tools (`tests/unit/renderer/components/{citations-across-turns,message-spinner,messages-rerender}.test.ts`, `tests/unit/renderer/hooks/{busy-reducer,use-chat}.test.ts`)
- Create: `resources/drizzle/0007_snake_case_tool_names.sql` (+ `resources/drizzle/meta/_journal.json` entry)
- Test: `tests/unit/main/lib/db/migrations/0007-tool-names.test.ts`

**Interfaces:**

- Produces:
  - `TOOL_NAMES` — `as const` object, `TOOL_NAMES.webSearch === 'web_search'` etc. (19 entries); `type ToolName = (typeof TOOL_NAMES)[keyof typeof TOOL_NAMES]`.
  - `LEGACY_TOOL_NAMES: Record<string, ToolName>` — the 19 `camelCase → snake_case` pairs (identity pairs included, so every current name is a key).
  - `toToolName(name: string): string` — maps a legacy name, passes anything else through.

- [ ] **Step 1: Write the failing constants test**

`tests/unit/shared/constants/tool-names.test.ts`:

```ts
import {
  LEGACY_TOOL_NAMES,
  TOOL_NAMES,
  toToolName
} from '@actovia/shared/constants/tool-names'
import { describe, expect, it } from 'vitest'

describe('tool names', () => {
  it('are snake_case and unique', () => {
    const values = Object.values(TOOL_NAMES)
    expect(values).toHaveLength(19)
    expect(new Set(values).size).toBe(19)
    for (const v of values) expect(v).toMatch(/^[a-z]+(_[a-z]+)*$/)
  })

  it('maps every legacy camelCase name to its snake_case name', () => {
    expect(toToolName('webSearch')).toBe('web_search')
    expect(toToolName('searchKnowledgeBase')).toBe('search_knowledge_base')
    expect(toToolName('grep')).toBe('grep')
    expect(Object.keys(LEGACY_TOOL_NAMES)).toHaveLength(19)
  })

  it('passes unknown names through (MCP tools are not renamed)', () => {
    expect(toToolName('github_create_issue')).toBe('github_create_issue')
  })
})
```

- [ ] **Step 2: Run it to see it fail**

Run: `bun run test tests/unit/shared/constants/tool-names.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the constants**

`packages/shared/src/constants/tool-names.ts`:

```ts
/**
 * The built-in tools' wire names — what the model calls, what `toolName`
 * holds in the `message` table, what the renderer dispatches on. snake_case
 * since 2026-09; the stored rows were rewritten by migration 0007 and there
 * is no alias layer. Add a tool here, then in `calling-tools/`.
 */
export const TOOL_NAMES = {
  computerUse: 'computer_use',
  deepResearch: 'deep_research',
  createArtifact: 'create_artifact',
  imageGeneration: 'image_generation',
  findFiles: 'find_files',
  editFile: 'edit_file',
  lcmGrep: 'lcm_grep',
  grep: 'grep',
  lcmDescribe: 'lcm_describe',
  searchKnowledgeBase: 'search_knowledge_base',
  mapItinerary: 'map_itinerary',
  webSearch: 'web_search',
  lcmExpand: 'lcm_expand',
  weather: 'weather',
  listDirectory: 'list_directory',
  terminal: 'terminal',
  readFile: 'read_file',
  webFetch: 'web_fetch',
  writeFile: 'write_file'
} as const

export type ToolName = (typeof TOOL_NAMES)[keyof typeof TOOL_NAMES]

/** The names as stored before migration 0007, keyed to their new spelling. */
export const LEGACY_TOOL_NAMES: Record<string, ToolName> = { ...TOOL_NAMES }

/** A legacy name becomes its snake_case name; anything else is unchanged. */
export function toToolName(name: string): string {
  return LEGACY_TOOL_NAMES[name] ?? name
}
```

Add the subpath to `packages/shared/package.json` `exports` if the package lists subpaths explicitly (check `"./constants/*"` — if a wildcard is there, nothing to add).

- [ ] **Step 4: Run the test**

Run: `bun run test tests/unit/shared/constants/tool-names.test.ts`
Expected: PASS.

- [ ] **Step 5: Rename in the main process**

In each of the 19 `src/main/lib/ai/calling-tools/*.ts`, the `name:` field takes the constant, e.g. `web-search.ts`:

```ts
import { TOOL_NAMES } from '@actovia/shared/constants/tool-names'
// ...
name: TOOL_NAMES.webSearch,
```

`src/main/lib/ai/utils/tool-binding-util.ts` — the `enabled('webSearch')` keys become `enabled(TOOL_NAMES.webSearch)` for all 19. `src/main/lib/db/queries.ts:182` — `eq(message.toolName, TOOL_NAMES.createArtifact)`. `src/main/lib/ai/prompts.ts` — every `**webSearch**`, `webSearch`, `imageGeneration`, `searchKnowledgeBase`, `deepResearch`, `mapItinerary`, `createArtifact`, `weather` mention in the prompt text becomes the snake_case name (the prompt is what the model reads; it must match the bound names exactly). `computer-use.ts`'s `details: { error: 'disabled' }` text is unchanged.

- [ ] **Step 6: Rename in shared + renderer**

`packages/shared/src/constants/tools.ts` — each `key:` becomes the `TOOL_NAMES` value (`key: TOOL_NAMES.webSearch`); the `labelKey`/`descriptionKey` i18n keys stay `tools.registry.webSearch.*` (they are catalog keys, not tool names). `packages/shared/src/i18n/namespaces.ts:9,11` — read the two lines: if they name tools as _namespace ids_ (`'computerUse'`, `'webSearch'` are i18n namespaces there), leave them alone — namespaces are not tool names. Only change a line that compares to a `toolName`.

Renderer: replace each literal with the constant — `messages.tsx` (`case 'webSearch'` → `case TOOL_NAMES.webSearch`, the `toolResult.toolName === 'webSearch'` / `'webFetch'` checks, and `toolName: 'webSearch'` in the pushed step), `messages-calling-tools.tsx` (all 27), `thinking-timeline.tsx`, `web-search/image-lightbox.tsx`, `web-search/video-cards.tsx`, `deep-research/{index,message-item,source-item}.tsx`, `settings-form/{computer-use,deep-research}.tsx`, `calling-tools/map-itinerary/types.ts`. Where a file compares `output?.type === 'mapItinerary'` that is a _details_ discriminator, not a tool name — leave it. `capitalCase('web_search')` renders "Web Search", so the display path needs no change.

The renderer/e2e tests listed in **Files** use the same constants in their fixtures (`toolName: TOOL_NAMES.webSearch`).

- [ ] **Step 7: Settings keys**

`settings.tools.disabledTools` holds tool keys. Normalise on read in `packages/shared/src/schemas/settings-schema.ts` so a saved `['webSearch']` still disables `web_search`:

```ts
import { toToolName } from '../constants/tool-names'
// ...
disabledTools: z.array(z.string())
  .default([])
  .transform((keys) => Array.from(new Set(keys.map(toToolName))))
```

Check `ToolsSchema` is used with `.parse`/`safeParse` on the read path (`getSettings()` in `src/main/lib/db/queries.ts`); if the column is read raw, apply `toToolName` where `disabledTools` is consumed (`tool-binding-util.ts`: `new Set((setting.tools?.disabledTools ?? []).map(toToolName))`) instead. The settings page writes the new keys from now on.

- [ ] **Step 8: Typecheck + grep for stragglers**

```bash
bun run typecheck
grep -rnE "'(computerUse|deepResearch|createArtifact|imageGeneration|findFiles|editFile|lcmGrep|lcmDescribe|searchKnowledgeBase|mapItinerary|webSearch|lcmExpand|listDirectory|readFile|webFetch|writeFile)'" src packages/shared/src tests --include=*.ts --include=*.tsx | grep -v "tool-names.ts\|i18n/\|labelKey\|descriptionKey\|namespaces.ts"
```

Expected: no output beyond i18n catalog keys and namespace ids.

- [ ] **Step 9: Write the failing migration test**

`tests/unit/main/lib/db/migrations/0007-tool-names.test.ts` — real in-memory PGlite, the pattern of `tests/unit/main/lib/db/device-queries.test.ts`:

```ts
import { readdirSync, readFileSync } from 'fs'
import { resolve } from 'path'

import { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const DRIZZLE = resolve(
  import.meta.dirname,
  '../../../../../../resources/drizzle'
)

function sql(file: string) {
  return readFileSync(resolve(DRIZZLE, file), 'utf8').replaceAll(
    '--> statement-breakpoint',
    ''
  )
}

let pglite: PGlite

beforeAll(async () => {
  pglite = new PGlite()
  await pglite.waitReady
  // The chat/message tables come from the earliest migrations; apply every
  // file before 0007 in journal order.
  for (const f of [
    '0000_',
    '0001_',
    '0002_',
    '0003_',
    '0004_',
    '0005_',
    '0006_'
  ]) {
    const name = readdirSync(DRIZZLE).find((n) => n.startsWith(f))!
    await pglite.exec(sql(name))
  }
  await pglite.exec(
    `INSERT INTO "chat" ("id","title") VALUES ('11111111-1111-4111-8111-111111111111','t')`
  )
  await pglite.exec(`
    INSERT INTO "message" ("id","chatId","role","content","toolCallId","toolName","isError")
    VALUES
    ('22222222-2222-4222-8222-222222222222','11111111-1111-4111-8111-111111111111','assistant',
     '[{"type":"toolCall","id":"c1","name":"webSearch","arguments":{}},{"type":"toolCall","id":"c2","name":"github_issue","arguments":{}}]', NULL, NULL, NULL),
    ('33333333-3333-4333-8333-333333333333','11111111-1111-4111-8111-111111111111','toolResult',
     '[]', 'c1', 'webSearch', false),
    ('44444444-4444-4444-8444-444444444444','11111111-1111-4111-8111-111111111111','toolResult',
     '[]', 'c2', 'github_issue', false)
  `)
  await pglite.exec(sql('0007_snake_case_tool_names.sql'))
}, 60_000)

afterAll(async () => {
  await pglite.close()
})

describe('migration 0007: snake_case tool names', () => {
  it('rewrites the toolName column on toolResult rows', async () => {
    const { rows } = await pglite.query<{ toolName: string }>(
      `SELECT "toolName" FROM "message" WHERE "role" = 'toolResult' ORDER BY "toolName"`
    )
    expect(rows.map((r) => r.toolName)).toEqual(['github_issue', 'web_search'])
  })

  it('rewrites toolCall block names inside assistant content, leaving MCP names alone', async () => {
    const { rows } = await pglite.query<{ content: Array<{ name: string }> }>(
      `SELECT "content" FROM "message" WHERE "role" = 'assistant'`
    )
    expect(rows[0].content.map((b) => b.name)).toEqual([
      'web_search',
      'github_issue'
    ])
  })
})
```

The earliest migration file names carry drizzle-kit's random suffixes; the loop finds each by its index prefix.

- [ ] **Step 10: Run it to see it fail**

Run: `bun run test tests/unit/main/lib/db/migrations/0007-tool-names.test.ts`
Expected: FAIL — `ENOENT ... 0007_snake_case_tool_names.sql`.

- [ ] **Step 11: Write the migration**

```bash
bunx drizzle-kit generate --custom --name=snake_case_tool_names
```

This adds an empty `resources/drizzle/0007_snake_case_tool_names.sql` and the journal entry. Fill the file:

```sql
-- Built-in tool names moved to snake_case (spec 2026-09-22-chat-kernel-design).
-- 1. The toolName column on toolResult rows.
UPDATE "message" SET "toolName" = CASE "toolName"
  WHEN 'computerUse' THEN 'computer_use'
  WHEN 'deepResearch' THEN 'deep_research'
  WHEN 'createArtifact' THEN 'create_artifact'
  WHEN 'imageGeneration' THEN 'image_generation'
  WHEN 'findFiles' THEN 'find_files'
  WHEN 'editFile' THEN 'edit_file'
  WHEN 'lcmGrep' THEN 'lcm_grep'
  WHEN 'lcmDescribe' THEN 'lcm_describe'
  WHEN 'searchKnowledgeBase' THEN 'search_knowledge_base'
  WHEN 'mapItinerary' THEN 'map_itinerary'
  WHEN 'webSearch' THEN 'web_search'
  WHEN 'lcmExpand' THEN 'lcm_expand'
  WHEN 'listDirectory' THEN 'list_directory'
  WHEN 'readFile' THEN 'read_file'
  WHEN 'webFetch' THEN 'web_fetch'
  WHEN 'writeFile' THEN 'write_file'
  ELSE "toolName" END
WHERE "toolName" IN ('computerUse','deepResearch','createArtifact','imageGeneration','findFiles','editFile','lcmGrep','lcmDescribe','searchKnowledgeBase','mapItinerary','webSearch','lcmExpand','listDirectory','readFile','webFetch','writeFile');
--> statement-breakpoint
-- 2. `name` inside toolCall blocks of assistant content (jsonb array).
UPDATE "message" m SET "content" = (
  SELECT jsonb_agg(
    CASE WHEN block->>'type' = 'toolCall' THEN
      jsonb_set(block, '{name}', to_jsonb(CASE block->>'name'
        WHEN 'computerUse' THEN 'computer_use'
        WHEN 'deepResearch' THEN 'deep_research'
        WHEN 'createArtifact' THEN 'create_artifact'
        WHEN 'imageGeneration' THEN 'image_generation'
        WHEN 'findFiles' THEN 'find_files'
        WHEN 'editFile' THEN 'edit_file'
        WHEN 'lcmGrep' THEN 'lcm_grep'
        WHEN 'lcmDescribe' THEN 'lcm_describe'
        WHEN 'searchKnowledgeBase' THEN 'search_knowledge_base'
        WHEN 'mapItinerary' THEN 'map_itinerary'
        WHEN 'webSearch' THEN 'web_search'
        WHEN 'lcmExpand' THEN 'lcm_expand'
        WHEN 'listDirectory' THEN 'list_directory'
        WHEN 'readFile' THEN 'read_file'
        WHEN 'webFetch' THEN 'web_fetch'
        WHEN 'writeFile' THEN 'write_file'
        ELSE block->>'name' END))
    ELSE block END
    ORDER BY ord)
  FROM jsonb_array_elements(m."content") WITH ORDINALITY AS t(block, ord)
)
WHERE m."role" = 'assistant'
  AND jsonb_typeof(m."content") = 'array'
  AND m."content" @> '[{"type":"toolCall"}]';
--> statement-breakpoint
-- 3. Disabled-tool keys in settings.
UPDATE "settings" SET "tools" = jsonb_set("tools", '{disabledTools}', (
  SELECT COALESCE(jsonb_agg(to_jsonb(CASE k
    WHEN 'computerUse' THEN 'computer_use'
    WHEN 'imageGeneration' THEN 'image_generation'
    WHEN 'findFiles' THEN 'find_files'
    WHEN 'editFile' THEN 'edit_file'
    WHEN 'searchKnowledgeBase' THEN 'search_knowledge_base'
    WHEN 'mapItinerary' THEN 'map_itinerary'
    WHEN 'webSearch' THEN 'web_search'
    WHEN 'listDirectory' THEN 'list_directory'
    WHEN 'readFile' THEN 'read_file'
    WHEN 'webFetch' THEN 'web_fetch'
    WHEN 'writeFile' THEN 'write_file'
    WHEN 'createArtifact' THEN 'create_artifact'
    ELSE k END)), '[]'::jsonb)
  FROM jsonb_array_elements_text("tools"->'disabledTools') AS k
))
WHERE "tools" IS NOT NULL AND jsonb_typeof("tools"->'disabledTools') = 'array';
```

(`grep`, `weather`, `terminal` are unchanged and need no row.) Check the `settings` table's column is literally `"tools"` and the `message` columns are `"toolName"`, `"content"`, `"role"` (camelCase, quoted — see `schema.ts`).

- [ ] **Step 12: Run the migration test**

Run: `bun run test tests/unit/main/lib/db/migrations/0007-tool-names.test.ts`
Expected: PASS (2 tests). If step 2's `ORDER BY ord` inside `jsonb_agg` errors on this PGlite, use `jsonb_agg(... ORDER BY t.ord)` with the alias.

- [ ] **Step 13: Full gate + commit**

```bash
bun run fmt && bun run lint && bun run typecheck && bun run i18n:check && bun run test
git add packages/shared/src/constants/tool-names.ts tests/unit/shared/constants/tool-names.test.ts \
  resources/drizzle/0007_snake_case_tool_names.sql resources/drizzle/meta/_journal.json \
  tests/unit/main/lib/db/migrations/0007-tool-names.test.ts $(git diff --name-only)
git commit -m "refactor(tools): snake_case tool names, with a migration of stored rows

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: `message.runId` — schema, backfill migration, types, and stamping on the current route

**Files:**

- Modify: `src/main/lib/db/schema.ts` (message table), `packages/shared/src/types/chat.ts`, `src/main/lib/server/routes/chat-persistence.ts`, `src/main/lib/server/routes/chat.ts` (stamp `runId` on the new messages), `src/main/lib/server/schemas/chat.ts` (`messageSchema` accepts `runId`)
- Create: `resources/drizzle/0008_message_run_id.sql` (+ journal)
- Test: `tests/unit/main/lib/db/migrations/0008-run-id.test.ts`, `tests/unit/main/lib/server/routes/chat-persistence.test.ts` (extend or create)

**Interfaces:**

- Produces:
  - `message.runId: uuid NOT NULL`, index `message_chat_run_idx (chatId, runId)`.
  - `ChatMessage` (all three variants) gains `runId: string`.
  - `toDbRow(msg, chatId)` writes `runId: msg.runId`.
  - `withRunId(msg: ChatMessage, runId: string): ChatMessage`.

- [ ] **Step 1: Write the failing migration test**

`tests/unit/main/lib/db/migrations/0008-run-id.test.ts` (same harness as 0007's; apply `0000_`…`0007_` first):

```ts
// ... same imports / beforeAll as 0007-tool-names.test.ts, applying files 0000_ … 0007_,
// then seed a chat whose rows form three runs plus one orphan, then apply 0008.
await pglite.exec(
  `INSERT INTO "chat" ("id","title") VALUES ('11111111-1111-4111-8111-111111111111','t')`
)
await pglite.exec(`
  INSERT INTO "message" ("id","chatId","role","content","createdAt") VALUES
  ('a0000000-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111','user','[]','2026-01-01T00:00:00Z'),
  ('a0000000-0000-4000-8000-000000000002','11111111-1111-4111-8111-111111111111','assistant','[]','2026-01-01T00:00:01Z'),
  ('a0000000-0000-4000-8000-000000000003','11111111-1111-4111-8111-111111111111','toolResult','[]','2026-01-01T00:00:02Z'),
  ('a0000000-0000-4000-8000-000000000004','11111111-1111-4111-8111-111111111111','assistant','[]','2026-01-01T00:00:03Z'),
  ('a0000000-0000-4000-8000-000000000005','11111111-1111-4111-8111-111111111111','user','[]','2026-01-01T00:01:00Z'),
  ('a0000000-0000-4000-8000-000000000006','11111111-1111-4111-8111-111111111111','assistant','[]','2026-01-01T00:01:01Z')
`)
// An orphan: an assistant row with no user row before it (a chat imported
// mid-run). It becomes a run of its own.
await pglite.exec(
  `INSERT INTO "chat" ("id","title") VALUES ('22222222-2222-4222-8222-222222222222','o')`
)
await pglite.exec(`
  INSERT INTO "message" ("id","chatId","role","content","createdAt") VALUES
  ('b0000000-0000-4000-8000-000000000001','22222222-2222-4222-8222-222222222222','assistant','[]','2026-01-01T00:00:00Z')
`)
await pglite.exec(sql('0008_message_run_id.sql'))

describe('migration 0008: message.runId', () => {
  it('gives every row of a run the id of its user message', async () => {
    const { rows } = await pglite.query<{ id: string; runId: string }>(
      `SELECT "id","runId" FROM "message" WHERE "chatId" = '11111111-1111-4111-8111-111111111111' ORDER BY "createdAt"`
    )
    expect(rows.map((r) => r.runId)).toEqual([
      'a0000000-0000-4000-8000-000000000001',
      'a0000000-0000-4000-8000-000000000001',
      'a0000000-0000-4000-8000-000000000001',
      'a0000000-0000-4000-8000-000000000001',
      'a0000000-0000-4000-8000-000000000005',
      'a0000000-0000-4000-8000-000000000005'
    ])
  })

  it('an orphan row is its own run', async () => {
    const { rows } = await pglite.query<{ runId: string }>(
      `SELECT "runId" FROM "message" WHERE "id" = 'b0000000-0000-4000-8000-000000000001'`
    )
    expect(rows[0].runId).toBe('b0000000-0000-4000-8000-000000000001')
  })

  it('the column is NOT NULL and indexed with chatId', async () => {
    const { rows } = await pglite.query<{ indexname: string }>(
      `SELECT indexname FROM pg_indexes WHERE tablename = 'message' AND indexname = 'message_chat_run_idx'`
    )
    expect(rows).toHaveLength(1)
    await expect(
      pglite.exec(
        `INSERT INTO "message" ("id","chatId","role","content") VALUES ('c0000000-0000-4000-8000-000000000001','22222222-2222-4222-8222-222222222222','user','[]')`
      )
    ).rejects.toThrow(/null value in column "runId"/)
  })
})
```

- [ ] **Step 2: Run it to see it fail**

Run: `bun run test tests/unit/main/lib/db/migrations/0008-run-id.test.ts`
Expected: FAIL — `ENOENT ... 0008_message_run_id.sql`.

- [ ] **Step 3: Schema change**

`src/main/lib/db/schema.ts`, in the `message` table after `chatId`:

```ts
// The run this row belongs to: the id of the run's user message (the user
// row carries its own id). Context assembly, compaction and the renderer
// all work in runs, never in individual rows. Backfilled by migration 0008.
runId: uuid('runId').notNull(),
```

and in the table's index list:

```ts
index('message_chat_run_idx').on(t.chatId, t.runId),
```

- [ ] **Step 4: Generate, then append the backfill**

```bash
bun run db:generate
```

drizzle-kit names the file itself (`0008_<adjective>_<noun>.sql`); rename both the file and the journal `tag` to `0008_message_run_id` so the test's file name holds. The generated SQL adds a NOT NULL column with no default, which fails on a non-empty table — replace the generated body with:

```sql
ALTER TABLE "message" ADD COLUMN "runId" uuid;
--> statement-breakpoint
-- Backfill: a user row opens a run; every later row in the chat joins it
-- until the next user row. Ties on createdAt put the user row first. A row
-- with no user row before it (imported mid-run) is a run of its own.
UPDATE "message" m SET "runId" = COALESCE((
  SELECT u."id" FROM "message" u
  WHERE u."chatId" = m."chatId" AND u."role" = 'user'
    AND (u."createdAt" < m."createdAt" OR (u."createdAt" = m."createdAt" AND (u."id" = m."id" OR m."role" <> 'user')))
  ORDER BY u."createdAt" DESC LIMIT 1
), m."id")
WHERE m."runId" IS NULL;
--> statement-breakpoint
ALTER TABLE "message" ALTER COLUMN "runId" SET NOT NULL;
--> statement-breakpoint
CREATE INDEX "message_chat_run_idx" ON "message" USING btree ("chatId","runId");
```

Update `resources/drizzle/meta/0008_snapshot.json` only if drizzle-kit refuses the rename (it keys on the journal `tag`; if `bun run db:generate` later reports drift, regenerate once and re-apply the body).

- [ ] **Step 5: Run the migration test**

Run: `bun run test tests/unit/main/lib/db/migrations/0008-run-id.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Types and persistence**

`packages/shared/src/types/chat.ts`:

```ts
export type ChatUserMessage = UserMessage & { id: string; runId: string }
export type ChatAssistantMessage = AssistantMessage & {
  id: string
  runId: string
  cost?: CostBreakdown
  durationMs?: number
}
export type ChatToolResultMessage = ToolResultMessage & {
  id: string
  runId: string
}
```

`src/main/lib/server/routes/chat-persistence.ts`: `stripId` also strips `runId` (`const { id, runId, ...rest } = msg`); `toDbRow`'s `base` gains `runId: msg.runId`; add

```ts
export function withRunId<T extends ChatMessage>(msg: T, runId: string): T {
  return { ...msg, runId }
}
```

`src/main/lib/server/schemas/chat.ts` — `messageSchema` (loose) accepts an optional `runId: z.string().uuid().optional()`; the renderer does not send it yet, the server stamps it.

`src/main/lib/server/routes/chat.ts` (still the old loop — Task 7 replaces it): the run id is `userMessage.id`. Stamp it on the user row (`toDbRow(withRunId(userMessage, userMessage.id), id)`), and on every message pushed to `newMessages` (`finalMsg`, `toolResultMsg`, and the streaming `currentAssistantMsg`) — `runId: userMessage.id` in each object literal.

Renderer: `src/renderer/hooks/use-chat.ts` builds the user message on send — add `runId: message.id` there (its own id). Every renderer test fixture that builds a `ChatMessage` gains `runId` (TypeScript will list them).

- [ ] **Step 7: Persistence test**

Extend (or create) `tests/unit/main/lib/server/routes/chat-persistence.test.ts`:

```ts
it('toDbRow carries runId on every role', () => {
  const runId = '11111111-1111-4111-8111-111111111111'
  const user = {
    id: runId,
    runId,
    role: 'user' as const,
    content: 'hi',
    timestamp: 1
  }
  const assistant = {
    id: '22222222-2222-4222-8222-222222222222',
    runId,
    role: 'assistant' as const,
    content: [],
    api: 'x',
    provider: 'p',
    model: 'm',
    usage: undefined as never,
    stopReason: 'stop' as const,
    timestamp: 2
  }
  expect(toDbRow(user, 'c').runId).toBe(runId)
  expect(toDbRow(assistant, 'c').runId).toBe(runId)
  expect(stripId(user)).not.toHaveProperty('runId')
})
```

Run: `bun run test tests/unit/main/lib/server/routes/chat-persistence.test.ts` → PASS.

- [ ] **Step 8: Gate + commit**

```bash
bun run fmt && bun run lint && bun run typecheck && bun run i18n:check && bun run test
git add src/main/lib/db/schema.ts resources/drizzle/0008_message_run_id.sql resources/drizzle/meta/_journal.json resources/drizzle/meta/0008_snapshot.json \
  packages/shared/src/types/chat.ts src/main/lib/server/routes/chat-persistence.ts src/main/lib/server/routes/chat.ts src/main/lib/server/schemas/chat.ts \
  src/renderer/hooks/use-chat.ts tests/unit/main/lib/db/migrations/0008-run-id.test.ts tests/unit/main/lib/server/routes/chat-persistence.test.ts $(git diff --name-only)
git commit -m "feat(db): message.runId — a run's rows share its user message id

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: Run-aligned context assembly, the invariant, and `freshTailSize` in runs

**Files:**

- Create: `src/main/lib/ai/kernel/invariant.ts`
- Test: `tests/unit/main/lib/ai/kernel/invariant.test.ts`
- Modify: `src/main/lib/ai/context-management/context-assembler.ts`, `src/main/lib/ai/context-management/compaction.ts` (`runLeafPass`), `src/main/lib/ai/context-management/index.ts` (default 6), `src/main/lib/ai/context-management/queries.ts` (`getMessagesByIds`)
- Test: `tests/unit/main/lib/ai/context-management/context-assembler.property.test.ts`
- Modify: `packages/shared/src/schemas/settings-schema.ts:222`, `packages/shared/src/i18n/locales/*/settings.json` (`memory.settings.freshTailSize`), `src/main/lib/server/routes/chat.ts:149,570` and `src/main/lib/jobs/handlers.ts` (default `?? 6`)
- Delete: `src/main/lib/ai/utils/transform-messages.ts`, `tests/unit/main/lib/ai/utils/transform-messages.test.ts`
- Modify: `src/main/lib/server/routes/chat.ts:299-310` (`convertToLlm` uses the invariant instead of `transformMessages`)

**Interfaces:**

- Produces:
  - `dropBrokenRuns(messages: Message[]): { messages: Message[]; dropped: number }` — pure; a "run" for this function is a user message and everything up to the next user message; a run is dropped if it is not opened by a user message (leading non-user rows) or contains a `toolResult` whose `toolCallId` has no `toolCall` earlier in the same run.
  - `assembleContext(chatId, tokenBudget, freshTailRuns)` — same return shape (`AssembledContext`), tail and back-fill in whole runs.
  - `getMessagesByIds(ids: string[])` in `context-management/queries.ts`.

- [ ] **Step 1: Write the failing invariant test**

`tests/unit/main/lib/ai/kernel/invariant.test.ts`:

```ts
import type { Message } from '@earendil-works/pi-ai'
import { dropBrokenRuns } from '@main/lib/ai/kernel/invariant'
import { describe, expect, it } from 'vitest'

const user = (t: string): Message => ({
  role: 'user',
  content: t,
  timestamp: 1
})
const call = (id: string): Message => ({
  role: 'assistant',
  content: [{ type: 'toolCall', id, name: 'weather', arguments: {} }],
  api: 'a',
  provider: 'p',
  model: 'm',
  usage: {} as never,
  stopReason: 'toolUse',
  timestamp: 2
})
const result = (id: string): Message => ({
  role: 'toolResult',
  toolCallId: id,
  toolName: 'weather',
  content: [],
  isError: false,
  timestamp: 3
})
const text = (t: string): Message => ({
  role: 'assistant',
  content: [{ type: 'text', text: t }],
  api: 'a',
  provider: 'p',
  model: 'm',
  usage: {} as never,
  stopReason: 'stop',
  timestamp: 4
})

describe('dropBrokenRuns', () => {
  it('keeps a well-formed conversation untouched', () => {
    const msgs = [
      user('a'),
      call('1'),
      result('1'),
      text('x'),
      user('b'),
      text('y')
    ]
    expect(dropBrokenRuns(msgs)).toEqual({ messages: msgs, dropped: 0 })
  })

  it('drops leading rows that precede the first user message', () => {
    const msgs = [result('9'), text('x'), user('a'), text('y')]
    expect(dropBrokenRuns(msgs)).toEqual({
      messages: [user('a'), text('y')],
      dropped: 1
    })
  })

  it('drops a run whose toolResult has no toolCall before it', () => {
    const msgs = [
      user('a'),
      result('1'),
      text('x'),
      user('b'),
      call('2'),
      result('2')
    ]
    expect(dropBrokenRuns(msgs)).toEqual({
      messages: [user('b'), call('2'), result('2')],
      dropped: 1
    })
  })

  it('returns an empty list when nothing is well-formed', () => {
    expect(dropBrokenRuns([text('x')])).toEqual({ messages: [], dropped: 1 })
  })
})
```

- [ ] **Step 2: Run it to see it fail**

Run: `bun run test tests/unit/main/lib/ai/kernel/invariant.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `kernel/invariant.ts`**

```ts
import type { Message } from '@earendil-works/pi-ai'

/**
 * The one shape a provider accepts: the list starts with a user message, and
 * every tool result follows its tool call. Context assembly builds lists in
 * whole runs so this holds by construction; this is the last line of defence
 * before a request goes out (`convertToLlm`) — a violation drops the whole
 * offending run rather than sending a request that returns a 400
 * (`messages.0.content.5: unexpected tool_use_id`, 2026-09-21).
 */
export function dropBrokenRuns(messages: Message[]): {
  messages: Message[]
  dropped: number
} {
  const kept: Message[] = []
  let dropped = 0
  let run: Message[] = []
  let calls = new Set<string>()
  let broken = false

  const flush = () => {
    if (run.length === 0) return
    if (broken) dropped++
    else kept.push(...run)
    run = []
    calls = new Set()
    broken = false
  }

  for (const m of messages) {
    if (m.role === 'user') {
      flush()
      run.push(m)
      continue
    }
    if (run.length === 0) {
      // Rows before the first user message: not a run at all.
      broken = true
    }
    if (m.role === 'assistant') {
      for (const block of m.content) {
        if (block.type === 'toolCall') calls.add(block.id)
      }
    } else if (m.role === 'toolResult' && !calls.has(m.toolCallId)) {
      broken = true
    }
    run.push(m)
  }
  flush()
  return { messages: kept, dropped }
}
```

Note the summary messages LCM injects are `role: 'user'` (see `summaryToMessage` in `context-assembler.ts`), so a summary opens a run of its own and is always well-formed.

- [ ] **Step 4: Run the invariant test**

Run: `bun run test tests/unit/main/lib/ai/kernel/invariant.test.ts` → PASS (4 tests).

- [ ] **Step 5: Write the failing property test for assembly**

`tests/unit/main/lib/ai/context-management/context-assembler.property.test.ts` — real PGlite, migrations `0000_`…`0008_` applied as in Task 4, then random conversations:

```ts
// imports: PGlite, readdirSync/readFileSync/resolve, vitest, and
//   vi.mock('@main/lib/db/db', ...) with an in-memory PGlite as in device-queries.test.ts
const { assembleContext } =
  await import('@main/lib/ai/context-management/context-assembler')
const { dropBrokenRuns } = await import('@main/lib/ai/kernel/invariant')

// A seeded PRNG so a failure is reproducible from the printed seed.
function rng(seed: number) {
  return () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32
}

async function seedChat(chatId: string, random: () => number, runs: number) {
  await pglite.exec(
    `INSERT INTO "chat" ("id","title") VALUES ('${chatId}','t')`
  )
  let t = 0
  const rows: string[] = []
  for (let r = 0; r < runs; r++) {
    const runId = crypto.randomUUID()
    const at = (n: number) =>
      new Date(Date.UTC(2026, 0, 1, 0, 0, n)).toISOString()
    rows.push(
      `('${runId}','${chatId}','${runId}','user','${JSON.stringify([{ type: 'text', text: 'q'.repeat(1 + Math.floor(random() * 400)) }])}',NULL,NULL,NULL,'${at(t++)}')`
    )
    const steps = Math.floor(random() * 4) // 0-3 tool steps
    for (let s = 0; s < steps; s++) {
      const callId = `call_${r}_${s}`
      rows.push(
        `('${crypto.randomUUID()}','${chatId}','${runId}','assistant','${JSON.stringify([{ type: 'toolCall', id: callId, name: 'weather', arguments: {} }])}',NULL,NULL,NULL,'${at(t++)}')`
      )
      rows.push(
        `('${crypto.randomUUID()}','${chatId}','${runId}','toolResult','${JSON.stringify([{ type: 'text', text: 'r'.repeat(1 + Math.floor(random() * 800)) }])}','${callId}','weather',false,'${at(t++)}')`
      )
    }
    rows.push(
      `('${crypto.randomUUID()}','${chatId}','${runId}','assistant','${JSON.stringify([{ type: 'text', text: 'a'.repeat(1 + Math.floor(random() * 400)) }])}',NULL,NULL,NULL,'${at(t++)}')`
    )
  }
  await pglite.exec(
    `INSERT INTO "message" ("id","chatId","runId","role","content","toolCallId","toolName","isError","createdAt") VALUES ${rows.join(',')}`
  )
}

describe('assembleContext keeps runs whole', () => {
  for (let seed = 1; seed <= 40; seed++) {
    it(`seed ${seed}`, async () => {
      const random = rng(seed)
      const chatId = crypto.randomUUID()
      const runs = 1 + Math.floor(random() * 12)
      await seedChat(chatId, random, runs)
      const budget = 50 + Math.floor(random() * 3000)
      const tail = 1 + Math.floor(random() * 4)
      const { messages } = await assembleContext(chatId, budget, tail)
      expect(messages.length).toBeGreaterThan(0)
      expect(messages[0].role).toBe('user')
      expect(dropBrokenRuns(messages)).toEqual({ messages, dropped: 0 })
      // The fresh tail is always present in full, whatever the budget.
      const lastRunUser = messages.filter((m) => m.role === 'user').at(-1)
      expect(lastRunUser).toBeDefined()
    })
  }
})
```

- [ ] **Step 6: Run it to see it fail**

Run: `bun run test tests/unit/main/lib/ai/context-management/context-assembler.property.test.ts`
Expected: several seeds FAIL (`dropped: 1` — the current byte-budget back-fill breaks inside a run; `messages[0].role` is sometimes `'toolResult'`).

- [ ] **Step 7: Rewrite `assembleContext` in runs**

Add to `src/main/lib/ai/context-management/queries.ts`:

```ts
export async function getMessagesByIds(ids: string[]) {
  if (ids.length === 0) return []
  return db.select().from(message).where(inArray(message.id, ids))
}
```

In `context-assembler.ts`, replace the body after bootstrap with grouping by run. A context item of kind `message` belongs to the run of its message's `runId`; a `summary` item is a run of its own:

```ts
interface RunGroup {
  key: string // runId, or `summary:<id>`
  items: LcmContextItem[]
}

function groupItemsIntoRuns(
  items: LcmContextItem[],
  runIdOf: Map<string, string> // message id → runId
): RunGroup[] {
  const groups: RunGroup[] = []
  for (const item of items) {
    const key =
      item.kind === 'summary'
        ? `summary:${item.refId}`
        : (runIdOf.get(item.refId) ?? `orphan:${item.refId}`)
    const last = groups.at(-1)
    if (last && last.key === key) last.items.push(item)
    else groups.push({ key, items: [item] })
  }
  return groups
}
```

then:

```ts
const messageRows = await getMessagesByIds(
  items.filter((i) => i.kind === 'message').map((i) => i.refId)
)
const rowById = new Map(messageRows.map((m) => [m.id, m]))
const runIdOf = new Map(messageRows.map((m) => [m.id, m.runId]))
const runs = groupItemsIntoRuns(items, runIdOf)

// Fresh tail: the most recent N runs, always included whole.
const freshRuns = runs.slice(-freshTailRuns)
const evictableRuns = runs.slice(0, -freshTailRuns)

const materialize = async (
  group: RunGroup
): Promise<{ messages: Message[]; tokens: number }> => {
  const out: Message[] = []
  let tokens = 0
  for (const item of group.items) {
    if (item.kind === 'message') {
      const row = rowById.get(item.refId)
      if (!row) continue
      tokens += item.tokenCount ?? estimateMessageTokens(row.content)
      out.push(dbMessageToLlmMessage(row))
    } else {
      const [summary] = await getSummariesByIds([item.refId])
      if (!summary) continue
      tokens += item.tokenCount ?? estimateTokens(summary.content)
      out.push(summaryToMessage(summary, await getParentIds(summary.id)))
    }
  }
  return { messages: out, tokens }
}

const fresh = await Promise.all(freshRuns.map(materialize))
const freshTokens = fresh.reduce((n, r) => n + r.tokens, 0)
let remaining = tokenBudget - freshTokens
const prefix: Message[][] = []
let prefixTokens = 0
// Back-fill whole runs, newest first; the first run that does not fit ends it.
for (let i = evictableRuns.length - 1; i >= 0; i--) {
  const run = await materialize(evictableRuns[i])
  if (run.tokens > remaining) break
  remaining -= run.tokens
  prefixTokens += run.tokens
  prefix.unshift(run.messages)
}
return {
  messages: [...prefix.flat(), ...fresh.flatMap((r) => r.messages)],
  totalTokens: prefixTokens + freshTokens,
  trackedMessageIds
}
```

Rename the parameter `freshTailSize` → `freshTailRuns` in `assembleContext` and `LcmManager` (`this.freshTailRuns`, default **6**). The `dbMessageToLlmMessage` row type gains `runId: string`. Delete the now-unused `getMessageById` import from this file if nothing else uses it here.

- [ ] **Step 8: Compaction chunks on run boundaries**

`compaction.ts` `runLeafPass(chatId, model, apiKey, freshTailRuns)`: build the same `RunGroup[]` (export `groupItemsIntoRuns` from `context-assembler.ts` and reuse it with `getMessagesByIds`), take `runs.slice(0, -freshTailRuns)` as compactable, and accumulate **whole runs** into the chunk: a run whose tokens would push the chunk past `LEAF_CHUNK_TOKENS` ends the chunk, unless the chunk is empty (then that run is the chunk on its own — a run is summarized whole or kept whole, never split). The rest of the pass (`chunkMessages`, the summary call, `replaceContextRange` over the chunk's first…last ordinal) is unchanged.

- [ ] **Step 9: Run the property test and the existing LCM tests**

Run: `bun run test tests/unit/main/lib/ai/context-management/`
Expected: all 40 seeds PASS; `index.test.ts` and any compaction tests pass after their `freshTailSize` arguments are read as runs (adjust fixture numbers where a test asserted "16 messages kept").

- [ ] **Step 10: `freshTailSize` means runs**

`packages/shared/src/schemas/settings-schema.ts:222`: `freshTailSize: formNumber(z.number().gte(2).lte(24)).nullish()`. Defaults `?? 16` → `?? 6` in `src/main/lib/server/routes/chat.ts` (both places) and wherever `LcmManager`/the `lcm-post-turn` payload defaults it (`src/main/lib/jobs/handlers.ts` passes it through; `src/main/lib/ai/context-management/index.ts:52` → `?? 6`). A stored value above 24 (an old "16 messages" setting) is clamped by the schema's `max`; check `formNumber` clamps rather than rejects — if it rejects, add `.catch(6)`.

`packages/shared/src/i18n/locales/en/settings.json` `memory.settings.freshTailSize`:

```json
"freshTailSize": {
  "label": "Fresh tail size",
  "description": "Number of recent runs — a message of yours with every model step and tool result that answered it — protected from compaction (2-24). They are always sent to the model verbatim. Default: 6."
}
```

and the same key translated in the other nine locale files (`de`, `es`, `fr`, `ja`, `ko`, `pt`, `ru`, `zh-CN`, `zh-TW` — check `packages/shared/src/i18n/locales/` for the exact ids). `bun run i18n:check` must pass.

- [ ] **Step 11: Delete `transform-messages.ts`; `convertToLlm` asserts the invariant**

```bash
git rm src/main/lib/ai/utils/transform-messages.ts tests/unit/main/lib/ai/utils/transform-messages.test.ts
```

`src/main/lib/server/routes/chat.ts:299-310`:

```ts
convertToLlm: (agentMessages: AgentMessage[]): Message[] => {
  const messages = agentMessages.filter(
    (m): m is Message =>
      (m as Message).role === 'user' ||
      (m as Message).role === 'assistant' ||
      (m as Message).role === 'toolResult'
  )
  const { messages: safe, dropped } = dropBrokenRuns(messages)
  if (dropped > 0) {
    logger.error(
      'chat',
      'Dropped runs that would have broken the provider request',
      {
        chatId: id,
        dropped
      }
    )
  }
  return safe
}
```

(import `dropBrokenRuns` from `../../ai/kernel/invariant`). Update `tests/unit/main/lib/server/routes/chat.test.ts` where it asserted on `transformMessages` (mock removed; assert that the request's messages pass `dropBrokenRuns` unchanged instead). Grep `transformMessages` → no results.

- [ ] **Step 12: Gate + commit**

```bash
bun run fmt && bun run lint && bun run typecheck && bun run i18n:check && bun run test
git add src/main/lib/ai/kernel/invariant.ts tests/unit/main/lib/ai/kernel/invariant.test.ts \
  src/main/lib/ai/context-management/ tests/unit/main/lib/ai/context-management/ \
  packages/shared/src/schemas/settings-schema.ts packages/shared/src/i18n/locales/ \
  src/main/lib/server/routes/chat.ts src/main/lib/jobs/handlers.ts tests/unit/main/lib/server/routes/chat.test.ts $(git diff --name-only)
git commit -m "fix(lcm): assemble context in whole runs, and assert it before every request

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: The kernel — `runAgent()` and `RunRecorder` on pi's `Agent`

**Files:**

- Create: `src/main/lib/ai/kernel/events.ts`, `src/main/lib/ai/kernel/run.ts`, `src/main/lib/ai/kernel/record.ts`
- Test: `tests/unit/main/lib/ai/kernel/run.test.ts`, `tests/unit/main/lib/ai/kernel/record.test.ts`

**Interfaces:**

- Consumes: `streamFn`, `registerFauxProvider` (Task 1); `dropBrokenRuns` (Task 5); `ChatMessage` with `runId` (Task 4); `toDbRow`, `saveMessages`, `enqueueAndProcess`, `logEnqueueFailure`, `calculateCost`, `extractToolErrorMessage`, `isEmptyAssistantTurn`, `EMPTY_TURN_MESSAGE` (existing).
- Produces (`events.ts`):

```ts
export type KernelEvent =
  | { type: 'message_update'; runId: string; message: ChatAssistantMessage }
  | { type: 'message_end'; runId: string; message: ChatAssistantMessage }
  | {
      type: 'tool_start'
      runId: string
      toolCallId: string
      toolName: string
      messageId: string
    }
  | { type: 'tool_update'; runId: string; message: ChatToolResultMessage }
  | { type: 'tool_end'; runId: string; message: ChatToolResultMessage }
  | {
      type: 'run_end'
      runId: string
      messages: ChatMessage[]
      durationMs: number
    }
  | { type: 'error'; runId: string; error: string }
```

- Produces (`run.ts`):

```ts
export interface RunInput {
  chatId: string
  userMessage: ChatUserMessage // runId === id
  systemPrompt: string
  contextMessages: Message[] // from assembleContext, without the user message
  tools: AgentTool[]
  model: Model<string>
  apiKey: string
  reasoning?: ThinkingLevel
  signal?: AbortSignal
  /** Tools disabled in settings — a call to one is blocked before it runs. */
  disabledTools?: ReadonlySet<string>
}
export function runAgent(input: RunInput): AsyncIterable<KernelEvent>
```

- Produces (`record.ts`):

```ts
export interface RecorderDeps {
  chatId: string
  model: Model<string>
  apiKey: string
  lcm: { freshTailRuns: number; contextWindowPercent: number } | null
  memoryCapture: boolean
  indexMessage: (row: ReturnType<typeof toDbRow>) => void
  priorMessages: ChatMessage[] // for the memory-consolidate payload
}
export class RunRecorder {
  constructor(deps: RecorderDeps)
  observe(event: KernelEvent): void // accumulates completed messages
  get messages(): ChatMessage[]
  persist(): Promise<void> // saves rows, enqueues jobs; idempotent
}
```

- [ ] **Step 1: Write the failing `runAgent` tests**

`tests/unit/main/lib/ai/kernel/run.test.ts`:

```ts
import type { AgentTool } from '@earendil-works/pi-agent-core'
import {
  fauxAssistantMessage,
  fauxText,
  fauxToolCall,
  Type
} from '@earendil-works/pi-ai'
import type { KernelEvent } from '@main/lib/ai/kernel/events'
import { registerFauxProvider } from '@main/lib/ai/kernel/faux'
import { runAgent, type RunInput } from '@main/lib/ai/kernel/run'
import { describe, expect, it } from 'vitest'

const weather: AgentTool = {
  name: 'weather',
  label: 'Weather',
  description: 'test',
  parameters: Type.Object({ location: Type.String() }),
  execute: async (_id, { location }) => ({
    content: [{ type: 'text', text: `sunny in ${location}` }],
    details: { location }
  })
}

const RUN_ID = '11111111-1111-4111-8111-111111111111'

function input(over: Partial<RunInput> = {}): RunInput {
  const faux = registerFauxProvider()
  return {
    chatId: 'c',
    userMessage: {
      id: RUN_ID,
      runId: RUN_ID,
      role: 'user',
      content: 'hi',
      timestamp: 1
    },
    systemPrompt: 'sys',
    contextMessages: [],
    tools: [weather],
    model: faux.getModel(),
    apiKey: 'k',
    ...over,
    // expose the handle for scripting
    ...({ faux } as object)
  }
}

async function collect(it: AsyncIterable<KernelEvent>) {
  const out: KernelEvent[] = []
  for await (const e of it) out.push(e)
  return out
}

describe('runAgent', () => {
  it('a plain answer: message_update*, message_end, run_end — all with runId', async () => {
    const faux = registerFauxProvider()
    faux.setResponses([fauxAssistantMessage([fauxText('hello')])])
    const events = await collect(
      runAgent({ ...input(), model: faux.getModel() })
    )
    expect(events.every((e) => e.runId === RUN_ID)).toBe(true)
    expect(events.map((e) => e.type)).toEqual(
      expect.arrayContaining(['message_update', 'message_end', 'run_end'])
    )
    const end = events.find((e) => e.type === 'run_end')!
    expect(end.type === 'run_end' && end.messages.map((m) => m.role)).toEqual([
      'assistant'
    ])
  })

  it('a tool step: tool_start → tool_end, then the final text, one assistant message per step', async () => {
    const faux = registerFauxProvider()
    faux.setResponses([
      fauxAssistantMessage(
        [fauxToolCall('weather', { location: 'Oslo' }, { id: 'call_1' })],
        { stopReason: 'toolUse' }
      ),
      fauxAssistantMessage([fauxText('It is sunny in Oslo.')])
    ])
    const events = await collect(
      runAgent({ ...input(), model: faux.getModel() })
    )
    const types = events.map((e) => e.type)
    expect(types.indexOf('tool_start')).toBeLessThan(types.indexOf('tool_end'))
    const toolEnd = events.find((e) => e.type === 'tool_end')!
    expect(toolEnd.type === 'tool_end' && toolEnd.message).toMatchObject({
      role: 'toolResult',
      toolCallId: 'call_1',
      toolName: 'weather',
      runId: RUN_ID,
      isError: false,
      content: [{ type: 'text', text: 'sunny in Oslo' }],
      details: { location: 'Oslo' }
    })
    const end = events.at(-1)!
    expect(end.type === 'run_end' && end.messages.map((m) => m.role)).toEqual([
      'assistant',
      'toolResult',
      'assistant'
    ])
  })

  it('a disabled tool is blocked before it runs and the model is told why', async () => {
    const faux = registerFauxProvider()
    faux.setResponses([
      fauxAssistantMessage(
        [fauxToolCall('weather', { location: 'Oslo' }, { id: 'call_1' })],
        { stopReason: 'toolUse' }
      ),
      fauxAssistantMessage([fauxText('ok')])
    ])
    const events = await collect(
      runAgent({
        ...input(),
        model: faux.getModel(),
        disabledTools: new Set(['weather'])
      })
    )
    const toolEnd = events.find((e) => e.type === 'tool_end')!
    expect(toolEnd.type === 'tool_end' && toolEnd.message.isError).toBe(true)
    expect(
      toolEnd.type === 'tool_end' && toolEnd.message.content[0]
    ).toMatchObject({
      type: 'text',
      text: expect.stringMatching(/disabled in settings/i)
    })
  })

  it('a provider error ends the run with an error event after the steps that completed', async () => {
    const faux = registerFauxProvider()
    faux.setResponses([
      fauxAssistantMessage(
        [fauxToolCall('weather', { location: 'Oslo' }, { id: 'call_1' })],
        { stopReason: 'toolUse' }
      ),
      fauxAssistantMessage([], {
        stopReason: 'error',
        errorMessage: 'HTTP 429: rate limited'
      })
    ])
    const events = await collect(
      runAgent({ ...input(), model: faux.getModel() })
    )
    const types = events.map((e) => e.type)
    expect(types).toContain('tool_end')
    expect(types.at(-1)).toBe('error')
    const err = events.at(-1)!
    expect(err.type === 'error' && err.error).toMatch(/429/)
    // run_end still precedes error so the recorder persists the completed steps
    expect(types.indexOf('run_end')).toBeLessThan(types.indexOf('error'))
    const end = events.find((e) => e.type === 'run_end')!
    expect(end.type === 'run_end' && end.messages.map((m) => m.role)).toEqual([
      'assistant',
      'toolResult'
    ])
  })

  it('an empty non-aborted answer is an error, an aborted one is not', async () => {
    const faux = registerFauxProvider()
    faux.setResponses([fauxAssistantMessage([], { stopReason: 'stop' })])
    const events = await collect(
      runAgent({ ...input(), model: faux.getModel() })
    )
    expect(events.at(-1)?.type).toBe('error')

    faux.setResponses([fauxAssistantMessage([], { stopReason: 'aborted' })])
    const aborted = await collect(
      runAgent({ ...input(), model: faux.getModel() })
    )
    expect(aborted.at(-1)?.type).toBe('run_end')
    expect(
      aborted.at(-1)!.type === 'run_end' && aborted.at(-1)!.messages
    ).toEqual([])
  })

  it('abort via the signal ends the run with the partial assistant message marked aborted', async () => {
    const faux = registerFauxProvider({ tokensPerSecond: 5 })
    faux.setResponses([
      fauxAssistantMessage([
        fauxText('a long answer that streams slowly over many tokens')
      ])
    ])
    const controller = new AbortController()
    const events: KernelEvent[] = []
    for await (const e of runAgent({
      ...input(),
      model: faux.getModel(),
      signal: controller.signal
    })) {
      events.push(e)
      if (e.type === 'message_update') controller.abort()
    }
    const end = events.find((e) => e.type === 'run_end')!
    expect(end.type === 'run_end' && end.messages.at(-1)).toMatchObject({
      role: 'assistant',
      stopReason: 'aborted'
    })
  })
})
```

(Clean up `input()`'s handle-smuggling: the tests above always pass `model: faux.getModel()` explicitly; drop the `faux` spread so the helper is plain.)

- [ ] **Step 2: Run it to see it fail**

Run: `bun run test tests/unit/main/lib/ai/kernel/run.test.ts` → FAIL, module not found.

- [ ] **Step 3: Write `events.ts` and `run.ts`**

`events.ts` — the union above, importing `ChatAssistantMessage`, `ChatMessage`, `ChatToolResultMessage` from `@actovia/shared/types/chat`.

`run.ts`:

```ts
import type {
  ChatAssistantMessage,
  ChatMessage,
  ChatToolResultMessage,
  ChatUserMessage
} from '@actovia/shared/types/chat'
import {
  Agent,
  type AgentEvent,
  type AgentMessage,
  type AgentTool
} from '@earendil-works/pi-agent-core'
import type {
  AssistantMessage,
  Message,
  Model,
  ThinkingLevel
} from '@earendil-works/pi-ai'
import { v4 as uuidV4 } from 'uuid'

import { logger } from '../../logger'
import {
  EMPTY_TURN_MESSAGE,
  extractToolErrorMessage,
  isEmptyAssistantTurn
} from '../../server/routes/chat-errors'
import { calculateCost } from '../utils/cost'
import type { KernelEvent } from './events'
import { dropBrokenRuns } from './invariant'
import { streamFn } from './models'

export interface RunInput {
  /* as in Interfaces */
}

/** Every message on the wire and in the database carries the run it belongs to. */
function toAssistant(
  m: AssistantMessage,
  id: string,
  runId: string,
  model: Model<string>
): ChatAssistantMessage {
  return {
    id,
    runId,
    role: 'assistant',
    content: m.content,
    usage: m.usage,
    cost: calculateCost(m.usage, model),
    api: m.api,
    provider: m.provider,
    model: m.model,
    stopReason: m.stopReason,
    errorMessage: m.errorMessage,
    timestamp: m.timestamp ?? Date.now()
  }
}

const LLM_ROLES = new Set(['user', 'assistant', 'toolResult'])

export async function* runAgent(input: RunInput): AsyncIterable<KernelEvent> {
  const runId = input.userMessage.id
  const startedAt = Date.now()
  const queue: KernelEvent[] = []
  let wake: (() => void) | null = null
  const push = (e: KernelEvent) => {
    queue.push(e)
    wake?.()
    wake = null
  }

  // Completed messages of this run, in order.
  const done: ChatMessage[] = []
  let assistantId = uuidV4()
  let streaming: ChatAssistantMessage | null = null
  const toolMsgIds = new Map<string, string>()
  let failure: string | null = null

  const agent = new Agent({
    initialState: {
      systemPrompt: input.systemPrompt,
      model: input.model,
      thinkingLevel: input.reasoning,
      tools: input.tools,
      messages: input.contextMessages as AgentMessage[]
    },
    streamFn,
    getApiKey: () => input.apiKey,
    convertToLlm: (messages) => {
      const llm = messages.filter((m): m is Message =>
        LLM_ROLES.has((m as Message).role)
      )
      const { messages: safe, dropped } = dropBrokenRuns(llm)
      if (dropped > 0) {
        logger.error(
          'kernel',
          'Dropped runs that would have broken the provider request',
          { chatId: input.chatId, runId, dropped }
        )
      }
      return safe
    },
    beforeToolCall: async ({ toolCall }) =>
      input.disabledTools?.has(toolCall.name)
        ? {
            block: true,
            reason: `The ${toolCall.name} tool is disabled in settings.`
          }
        : undefined
  })

  const unsubscribe = agent.subscribe((event: AgentEvent) => {
    switch (event.type) {
      case 'message_update': {
        const m = event.message as Message
        if (m.role !== 'assistant') return
        streaming = toAssistant(m, assistantId, runId, input.model)
        push({ type: 'message_update', runId, message: streaming })
        return
      }
      case 'message_end': {
        const m = event.message as Message
        if (m.role !== 'assistant') return
        if (m.stopReason === 'error') {
          failure =
            m.errorMessage || 'The model returned an error without details.'
          streaming = null
          return
        }
        if (isEmptyAssistantTurn(m)) {
          if (m.stopReason !== 'aborted') failure = EMPTY_TURN_MESSAGE
          streaming = null
          return
        }
        const final = toAssistant(m, assistantId, runId, input.model)
        done.push(final)
        push({ type: 'message_end', runId, message: final })
        assistantId = uuidV4()
        streaming = null
        return
      }
      case 'tool_execution_start': {
        const messageId = uuidV4()
        toolMsgIds.set(event.toolCallId, messageId)
        push({
          type: 'tool_start',
          runId,
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          messageId
        })
        return
      }
      case 'tool_execution_update': {
        const partial = event.partialResult as {
          content?: ChatToolResultMessage['content']
          details?: unknown
        } | null
        push({
          type: 'tool_update',
          runId,
          message: {
            id: toolMsgIds.get(event.toolCallId) ?? uuidV4(),
            runId,
            role: 'toolResult',
            toolCallId: event.toolCallId,
            toolName: event.toolName,
            content: Array.isArray(partial?.content) ? partial.content : [],
            details: partial?.details ?? null,
            isError: false,
            timestamp: Date.now()
          }
        })
        return
      }
      case 'tool_execution_end': {
        const message = toToolResult(
          event,
          toolMsgIds.get(event.toolCallId) ?? uuidV4(),
          runId
        )
        toolMsgIds.delete(event.toolCallId)
        done.push(message)
        push({ type: 'tool_end', runId, message })
        return
      }
      default:
        return
    }
  })

  let finished = false
  const onAbort = () => agent.abort()
  input.signal?.addEventListener('abort', onAbort, { once: true })
  const running = agent
    .prompt(stripForAgent(input.userMessage))
    .catch((err: unknown) => {
      failure = err instanceof Error ? err.message : String(err)
    })
    .finally(() => {
      finished = true
      wake?.()
      wake = null
    })

  try {
    while (true) {
      while (queue.length > 0) yield queue.shift()!
      if (finished) break
      await new Promise<void>((r) => {
        wake = r
      })
    }
    // An abort leaves the streaming message unfinished: keep it, marked.
    if (streaming && input.signal?.aborted) {
      done.push({ ...streaming, stopReason: 'aborted' })
    }
    yield {
      type: 'run_end',
      runId,
      messages: done,
      durationMs: Date.now() - startedAt
    }
    if (failure) yield { type: 'error', runId, error: failure }
  } finally {
    input.signal?.removeEventListener('abort', onAbort)
    unsubscribe()
    await running
  }
}
```

with the two helpers, moved from `chat.ts:415-471` verbatim except for the `runId`:

```ts
function toToolResult(
  event: Extract<AgentEvent, { type: 'tool_execution_end' }>,
  id: string,
  runId: string
): ChatToolResultMessage {
  const errorMessage = event.isError
    ? extractToolErrorMessage(event.result)
    : null
  const details =
    !event.isError &&
    event.result &&
    typeof event.result === 'object' &&
    'details' in event.result
      ? (event.result as { details: unknown }).details
      : event.isError
        ? null
        : event.result
  const resultObj = event.result as {
    content?: Array<{ type: string; text?: string }>
  } | null
  const hasContentArray =
    resultObj &&
    typeof resultObj === 'object' &&
    'content' in resultObj &&
    Array.isArray(resultObj.content)
  const content: ChatToolResultMessage['content'] = hasContentArray
    ? (resultObj.content as ChatToolResultMessage['content'])
    : errorMessage
      ? [{ type: 'text', text: errorMessage }]
      : details
        ? [
            {
              type: 'text',
              text:
                typeof details === 'string' ? details : JSON.stringify(details)
            }
          ]
        : []
  return {
    id,
    runId,
    role: 'toolResult',
    toolCallId: event.toolCallId,
    toolName: event.toolName,
    content,
    details,
    isError: event.isError,
    timestamp: Date.now()
  }
}

function stripForAgent(msg: ChatUserMessage): AgentMessage {
  const { id: _id, runId: _runId, ...rest } = msg
  return rest as AgentMessage
}
```

`thinkingLevel: input.reasoning` — check `AgentState.thinkingLevel` is required in `initialState` (it is `Partial<...>`, so `undefined` is fine). If pi's `Agent` rejects a blocked tool by throwing rather than producing an error tool result, read `node_modules/@earendil-works/pi-agent-core/dist/agent-loop.js` for how `beforeToolCall`'s `{ block, reason }` is surfaced (it becomes an `isError` tool result whose text is `reason`) and match the test to what it actually emits.

- [ ] **Step 4: Run the tests**

Run: `bun run test tests/unit/main/lib/ai/kernel/run.test.ts` → PASS (6 tests). The abort test depends on faux streaming slowly (`tokensPerSecond`); if the faux provider emits the whole message at once, replace the `message_update` trigger with aborting from a `tool_start` event on a two-step script instead.

- [ ] **Step 5: Write the failing `RunRecorder` test**

`tests/unit/main/lib/ai/kernel/record.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

const saveMessages = vi.fn(async () => undefined)
const enqueueAndProcess = vi.fn(async () => undefined)
vi.mock('@main/lib/db/queries', () => ({ saveMessages }))
vi.mock('@main/lib/jobs/worker', () => ({
  enqueueAndProcess,
  logEnqueueFailure: vi.fn()
}))

const { RunRecorder } = await import('@main/lib/ai/kernel/record')

const RUN_ID = '11111111-1111-4111-8111-111111111111'
const model = { id: 'm', provider: 'faux' } as never

function recorder(over = {}) {
  return new RunRecorder({
    chatId: 'c',
    model,
    apiKey: 'k',
    lcm: { freshTailRuns: 6, contextWindowPercent: 75 },
    memoryCapture: true,
    indexMessage: vi.fn(),
    priorMessages: [
      { id: RUN_ID, runId: RUN_ID, role: 'user', content: 'hi', timestamp: 1 }
    ],
    ...over
  })
}

const assistant = {
  id: 'a1',
  runId: RUN_ID,
  role: 'assistant' as const,
  content: [{ type: 'text' as const, text: 'x' }],
  api: 'a',
  provider: 'p',
  model: 'm',
  usage: {} as never,
  stopReason: 'stop' as const,
  timestamp: 2
}

beforeEach(() => {
  saveMessages.mockClear()
  enqueueAndProcess.mockClear()
})

describe('RunRecorder', () => {
  it('persists the run_end messages with durationMs on the last assistant message and enqueues the jobs', async () => {
    const r = recorder()
    r.observe({
      type: 'run_end',
      runId: RUN_ID,
      messages: [assistant],
      durationMs: 1234
    })
    await r.persist()
    expect(saveMessages).toHaveBeenCalledTimes(1)
    const rows = saveMessages.mock.calls[0][0].messages
    expect(rows[0]).toMatchObject({ id: 'a1', runId: RUN_ID, durationMs: 1234 })
    expect(enqueueAndProcess).toHaveBeenCalledWith(
      'lcm-post-turn',
      expect.objectContaining({ chatId: 'c', freshTailRuns: 6 })
    )
    expect(enqueueAndProcess).toHaveBeenCalledWith(
      'memory-consolidate',
      expect.objectContaining({
        messages: expect.arrayContaining([
          expect.objectContaining({ role: 'user' })
        ])
      })
    )
  })

  it('persists nothing when the run produced nothing', async () => {
    const r = recorder()
    r.observe({ type: 'run_end', runId: RUN_ID, messages: [], durationMs: 5 })
    await r.persist()
    expect(saveMessages).not.toHaveBeenCalled()
    expect(enqueueAndProcess).not.toHaveBeenCalled()
  })

  it('persist is idempotent', async () => {
    const r = recorder()
    r.observe({
      type: 'run_end',
      runId: RUN_ID,
      messages: [assistant],
      durationMs: 1
    })
    await r.persist()
    await r.persist()
    expect(saveMessages).toHaveBeenCalledTimes(1)
  })

  it('skips LCM and memory jobs when they are off', async () => {
    const r = recorder({ lcm: null, memoryCapture: false })
    r.observe({
      type: 'run_end',
      runId: RUN_ID,
      messages: [assistant],
      durationMs: 1
    })
    await r.persist()
    expect(saveMessages).toHaveBeenCalledTimes(1)
    expect(enqueueAndProcess).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 6: Run it to see it fail** → FAIL, module not found.

- [ ] **Step 7: Write `record.ts`**

```ts
import type {
  ChatAssistantMessage,
  ChatMessage
} from '@actovia/shared/types/chat'
import type { Model } from '@earendil-works/pi-ai'

import { saveMessages } from '../../db/queries'
import { enqueueAndProcess, logEnqueueFailure } from '../../jobs/worker'
import { toDbRow } from '../../server/routes/chat-persistence'
import type { KernelEvent } from './events'

export interface RecorderDeps {
  /* as in Interfaces */
}

/**
 * What `chat.ts`'s `persistTurn` used to do, as an object the route can call
 * from its `finally`: the run's completed messages are saved however it ended
 * (done, provider error, Stop), stamped with the run's duration, then the
 * post-run jobs go on the queue.
 */
export class RunRecorder {
  private done: ChatMessage[] = []
  private durationMs = 0
  private persisted = false

  constructor(private readonly deps: RecorderDeps) {}

  observe(event: KernelEvent): void {
    if (event.type === 'run_end') {
      this.done = event.messages
      this.durationMs = event.durationMs
    }
  }

  get messages(): ChatMessage[] {
    return this.done
  }

  async persist(): Promise<void> {
    if (this.persisted || this.done.length === 0) return
    this.persisted = true
    const {
      chatId,
      model,
      apiKey,
      lcm,
      memoryCapture,
      indexMessage,
      priorMessages
    } = this.deps

    for (let i = this.done.length - 1; i >= 0; i--) {
      if (this.done[i].role === 'assistant') {
        ;(this.done[i] as ChatAssistantMessage).durationMs ??= this.durationMs
        break
      }
    }
    const rows = this.done.map((m) => toDbRow(m, chatId))
    await saveMessages({ messages: rows })
    rows.forEach(indexMessage)

    if (lcm) {
      enqueueAndProcess('lcm-post-turn', {
        chatId,
        model,
        apiKey,
        freshTailRuns: lcm.freshTailRuns,
        contextWindowPercent: lcm.contextWindowPercent,
        newMessages: this.done.map((m) => ({ id: m.id, content: m.content }))
      }).catch((error) => logEnqueueFailure('lcm-post-turn', error))
    }
    if (memoryCapture) {
      enqueueAndProcess('memory-consolidate', {
        messages: [...priorMessages, ...this.done].map((m) => ({
          role: m.role,
          content: m.content
        })),
        model,
        apiKey
      }).catch((error) => logEnqueueFailure('memory-consolidate', error))
    }
  }
}
```

Rename the `lcm-post-turn` payload field `freshTailSize` → `freshTailRuns` in `src/main/lib/jobs/handlers.ts` (`LcmPostTurnPayload` and the handler) and its test.

- [ ] **Step 8: Run both kernel tests**

Run: `bun run test tests/unit/main/lib/ai/kernel/` → PASS.

- [ ] **Step 9: Commit**

```bash
bun run fmt && bun run lint && bun run typecheck && bun run test
git add src/main/lib/ai/kernel/ tests/unit/main/lib/ai/kernel/ src/main/lib/jobs/handlers.ts tests/unit/main/lib/jobs/handlers.test.ts
git commit -m "feat(kernel): runAgent() on pi's Agent, and RunRecorder

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: `chat.ts` on the kernel

**Files:**

- Modify: `src/main/lib/server/routes/chat.ts` (lines 247–591 replaced), `packages/shared/src/types/chat.ts` (`ChatSseEvent` unchanged in shape; document `runId` on messages)
- Test: `tests/unit/main/lib/server/routes/chat.test.ts`

**Interfaces:**

- Consumes: `runAgent`, `RunRecorder`, `KernelEvent` (Task 6); `withRunId` (Task 4).
- Produces: the same SSE events as today — `message_update` (assistant snapshots coalesced via `sse.queueUpdate`; tool results sent via `sse.send`), `tool_call_start`, `tool_call_end`, `notice`, `title`, `done`, `error` — every message carrying `runId`.

- [ ] **Step 1: Extend the route test with a faux-provider end-to-end case**

In `tests/unit/main/lib/server/routes/chat.test.ts`, add (keeping the file's existing mocks for db/queries, jobs and settings):

```ts
it('streams a tool run as SSE, every message stamped with the run id, and persists once', async () => {
  const faux = registerFauxProvider()
  faux.setResponses([
    fauxAssistantMessage(
      [fauxToolCall('weather', { location: 'Oslo' }, { id: 'call_1' })],
      { stopReason: 'toolUse' }
    ),
    fauxAssistantMessage([fauxText('Sunny.')])
  ])
  // getModelFromProvider is mocked in this file to return { model: faux.getModel(), apiKey: 'k' }
  const userId = '11111111-1111-4111-8111-111111111111'
  const res = await app.request('/api/v1/chat', {
    method: 'POST',
    body: JSON.stringify({
      id: chatId,
      messages: [
        { id: userId, role: 'user', content: 'weather in Oslo', timestamp: 1 }
      ],
      advancedTools: []
    }),
    headers: { 'content-type': 'application/json' }
  })
  const events = await readSse(res) // existing helper in this file, or split on '\n\n' and JSON.parse the `data:` lines
  const done = events.find((e) => e.type === 'done')!
  expect(done.messages.every((m) => m.runId === userId)).toBe(true)
  expect(done.messages.map((m) => m.role)).toEqual([
    'user',
    'assistant',
    'toolResult',
    'assistant'
  ])
  expect(events.map((e) => e.type)).toEqual(
    expect.arrayContaining([
      'tool_call_start',
      'tool_call_end',
      'message_update',
      'done'
    ])
  )
  expect(saveMessages).toHaveBeenCalledTimes(2) // the user row, then the run's rows
})
```

Run it → FAIL (the old loop does not stamp `runId` on every message / `weather` is not bound in the test's tool set — bind it by mocking `bindCallingTools` to return `[weather]` as the file's other tests do).

- [ ] **Step 2: Replace the stream body**

`chat.ts` from `// Build SSE streaming response` to the end of the `ReadableStream` becomes:

```ts
const disabledTools = new Set(setting.tools?.disabledTools ?? [])
if (!setting.computerUse?.enabled) disabledTools.add(TOOL_NAMES.computerUse)

const recorder = new RunRecorder({
  chatId: id,
  model,
  apiKey,
  lcm: lcm
    ? {
        freshTailRuns: memoryConfig?.freshTailSize ?? 6,
        contextWindowPercent: memoryConfig?.contextWindowPercent ?? 75
      }
    : null,
  memoryCapture,
  indexMessage,
  priorMessages: allMessages
})

const stream = new ReadableStream({
  async start(controller) {
    const sse = createSseWriter(controller)
    try {
      const events = runAgent({
        chatId: id,
        userMessage: withRunId(userMessage, userMessage.id),
        systemPrompt: systemContent,
        contextMessages,
        tools,
        model,
        apiKey,
        reasoning: effectiveReasoning,
        signal: c.req.raw.signal,
        disabledTools
      })
      for await (const event of events) {
        recorder.observe(event)
        switch (event.type) {
          case 'message_update':
            sse.queueUpdate(event.message)
            break
          case 'message_end':
            sse.flush()
            break
          case 'tool_start':
            sse.send({
              type: 'tool_call_start',
              toolCallId: event.toolCallId,
              toolName: event.toolName
            })
            break
          case 'tool_update':
            sse.send({ type: 'message_update', message: event.message })
            break
          case 'tool_end': {
            sse.send({ type: 'message_update', message: event.message })
            const notice = noticeOf(event.message.details)
            if (notice)
              sse.send({
                type: 'notice',
                level: notice.level === 'info' ? 'info' : 'warning',
                message: notice.message
              })
            sse.send({
              type: 'tool_call_end',
              toolCallId: event.toolCallId,
              toolName: event.toolName,
              isError: event.message.isError
            })
            break
          }
          case 'run_end':
            if (titlePromise) {
              const title = await titlePromise
              sse.send({ type: 'title', title })
              updateChatTitleById({ id, title }).catch((err) => {
                logger.error('chat', 'Failed to persist chat title', {
                  chatId: id,
                  error: String(err)
                })
              })
            }
            sse.send({
              type: 'done',
              messages: [...allMessages, ...event.messages]
            })
            break
          case 'error':
            logger.error('chat', 'Chat stream error', { error: event.error })
            sse.send({ type: 'error', error: toFriendlyChatError(event.error) })
            break
        }
      }
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err)
      logger.error('chat', 'Chat stream error', { error: raw })
      sse.send({ type: 'error', error: toFriendlyChatError(raw) })
    } finally {
      await recorder.persist().catch((error) => {
        logger.error('chat', 'Failed to persist chat run', {
          chatId: id,
          errorName: error instanceof Error ? error.name : typeof error
        })
      })
      sse.close()
    }
  }
})
```

with a small helper at module level:

```ts
function noticeOf(details: unknown): ToolNotice | null {
  const n =
    details && typeof details === 'object' && 'notice' in details
      ? (details as { notice?: unknown }).notice
      : null
  return n &&
    typeof n === 'object' &&
    typeof (n as ToolNotice).message === 'string'
    ? (n as ToolNotice)
    : null
}
```

New imports in `chat.ts`: `TOOL_NAMES` from `@actovia/shared/constants/tool-names`, `runAgent` from `../../ai/kernel/run`, `RunRecorder` from `../../ai/kernel/record`, `withRunId` from `./chat-persistence`. The `tool_end` event in `run.ts` carries `toolCallId`/`toolName` on its message; read them from `event.message`. Delete from `chat.ts`: the `agentLoop`/`AgentMessage`/`Message` imports, `uuidV4`, `calculateCost`, `stripId` (keep `toDbRow`, `withRunId`), `EMPTY_TURN_MESSAGE`/`isEmptyAssistantTurn`/`extractToolErrorMessage` imports (now used by the kernel), `stampTurnDuration`, `persistTurn`, `toolMsgIds`, and the `effectiveReasoning` comment block (keep the three-line expression from Task 2). The user row save and `indexMessage(toDbRow(withRunId(userMessage, userMessage.id), id))` stay as they are.

- [ ] **Step 3: Run the route tests**

Run: `bun run test tests/unit/main/lib/server/routes/chat.test.ts` → PASS, including the older cases (provider error → `error` event after the completed steps are saved; Stop → partial assistant row `stopReason: 'aborted'`). Where an old test asserted on internals that moved (e.g. `transformMessages` was called), delete that assertion.

- [ ] **Step 4: Gate + commit**

```bash
bun run fmt && bun run lint && bun run typecheck && bun run i18n:check && bun run test
git add src/main/lib/server/routes/chat.ts tests/unit/main/lib/server/routes/chat.test.ts
git commit -m "refactor(chat): the route drives runAgent() and a RunRecorder

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: The MCP toolbox — `list_mcp_tools` / `call_mcp_tool`, no `MAX_TOOLS`

**Files:**

- Create: `src/main/lib/ai/calling-tools/mcp-toolbox.ts`
- Test: `tests/unit/main/lib/ai/kernel/mcp-toolbox.test.ts`
- Modify: `src/main/lib/ai/calling-tools/index.ts`, `src/main/lib/ai/utils/tool-binding-util.ts` (bind the two meta-tools when any MCP server is connected; delete `MAX_TOOLS` and the truncation at lines 46 and 110–118), `src/main/lib/ai/prompts.ts` (`getSystemPrompt(mcpDirectory?: string)`), `src/main/lib/server/routes/chat.ts` (build the directory), `packages/shared/src/constants/tool-names.ts` (two more names), `packages/shared/src/types/ai.ts` (`McpTools` gains `description?: string`)

**Interfaces:**

- Consumes: `McpTools[]` from `getMcpTools()` (`src/main/lib/ai/mcp.ts`: `{ mcpServerName: string; tools: AgentTool[] }[]`).
- Produces:
  - `TOOL_NAMES.listMcpTools === 'list_mcp_tools'`, `TOOL_NAMES.callMcpTool === 'call_mcp_tool'`.
  - `mcpToolbox(servers: McpTools[]): [AgentTool, AgentTool]`.
  - `mcpDirectory(servers: McpTools[]): string` — one line per server: `- <name> (<n> tools)[: <description>]`, empty string when there are none.
  - `bindCallingTools({...})` signature unchanged; returns built-ins plus the toolbox pair when `mcpTools.length > 0`, never MCP tools themselves.

- [ ] **Step 1: Write the failing toolbox tests**

`tests/unit/main/lib/ai/kernel/mcp-toolbox.test.ts`:

```ts
import type { AgentTool } from '@earendil-works/pi-agent-core'
import { Type } from '@earendil-works/pi-ai'
import {
  mcpDirectory,
  mcpToolbox
} from '@main/lib/ai/calling-tools/mcp-toolbox'
import { describe, expect, it, vi } from 'vitest'

const issue: AgentTool = {
  name: 'create_issue',
  label: 'Create issue',
  description: 'Open a GitHub issue',
  parameters: Type.Object({ title: Type.String() }),
  execute: vi.fn(async (_id, args) => ({
    content: [
      { type: 'text', text: `opened ${(args as { title: string }).title}` }
    ],
    details: { ok: true }
  }))
}
const search: AgentTool = {
  name: 'search_code',
  label: 'Search code',
  description: 'Search a repo',
  parameters: Type.Object({ q: Type.String() }),
  execute: vi.fn(async () => ({
    content: [{ type: 'text', text: 'hits' }],
    details: {}
  }))
}
const servers = [
  { mcpServerName: 'github', description: 'GitHub', tools: [issue, search] },
  { mcpServerName: 'fs', tools: [] }
]

describe('mcp toolbox', () => {
  it('lists every tool with name, description and parameter schema', async () => {
    const [list] = mcpToolbox(servers)
    const r = await list.execute('t1', {})
    expect(r.details).toEqual([
      {
        server: 'github',
        tool: 'create_issue',
        description: 'Open a GitHub issue',
        parameters: issue.parameters
      },
      {
        server: 'github',
        tool: 'search_code',
        description: 'Search a repo',
        parameters: search.parameters
      }
    ])
  })

  it('filters by server and by substring', async () => {
    const [list] = mcpToolbox(servers)
    expect((await list.execute('t', { query: 'issue' })).details).toHaveLength(
      1
    )
    expect((await list.execute('t', { server: 'fs' })).details).toHaveLength(0)
  })

  it('call_mcp_tool forwards to the named tool and returns its result unchanged', async () => {
    const [, call] = mcpToolbox(servers)
    const r = await call.execute('t2', {
      server: 'github',
      tool: 'create_issue',
      arguments: { title: 'Bug' }
    })
    expect(issue.execute).toHaveBeenCalledWith(
      't2',
      { title: 'Bug' },
      undefined,
      undefined
    )
    expect(r.content).toEqual([{ type: 'text', text: 'opened Bug' }])
    expect(r.details).toEqual({ ok: true })
  })

  it('call_mcp_tool names the problem when the server or tool is unknown', async () => {
    const [, call] = mcpToolbox(servers)
    await expect(
      call.execute('t', { server: 'nope', tool: 'x', arguments: {} })
    ).rejects.toThrow(/Unknown MCP server "nope"/)
    await expect(
      call.execute('t', { server: 'github', tool: 'x', arguments: {} })
    ).rejects.toThrow(/no tool "x"/)
  })

  it('the directory is one line per server', () => {
    expect(mcpDirectory(servers)).toBe(
      '- github (2 tools): GitHub\n- fs (0 tools)'
    )
    expect(mcpDirectory([])).toBe('')
  })
})
```

- [ ] **Step 2: Run to see it fail** → FAIL, module not found.

- [ ] **Step 3: Write `mcp-toolbox.ts`**

```ts
import { TOOL_NAMES } from '@actovia/shared/constants/tool-names'
import type { McpTools } from '@actovia/shared/types/ai'
import type { AgentTool } from '@earendil-works/pi-agent-core'
import { Type } from '@earendil-works/pi-ai'

/**
 * MCP servers are not bound tool by tool — a single server can expose 100+
 * tools and providers cap the list (OpenAI: 128). Two tools stand in for all
 * of them: the model looks a tool up, then calls it. The system prompt carries
 * a one-line directory per server so it knows what exists.
 */

const listSchema = Type.Object({
  server: Type.Optional(
    Type.String({ description: 'Only tools of this server' })
  ),
  query: Type.Optional(
    Type.String({
      description: 'Case-insensitive substring of the tool name or description'
    })
  )
})

const callSchema = Type.Object({
  server: Type.String({ description: 'Server name from list_mcp_tools' }),
  tool: Type.String({ description: 'Tool name from list_mcp_tools' }),
  arguments: Type.Record(Type.String(), Type.Unknown(), {
    description: "Arguments matching the tool's parameters schema"
  })
})

export function mcpDirectory(servers: McpTools[]): string {
  return servers
    .map(
      (s) =>
        `- ${s.mcpServerName} (${s.tools.length} tools)${s.description ? `: ${s.description}` : ''}`
    )
    .join('\n')
}

export function mcpToolbox(servers: McpTools[]): [AgentTool, AgentTool] {
  const list: AgentTool<typeof listSchema> = {
    name: TOOL_NAMES.listMcpTools,
    label: 'List MCP tools',
    description:
      'List the tools connected MCP servers offer: each with its server, name, one-line description and JSON-schema parameters. Filter by server and/or a substring. Call this before call_mcp_tool when you do not know the exact tool name or its arguments.',
    parameters: listSchema,
    execute: async (_id, { server, query }) => {
      const q = query?.toLowerCase()
      const details = servers
        .filter((s) => !server || s.mcpServerName === server)
        .flatMap((s) =>
          s.tools
            .filter(
              (t) =>
                !q ||
                t.name.toLowerCase().includes(q) ||
                t.description.toLowerCase().includes(q)
            )
            .map((t) => ({
              server: s.mcpServerName,
              tool: t.name,
              description: t.description,
              parameters: t.parameters
            }))
        )
      return {
        content: [
          {
            type: 'text',
            text: details.length
              ? JSON.stringify(details)
              : 'No MCP tools match.'
          }
        ],
        details
      }
    }
  }

  const call: AgentTool<typeof callSchema> = {
    name: TOOL_NAMES.callMcpTool,
    label: 'Call MCP tool',
    description:
      "Call one tool of a connected MCP server by server and tool name, with arguments matching its parameters schema (see list_mcp_tools). Returns the tool's result unchanged.",
    parameters: callSchema,
    execute: async (
      toolCallId,
      { server, tool, arguments: args },
      signal,
      onUpdate
    ) => {
      const s = servers.find((x) => x.mcpServerName === server)
      if (!s)
        throw new Error(
          `Unknown MCP server "${server}". Servers: ${servers.map((x) => x.mcpServerName).join(', ') || 'none'}.`
        )
      const t = s.tools.find((x) => x.name === tool)
      if (!t)
        throw new Error(
          `Server "${server}" has no tool "${tool}". Use list_mcp_tools.`
        )
      return t.execute(toolCallId, args, signal, onUpdate)
    }
  }

  return [list as AgentTool, call as AgentTool]
}
```

Add `listMcpTools: 'list_mcp_tools'` and `callMcpTool: 'call_mcp_tool'` to `TOOL_NAMES` (update the count assertion in `tool-names.test.ts` to 21, and `LEGACY_TOOL_NAMES` keeps 19 entries — build it from an explicit list of the 19 rather than spreading `TOOL_NAMES`). `McpTools` in `packages/shared/src/types/ai.ts` gains `description?: string`; `src/main/lib/ai/mcp.ts` fills it from the `mcp_server` row's description if the schema has one (check `McpServer` in `schema.ts`; if not, leave it undefined). The MCP tools' own `execute` in `mcp.ts` already validates args via `validateToolArgs` — `call_mcp_tool` forwards raw `arguments` and lets that validation speak.

- [ ] **Step 4: Bind it, drop the cap, feed the prompt**

`tool-binding-util.ts`: replace `const mcpToolsList = mcpTools.flatMap((t) => t.tools)` and the tail (`combined`, `MAX_TOOLS`, the warn) with:

```ts
if (mcpTools.length > 0) tools.push(...mcpToolbox(mcpTools))
return tools
```

and delete the `MAX_TOOLS` constant and its comment. `prompts.ts`: `getSystemPrompt(mcpDirectory = '')` appends, when non-empty:

```
<mcp_servers>
These MCP servers are connected. Use list_mcp_tools to see a server's tools and their arguments, then call_mcp_tool to run one.
${mcpDirectory}
</mcp_servers>
```

`chat.ts`: `getSystemPrompt(mcpDirectory(mcpTools))`. Philharmonic's employee loop also calls `bindCallingTools` — it gets the toolbox too, and its own system prompt is unchanged (the toolbox's descriptions carry enough for it).

- [ ] **Step 5: Run the tests**

Run: `bun run test tests/unit/main/lib/ai/kernel/mcp-toolbox.test.ts tests/unit/shared/constants/tool-names.test.ts tests/unit/main/lib/ai/` → PASS. Any existing test asserting MCP tools appear in `bindCallingTools`'s result now asserts the two meta-tools instead.

- [ ] **Step 6: Gate + commit**

```bash
bun run fmt && bun run lint && bun run typecheck && bun run i18n:check && bun run test
git add src/main/lib/ai/calling-tools/mcp-toolbox.ts src/main/lib/ai/calling-tools/index.ts src/main/lib/ai/utils/tool-binding-util.ts src/main/lib/ai/prompts.ts src/main/lib/server/routes/chat.ts src/main/lib/ai/mcp.ts \
  packages/shared/src/constants/tool-names.ts packages/shared/src/types/ai.ts tests/unit/main/lib/ai/kernel/mcp-toolbox.test.ts tests/unit/shared/constants/tool-names.test.ts $(git diff --name-only)
git commit -m "feat(mcp): a two-tool toolbox instead of binding every MCP tool

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: The renderer groups by `runId` and renders one message per run

**Files:**

- Modify: `src/renderer/components/messages.tsx` (`groupIntoSegments`, `buildAssistantTurn`, `AssistantTurnSegment`), `src/renderer/hooks/use-chat.ts` (error at the foot of the run), `packages/shared/src/types/chat.ts` (`AssistantTurn.finalTextBlocks` → `body`)
- Test: `tests/unit/renderer/components/messages-rerender.test.ts`, `tests/unit/renderer/components/citations-across-turns.test.ts`, new cases in `tests/unit/renderer/components/messages-grouping.test.ts`

**Interfaces:**

- Consumes: `ChatMessage.runId` (Task 4).
- Produces: `groupIntoSegments(messages, cache?)` unchanged in signature; a segment key is `run:<runId>`; `AssistantTurn` gains `runId: string` and `body: string` (all text blocks of the run joined with `\n\n`), `finalTextBlocks` removed; `AssistantTurn.error?: string`.

- [ ] **Step 1: Write the failing grouping test**

`tests/unit/renderer/components/messages-grouping.test.ts`:

```ts
// @vitest-environment happy-dom
import type { ChatMessage } from '@actovia/shared/types/chat'
import { describe, expect, it } from 'vitest'

import { groupIntoSegments } from '@/components/messages'

const R1 = '11111111-1111-4111-8111-111111111111'
const R2 = '22222222-2222-4222-8222-222222222222'
const user = (id: string): ChatMessage => ({
  id,
  runId: id,
  role: 'user',
  content: 'q',
  timestamp: 1
})
const asst = (
  id: string,
  runId: string,
  text: string,
  stop: 'stop' | 'toolUse' = 'stop'
): ChatMessage => ({
  id,
  runId,
  role: 'assistant',
  content: [{ type: 'text', text }],
  api: 'a',
  provider: 'p',
  model: 'm',
  usage: {} as never,
  stopReason: stop,
  timestamp: 2
})
const tool = (id: string, runId: string): ChatMessage => ({
  id,
  runId,
  role: 'toolResult',
  toolCallId: 'c',
  toolName: 'weather',
  content: [],
  details: null,
  isError: false,
  timestamp: 3
})

describe('groupIntoSegments by runId', () => {
  it('one run is one assistant segment whose body joins every text block in order', () => {
    const segs = groupIntoSegments([
      user(R1),
      asst('a1', R1, 'Looking that up.', 'toolUse'),
      tool('t1', R1),
      asst('a2', R1, 'It is sunny.')
    ])
    expect(segs.map((s) => s.type)).toEqual(['user', 'assistantTurn'])
    const turn = segs[1].type === 'assistantTurn' ? segs[1].turn : null
    expect(turn?.runId).toBe(R1)
    expect(turn?.body).toBe('Looking that up.\n\nIt is sunny.')
  })

  it('two runs are two segments even without a user message between them', () => {
    // A user message that failed before any reply, then a second send.
    const segs = groupIntoSegments([user(R1), user(R2), asst('a1', R2, 'hi')])
    expect(
      segs.map((s) => (s.type === 'assistantTurn' ? s.turn.runId : 'user'))
    ).toEqual(['user', 'user', R2])
  })

  it('a run without a user message (legacy/orphan) still renders', () => {
    const segs = groupIntoSegments([asst('a1', R1, 'hi')])
    expect(segs).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Run to see it fail** → FAIL (`turn.runId` / `turn.body` undefined).

- [ ] **Step 3: Group by `runId`; one body per run**

`groupIntoSegments`: the turn buffer flushes when a message's `runId` differs from the buffer's (not only on a user message); key `run:${runId}`. `buildAssistantTurn(turnMessages)` returns `runId: turnMessages[0].runId`, `body: texts.join('\n\n')` (collect the text blocks as today but join them), and `error`: the `errorMessage` of the last assistant message with `stopReason === 'error'` if any. Remove `finalTextBlocks` from `AssistantTurn` and update `hasContent` to use `body.length > 0`.

`AssistantTurnSegment` renders **one** section: the `ThinkingTimeline` (unchanged), the tool cards, then

```tsx
<section className="group relative">
  <Markdown src={turn.body} webSearchResults={citationResults} />
  {galleryImages.length > 0 && <ImageGallery images={galleryImages} />}
  {galleryVideos.length > 0 && <VideoCards videos={galleryVideos} />}
  {turn.error && <MessageError message={turn.error} />}
  <MessageAction
    regenerate={regenerate}
    content={turn.body}
    webSearchResults={ownSources}
    timestamp={turn.messages.at(-1)?.timestamp}
  />
</section>
```

`MessageError` is a small muted line (`text-destructive text-sm mt-2`, existing `Alert` primitive with `variant="destructive"` is fine) with the copy key `chat:run.error` — `"This reply stopped with an error: {{message}}"` in `en/chat.json` and the other nine locales. `isStreaming` on the timeline: `isStreaming && turn.body.length === 0` as before.

While streaming, `use-chat.ts`/`stream-manager.ts` already replace messages by id, so the body grows with the last assistant message's text; nothing to change there. On an `error` SSE event, `use-chat.ts` today sets status `'error'` and toasts — keep that, and additionally the last assistant message of the run keeps its `errorMessage` (the kernel sets it on the message it yields), so the foot-of-message error renders from the data.

- [ ] **Step 4: Render-count guarantees carry over**

`tests/unit/renderer/components/messages-rerender.test.ts`: its fixtures gain `runId`; add one case: _while the last run streams (its last assistant message is replaced each frame), the earlier runs' `AssistantTurnSegment`s do not re-render_ — the same assertion the file already makes for "earlier turns", keyed on `run:<runId>` now. `citations-across-turns.test.ts`: fixtures gain `runId`; assertions unchanged.

- [ ] **Step 5: Run the renderer tests**

Run: `bun run test tests/unit/renderer/` → PASS.

- [ ] **Step 6: Gate + commit**

```bash
bun run fmt && bun run lint && bun run typecheck && bun run i18n:check && bun run test
git add src/renderer/components/messages.tsx src/renderer/hooks/use-chat.ts packages/shared/src/types/chat.ts packages/shared/src/i18n/locales/ tests/unit/renderer/components/ $(git diff --name-only)
git commit -m "feat(chat): one assistant message per run, grouped by runId

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 10: Philharmonic compiles and behaves as before (verification task)

**Files:**

- Modify (only if a test says so): `src/main/lib/ai/philharmonic/{employee-loop,pm-coordinator}.ts`
- Test: `tests/unit/main/lib/ai/philharmonic/*.test.ts` (existing)

**Interfaces:** none new. This task exists so a reviewer can reject "Philharmonic changed" independently.

- [ ] **Step 1: Run the Philharmonic suite**

Run: `bun run test tests/unit/main/lib/ai/philharmonic/`
Expected: PASS. If a test fails on the `agentLoop` shape (the Task 2 fifth argument) or on a reasoning level (`'off'`), fix the call site to the 0.85 shape and nothing else.

- [ ] **Step 2: Diff check**

```bash
git diff feat/lan-pairing-sandbox-isolation -- src/main/lib/ai/philharmonic/ | grep '^[+-]' | grep -v '^[+-][+-]' | grep -v "earendil-works\|mariozechner\|streamFn\|agentLoop("
```

Expected: empty, or only the reasoning-level lines from Task 2 Step 5. Anything else is out of scope — revert it.

- [ ] **Step 3: Commit (only if Step 1 required a change)**

```bash
git add src/main/lib/ai/philharmonic/
git commit -m "build(philharmonic): pi 0.85 call shapes, no behaviour change

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 11: Faux-provider Electron e2e — a whole conversation with a tool call, no key

**Files:**

- Modify: `src/main/lib/server/app.ts` or `src/main/main.ts` (register the faux provider at boot when `ACTOVIA_FAUX_PROVIDER=1`), `src/main/lib/ai/utils/model-util.ts` (`getModelFromProvider` returns the faux model under the flag), `tests/fixtures/electron.ts` (pass the env through), `packages/shared/src/constants/test-ids.ts` (if a new element is needed — likely not)
- Create: `tests/e2e/chat-faux-provider.spec.ts`
- Create: `src/main/lib/ai/kernel/faux-boot.ts`

**Interfaces:**

- Produces: `bootFauxProviderIfRequested(): FauxProviderHandle | null` — registers the faux provider with a scripted two-step reply (tool call `weather` → text) that re-arms itself for every request, when `process.env.ACTOVIA_FAUX_PROVIDER === '1'`; `getModelFromProvider()` returns `{ model: handle.getModel(), apiKey: 'faux' }` while it is set.

- [ ] **Step 1: Write the failing e2e spec**

`tests/e2e/chat-faux-provider.spec.ts`:

```ts
import { expect } from '@playwright/test'

import { TEST_IDS } from '../../packages/shared/src/constants/test-ids'
import { test } from '../fixtures/electron'

test.describe('chat on the faux provider', () => {
  test.skip(
    process.env.ACTOVIA_FAUX_PROVIDER !== '1',
    'set ACTOVIA_FAUX_PROVIDER=1 (playwright.config.ts does for the electron project)'
  )

  test('a send runs a tool call and renders one assistant message', async ({
    page
  }) => {
    await page.getByTestId(TEST_IDS.chat.composerInput).fill('weather in Oslo')
    await page.getByTestId(TEST_IDS.chat.composerInput).press('Enter')
    // The timeline step for the tool call, then the body.
    await expect(page.getByText('Weather: Oslo')).toBeVisible()
    await expect(page.getByText('It is sunny in Oslo.')).toBeVisible()
    // One action bar (copy/regenerate) for the whole run.
    await expect(page.getByTestId(TEST_IDS.chat.messageAction)).toHaveCount(1)
  })
})
```

Use the composer/action test ids that already exist in `test-ids.ts` (grep `composer` and `messageAction`/`regenerate` there; if the action bar has no id, add `chat.messageAction` to the registry + `data-testid` on `MessageAction`'s root — the linkage test then requires this spec to reference it, which it does).

- [ ] **Step 2: Wire the flag**

`src/main/lib/ai/kernel/faux-boot.ts`:

```ts
import {
  fauxAssistantMessage,
  fauxText,
  fauxToolCall,
  type FauxProviderHandle,
  type FauxResponseFactory
} from '@earendil-works/pi-ai'

import { logger } from '../../logger'
import { registerFauxProvider } from './faux'

let handle: FauxProviderHandle | null = null

/** The Electron e2e's provider: scripted, keyless, on when ACTOVIA_FAUX_PROVIDER=1. */
export function bootFauxProviderIfRequested(): FauxProviderHandle | null {
  if (process.env.ACTOVIA_FAUX_PROVIDER !== '1') return null
  handle = registerFauxProvider({
    provider: 'faux',
    models: [{ id: 'faux-1', name: 'Faux' }]
  })
  // One factory answers every request and re-arms itself, so every send in a
  // spec gets the same two steps: a tool call, then — once the tool result is
  // the last message — the text.
  const factory: FauxResponseFactory = (ctx) => {
    handle!.appendResponses([factory])
    return ctx.messages.at(-1)?.role === 'toolResult'
      ? fauxAssistantMessage([fauxText('It is sunny in Oslo.')])
      : fauxAssistantMessage([fauxToolCall('weather', { location: 'Oslo' })], {
          stopReason: 'toolUse'
        })
  }
  handle.setResponses([factory])
  logger.warn(
    'app',
    'Faux provider is on (ACTOVIA_FAUX_PROVIDER=1) — no real model is reachable'
  )
  return handle
}

export function fauxHandle(): FauxProviderHandle | null {
  return handle
}
```

Call `bootFauxProviderIfRequested()` where the server is created (`src/main/lib/server/app.ts`'s exported factory, before routes). `src/main/lib/ai/utils/model-util.ts`: at the top of `getModelFromProvider`, `const faux = fauxHandle(); if (faux) return { model: faux.getModel(), apiKey: 'faux' }`. The `weather` tool must be bound for the script to work — it is, by default (`enabled('weather')`); the real `weather` tool calls wttr.in, which the e2e must not do: under the flag, `bindCallingTools` swaps in a stub `weather` whose `execute` returns `{ content: [{ type: 'text', text: 'sunny' }], details: {} }` — put that stub in `faux-boot.ts` as `fauxWeatherTool` and check `fauxHandle()` in `tool-binding-util.ts`.

`tests/fixtures/electron.ts:86` env: add `ACTOVIA_FAUX_PROVIDER: process.env.ACTOVIA_FAUX_PROVIDER ?? ''`. `playwright.config.ts`: set `ACTOVIA_FAUX_PROVIDER: '1'` in the electron project's `env` (or in `use`), so the whole electron suite boots faux — the existing key-gated specs stay skipped (`skipWithoutKey`), everything else is unaffected because they never reach a model.

- [ ] **Step 3: Run it**

```bash
bun run package
ACTOVIA_FAUX_PROVIDER=1 bun run test:e2e:electron -- tests/e2e/chat-faux-provider.spec.ts
```

Expected: PASS. (The fixture refuses to run while a dev build answers on `localhost:60223` — quit it first.)

- [ ] **Step 4: Gate + commit**

```bash
bun run fmt && bun run lint && bun run typecheck && bun run i18n:check && bun run test
git add src/main/lib/ai/kernel/faux-boot.ts src/main/lib/server/app.ts src/main/lib/ai/utils/model-util.ts src/main/lib/ai/utils/tool-binding-util.ts tests/fixtures/electron.ts playwright.config.ts tests/e2e/chat-faux-provider.spec.ts packages/shared/src/constants/test-ids.ts $(git diff --name-only)
git commit -m "test(e2e): a scripted provider so chat runs end to end without a key

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 12: Docs, and the real-provider check

**Files:**

- Modify: `CLAUDE.md`, `docs/pi-ai-review.md`, `docs/superpowers/specs/2026-09-22-chat-kernel-design.md` (Status line)
- Run: `tests/providers` with the user's keys (not committed)

- [ ] **Step 1: CLAUDE.md**

- Project Overview / Chat Flow: rewrite steps 4–6 around `runAgent()` (`src/main/lib/ai/kernel/run.ts`), `RunRecorder` (`record.ts`), the `KernelEvent` union (`events.ts`), and that `chat.ts` is validate → build → `for await` → SSE.
- New section **Chat kernel** under Architecture: `kernel/models.ts` (the `Models` collection; Ollama as a dynamic provider `ollama`; `streamFn`), `kernel/invariant.ts` (`dropBrokenRuns`), `kernel/faux.ts` + `faux-boot.ts` (`ACTOVIA_FAUX_PROVIDER=1`).
- Database Layer: `message.runId` (what it is, the backfill in 0008), the tool-name migration 0007.
- Tools: the snake_case table from the spec; `packages/shared/src/constants/tool-names.ts` is the source of truth; the MCP toolbox (`list_mcp_tools`, `call_mcp_tool`, `mcpDirectory` in the system prompt); `MAX_TOOLS` is gone.
- LCM: `freshTailSize` counts runs (default 6); assembly and compaction are run-aligned; `transform-messages.ts` no longer exists.
- Chat Render Path: segments are keyed `run:<runId>`; one `AssistantTurnSegment` per run with one body.
- "When Working with AI Providers": replace the deprecation bullet with "`@earendil-works/pi-ai` / `pi-agent-core` 0.85; `completeSimple` still comes from `src/main/lib/ai/utils/complete.ts` (it goes through `getKernelModels()`); the `/compat` entrypoint is not used".
- Code Structure: add `src/main/lib/ai/kernel/` and `calling-tools/mcp-toolbox.ts`; remove `utils/transform-messages.ts`.
- Testing: the faux-provider e2e switch.

Run `bun run test tests/unit/shared/meta/` — `claude-md-freshness.test.ts` and `claude-md-staleness.test.ts` must pass (the staleness test lists retired claims; add `transform-messages`, `MAX_TOOLS`, `@mariozechner` to it if it keys on strings).

- [ ] **Step 2: `docs/pi-ai-review.md`**

Under "## The package is deprecated", replace the migration plan with: "Done 2026-09-22 — see `docs/superpowers/specs/2026-09-22-chat-kernel-design.md`. The kernel targets the 0.85 `Models` API directly; nothing imports `/compat`." Keep the "Fixed" and "Smaller observations" sections.

- [ ] **Step 3: Spec status**

`docs/superpowers/specs/2026-09-22-chat-kernel-design.md` line 4: `Status: Implemented on feat/chat-kernel (plan: docs/superpowers/plans/2026-09-22-chat-kernel.md).`

- [ ] **Step 4: Real providers**

With the user's keys in `.env.test`:

```bash
bun run test:e2e:providers
```

Expected: one tool-calling conversation each on Anthropic, OpenAI and Gemini passes. A failure here is a kernel bug, not a docs task — report it with the provider's error text and fix it in the task that owns the code (`models.ts` for routing/auth, `run.ts` for events, `invariant.ts` for a 400 on `tool_use_id`).

- [ ] **Step 5: Backfill timing on the user's database**

Before the branch is handed over: with the dev app **quit**, copy `~/.actovia/database` to the scratchpad, open it with PGlite in a node script and time `0007` + `0008` (`console.time`). Report the row count and the seconds in the hand-over note; if 0008's correlated subquery takes more than a few seconds, add `CREATE INDEX message_chat_created_idx ON "message" ("chatId","createdAt")` at the top of 0008 (drop it at the end if the schema has no such index).

- [ ] **Step 6: Gate + commit**

```bash
bun run fmt && bun run lint && bun run typecheck && bun run i18n:check && bun run test
git add CLAUDE.md docs/pi-ai-review.md docs/superpowers/specs/2026-09-22-chat-kernel-design.md
git commit -m "docs: the chat kernel on pi 0.85

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Self-review notes

- **Spec coverage.** Data model → Tasks 3, 4. Context assembly + invariant + `transform-messages` deletion + `freshTailSize` → Task 5. Kernel (`models`, `run`, `record`) → Tasks 1, 6; `chat.ts` slimming → Task 7. Tools rename → Task 3; toolbox + `MAX_TOOLS` + `beforeToolCall` gate → Tasks 8, 6. Wire format + rendering → Tasks 4, 9. Errors and Stop → Tasks 6, 7, 9. Testing: kernel/faux → 6, property → 5, migration → 3–4, rendering → 9, e2e → 11, real providers → 12. Philharmonic package-only → 2, 10. Docs → 12. Risk "backfill on large databases" → 12 Step 5.
- **Type consistency.** `freshTailRuns` is the name in `assembleContext`, `LcmManager`, `RecorderDeps.lcm`, and the `lcm-post-turn` payload (Tasks 5–7); the settings key stays `memory.freshTailSize` (user-facing, its meaning changes). `runId` is on every `ChatMessage` variant (Task 4) and every `KernelEvent` (Task 6). `TOOL_NAMES` has 19 entries after Task 3 and 21 after Task 8; `LEGACY_TOOL_NAMES` always 19.
- **Order dependency.** Task 5 needs `runId` on rows (Task 4) for grouping; Task 7 needs Task 6; Task 9 needs Task 4's types; Task 11 needs Tasks 7 and 9. Tasks 8 and 10 can run any time after Task 3 / Task 2 respectively.
