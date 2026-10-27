# Remove cost, show context — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** No money anywhere in either app; the desktop chat shows how full its context is, of what, and where LCM compacts — with LCM finally using the model's real window.

**Architecture:** Money is removed layer by layer (model metadata → kernel → Philharmonic → routes/audit → UI), with a guard test that keeps it out. The chat route measures each part of the request it is about to send; `RunRecorder` scales that by the provider's reported input and saves it on `chat.context_snapshot`; a route serves it; the header ring and a new panel tab draw it.

**Tech Stack:** Electron main (Hono, Drizzle/PGlite, pi-ai 0.85), React 19 + React Query + Jotai, Vitest, Playwright; iOS Swift (Tuist, Swift Testing).

**Spec:** `docs/superpowers/specs/2026-10-27-remove-cost-context-panel-design.md` (Linear ISSUE-235)

## Global Constraints

- Desktop work: worktree `~/Code/actovia/actovia-demo`, branch `linear/2026-10-27-cost`. iOS work: worktree `~/Code/actovia/ios-linear`, new branch `linear/2026-10-27-cost` off `main`.
- Tokens stay everywhere they are shown today; only money goes. Stored rows are not migrated.
- New strings: keys in `packages/shared/src/i18n/locales/en/<ns>.json` **and every other locale in the same commit** (author the translations; `bun run i18n:check` must pass). Removed keys are removed from all 12 locales.
- New interactive elements get `TEST_IDS` entries referenced by a Playwright spec; existing ids are never renamed. A removed element's id is removed with it (and from its specs).
- Commit messages end with `Refs ISSUE-235` and the `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` line. Never `--no-verify`.
- Desktop commands: `env PWD=$PWD bunx vitest run <file>`, `bun run typecheck`, `bun run lint`, `bun run i18n:check`, full `env PWD=$PWD bun run test` at the end of each task that spans modules.
- iOS commands: strip swiftly from PATH; `xcodebuild test -workspace ActoviaIos.xcworkspace -scheme <Scheme> -destination "platform=iOS Simulator,id=D8A2BE45-88F3-46AE-8693-B147F2815724"`; `tuist generate --no-open` after adding/removing files; l10n through `scripts/l10n.py`.
- CLAUDE.md is updated in the task that changes what it describes (`claude-md-freshness` / `-staleness` tests run in the suite).

## Review Focus

1. A chat with a pasted 3 MB photo: the Context view must not show Messages ≈ 100 % with everything else crushed to 0 — Task 5 tests the image allowance through scaling.
2. A model whose window is unknown or 0 (a hand-built Ollama model, a stale snapshot): no `NaN%`, no division by zero — the ring hides its percentage, the panel shows tokens only. Tested in Tasks 5 and 6.
3. A run stopped before any answer, or failing at the first call: the previous snapshot stays — Task 5.
4. A Regenerate: the snapshot measures the request actually sent (the other attempt excluded), not the whole stored history — Task 5 measures `contextMessages`, the same array the kernel gets.
5. LCM on a 1 M model: no compaction at ~96 k; compaction still happens on a 128 k model at 96 k — Task 4 tests both.

---

### Task 1: Model metadata and the chat kernel carry no money

**Files:**

- Delete: `src/main/lib/ai/utils/cost.ts`
- Modify: `src/main/lib/ai/providers/resolve-model.ts`, `src/main/lib/ai/providers/list-models/{anthropic,openai,google,xai,ollama}.ts`, `src/main/lib/ai/providers/ollama.ts`, `src/main/lib/ai/kernel/run.ts` (~l.392), `src/main/lib/ai/philharmonic/employee-loop.ts` (~l.171, 247, 295), `src/main/lib/ai/utils/usage.ts`, `packages/shared/src/types/chat.ts` (`CostBreakdown`, `cost?` fields), `packages/shared/src/schemas/settings-schema.ts` (`ModelSnapshotSchema.cost`), `src/renderer/hooks/use-chat.ts:64`, `src/renderer/components/chat/composer/composer.tsx:338-347` (the commented-out cost line)
- Create: `tests/unit/no-money.test.ts`
- Test: `tests/unit/main/lib/ai/providers/resolve-model.test.ts`, existing tests that fixture `cost` (update fixtures)

**Interfaces:**

- Produces: `ZERO_MODEL_COST = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }` exported from `resolve-model.ts`; every `Model` `resolveModel()` returns has `cost` equal to it. `ChatAssistantMessage` has no `cost`. `ModelSnapshot` has no `cost`.

- [ ] **Step 1: Write the failing tests**

`resolve-model.test.ts` — one case per return path (catalog/`registered`, snapshot with a `cost`, snapshot without, provider fallback):

```ts
it.each(paths)('%s returns a model with zero cost', (_, args) => {
  expect(resolveModel(...args).cost).toEqual(ZERO_MODEL_COST)
})
```

(The repo-wide guard, `no-money.test.ts`, is written in Task 3, once the last money is gone.)

- [ ] **Step 2: Run** `env PWD=$PWD bunx vitest run tests/unit/main/lib/ai/providers/resolve-model.test.ts` — Expected: FAIL (catalog path returns pi's prices).

- [ ] **Step 3: Implement.** In `resolve-model.ts` set `cost: ZERO_MODEL_COST` on every returned model (override pi's catalog `cost` too); remove every `cost` from `MODEL_METADATA_FALLBACK` and the provider fallbacks (rows that held only `cost` are deleted). Remove `cost` from each list-models handler's snapshot and from `ModelSnapshotSchema` (a stored catalog's `cost` is stripped by Zod on parse — confirm the schema is not `.strict()`; if it is, make it strip). Delete `cost.ts`; remove its calls in `run.ts` and `employee-loop.ts` and the `cost` field on `ChatAssistantMessage` / `CostBreakdown` in `types/chat.ts`; in `usage.ts` keep pi's required `usage.cost` zero block (pi's type requires it). In `use-chat.ts:64` compare tokens only. Delete the commented cost line in `composer.tsx`.

- [ ] **Step 4: Run** the resolve-model test (PASS), then `bun run typecheck` and `env PWD=$PWD bun run test`; fix fixtures that asserted cost values (assert tokens instead, never delete a test's token assertions). Expected: all green.

- [ ] **Step 5: Commit** `refactor(ai): models and chat runs carry no price` (Refs ISSUE-235).

### Task 2: Philharmonic carries no money; the Costs page goes

**Files:**

- Modify: `src/main/lib/ai/philharmonic/execution-engine.ts:127-138`, `src/main/lib/ai/philharmonic/round-recorder.ts:97,155,198`, `src/main/lib/agents/{driver,card,run-agent-employee}.ts`, `src/main/lib/agents/claude-code/protocol.ts:278`, `src/main/lib/agents/codex/{protocol,run}.ts`, `packages/shared/src/types/agents.ts:107`, `src/main/lib/db/schema.ts:565` (`tokenUsage.cost`, `estimated` type fields), `src/main/lib/db/pm-round-queries.ts` (delete `getPmCostRows`), `src/main/lib/server/routes/philharmonic-conversations.ts` (delete `aggregateCosts` and `GET /costs`), `src/renderer/containers/philharmonic.tsx:47` (Costs tab), `src/renderer/services/philharmonic-chat.ts:83-97`, `src/renderer/components/philharmonic/chat/decision-process.tsx:272`, `src/renderer/lib/pm-round.ts:27,123`, the Philharmonic hooks that call costs, `packages/shared/src/i18n/locales/*/philharmonic.json` (`costAnalysis.*` and the Costs tab label), `packages/shared/src/constants/test-ids.ts` (ids only the Costs page used), Playwright specs referencing them, CLAUDE.md (Philharmonic Costs bullet, `/costs` route, `?days` paragraph)
- Delete: `src/renderer/components/philharmonic/cost-analysis.tsx`, `tests/unit/renderer/components/philharmonic/cost-analysis.test.ts`, `tests/unit/main/lib/db/pm-cost-rows.integration.test.ts`
- Test: `tests/unit/main/lib/server/routes/philharmonic-conversations.test.ts`, `tests/unit/renderer/lib/pm-round.test.ts`, `tests/unit/main/lib/agents/*.test.ts`, `round-recorder` / `execution-engine` / `employee-loop` tests

**Interfaces:**

- Consumes: Task 1 (no `calculateCost`).
- Produces: CLI `turn_end` usage is `{ inputTokens, outputTokens } | null` (unchanged); `DelegatedOutput.usage` is `{ inputTokens, outputTokens }`; `task_execution.tokenUsage` written as `{ inputTokens, outputTokens }` (+ `estimated` removed); PM round usage events carry tokens only; agent card has no `costUsd`.

- [ ] **Step 1: Write the failing tests.** In `philharmonic-conversations.test.ts`: `GET /api/v1/philharmonic/costs` → `404`. In `pm-round.test.ts`: the round usage line for `{ inputTokens: 1200, outputTokens: 300, costUsd: 0.12 }` (an old row) formats with no `$` (`expect(line).not.toContain('$')`) and still shows both token counts. In `execution-engine.test.ts`: a CLI run's saved `tokenUsage` equals `{ inputTokens, outputTokens }` exactly.
- [ ] **Step 2: Run** those three files — Expected: FAIL.
- [ ] **Step 3: Implement** the removals listed under Files. The Philharmonic page loses its Costs tab entirely (no placeholder). Remove `costAnalysis.*` keys from all 12 `philharmonic.json`. Update CLAUDE.md's Philharmonic section: drop the Costs bullet and `/costs` mention.
- [ ] **Step 4: Run** the three files (PASS), `bun run typecheck`, `bun run i18n:check`, `env PWD=$PWD bun run test`. Expected: green (the linkage test passes once removed ids are gone from both registry and specs).
- [ ] **Step 5: Commit** `refactor(philharmonic): no cost, no Costs page` (Refs ISSUE-235).

### Task 3: Usage route and Chat Audit carry no money; the guard

**Files:**

- Modify: `src/main/lib/server/routes/usage.ts`, `src/main/lib/db/queries.ts:739`, `src/renderer/services/usage.ts`, `src/renderer/hooks/use-usage.ts`, `packages/shared/src/constants/chat-audit-schema.ts:33`, `packages/shared/src/constants/chat-audit-presets.ts` (delete `costByModel`; `pmDecisions` loses `cost_usd`; `cacheByRun` loses `input_cost_units`, keeps `hit_pct`), `src/main/lib/analytics/snapshot.ts:124`, any chat-audit i18n key naming the deleted preset (all locales), CLAUDE.md (Chat Audit paragraph; "Prompt cache by run" sentence), `docs/chat-api.md` if it mentions cost
- Create: `tests/unit/no-money.test.ts` — scans `packages/shared/src/**/*.ts`, `src/main/lib/**/*.ts`, `src/renderer/**/*.{ts,tsx}` (no exclusions) for `/\b(costUsd|totalCost|cost_usd|estimatedCost|CostBreakdown|calculateCost|input_cost_units)\b/` and expects zero hits, listing each `file:line` in the failure message
- Test: `tests/unit/main/lib/server/routes/usage.test.ts`, `tests/api/usage.spec.ts`, `tests/unit/main/lib/analytics/snapshot.test.ts`, `tests/unit/renderer/hooks/use-usage.test.ts`

**Interfaces:**

- Produces: `GET /api/v1/usage` → same shape minus `totalCost` and every `cost` (tokens per day / per model unchanged; per-model sort by total tokens).

- [ ] **Step 1: Write the failing tests.** `usage.test.ts`: response has no key matching `/cost/i` at any depth (walk the JSON). `snapshot.test.ts`: the built `message` table has no `cost_usd` column, and every remaining preset still executes. Add `no-money.test.ts`.
- [ ] **Step 2: Run** them — Expected: FAIL (cost keys present; guard lists hits).
- [ ] **Step 3: Implement** the removals. Update `tests/api/usage.spec.ts` to assert no `totalCost`.
- [ ] **Step 4: Run** the files (PASS), then the full gate: `bun run typecheck && bun run lint && bun run i18n:check && env PWD=$PWD bun run test`. Expected: green, `no-money.test.ts` with zero hits.
- [ ] **Step 5: Commit** `refactor(usage): tokens only, and a guard against money` (Refs ISSUE-235).

### Task 4: LCM compacts against the model's window

**Files:**

- Modify: `src/main/lib/server/routes/chat.ts:294`, `src/main/lib/jobs/handlers.ts:59`, CLAUDE.md (LCM section: one line — the threshold is the chat model's `contextWindow × contextWindowPercent`)
- Test: `tests/unit/main/lib/jobs/handlers.test.ts` (or the nearest existing `lcm-post-turn` test), `tests/unit/main/lib/ai/context-management/index.test.ts`

**Interfaces:**

- Produces: both `new LcmManager(...)` calls pass `contextWindow: model.contextWindow` (job: `p.model.contextWindow`), falling back to the class default when `≤ 0`.

- [ ] **Step 1: Write the failing tests.** `index.test.ts`: with context items totalling 100 000 tokens, an `LcmManager` built with `contextWindow: 1_000_000, contextWindowPercent: 75` does not emit `start` on `lcmStatusBus`; with `contextWindow: 128_000` it does. The handler test: `lcm-post-turn` constructs `LcmManager` with `contextWindow` equal to `payload.model.contextWindow` (spy on the constructor via `vi.mock` of `@main/lib/ai/context-management`).
- [ ] **Step 2: Run** — Expected: the handler test FAILS (`contextWindow` undefined); the index test passes already (it pins the class's behavior — keep it).
- [ ] **Step 3: Implement** the two call sites.
- [ ] **Step 4: Run** both files and `chat.faux.test.ts` — Expected: PASS.
- [ ] **Step 5: Commit** `fix(lcm): compact against the chat model's window` (Refs ISSUE-235).

### Task 5: The context snapshot — measured, scaled, stored, served

**Files:**

- Create: `packages/shared/src/types/chat-context.ts`, `src/main/lib/chat/context-snapshot.ts`, migration `resources/drizzle/0021_chat_context_snapshot.sql` (via `bun run db:generate`), `tests/unit/main/lib/chat/context-snapshot.test.ts`, `tests/unit/main/lib/server/routes/chat-context.test.ts`
- Modify: `src/main/lib/ai/context-management/context-assembler.ts` (`AssembledContext.kinds`), `src/main/lib/ai/context-management/token-counter.ts`, `src/main/lib/db/schema.ts` (`chat.contextSnapshot` jsonb, nullable), `src/main/lib/db/queries.ts`, `src/main/lib/ai/kernel/record.ts`, `src/main/lib/server/routes/chat.ts` (measure before `runAgent`; new `GET /:id/context`), `packages/shared/package.json` exports if subpaths are listed, `docs/chat-api.md` (the route), CLAUDE.md (`chat` table key bullet; `/api/v1/chat` route paragraph; Code Structure line for `chat/context-snapshot.ts`)
- Test: `tests/unit/main/lib/ai/kernel/record.test.ts`, `tests/unit/main/lib/server/routes/chat.faux.test.ts`, `tests/unit/main/lib/ai/context-management/context-assembler*.test.ts`

**Interfaces:**

- Produces (shared, `@actovia/shared/types/chat-context`):
  ```ts
  export type ContextPartKey =
    | 'system'
    | 'skills'
    | 'mcp'
    | 'tools'
    | 'memory'
    | 'summaries'
    | 'messages'
  export interface ChatContextSnapshot {
    takenAt: string // ISO
    runId: string
    model: string // model id
    contextWindow: number // 0 when unknown
    compactAt: number | null // tokens; null with LCM off
    total: number
    estimated: boolean
    parts: { key: ContextPartKey; tokens: number }[] // always all seven, in this order
  }
  ```
- `AssembledContext.kinds: ('summary' | 'message')[]`, parallel to `messages` (`[]` with no items).
- `token-counter.ts`: `IMAGE_TOKEN_ALLOWANCE = 1600`; `estimateContentTokensForView(content: unknown): number` — like `estimateMessageTokens` but an image part counts `IMAGE_TOKEN_ALLOWANCE` (LCM's own counting is unchanged).
- `context-snapshot.ts`:
  - `measureContext(input: { systemPrompt: string; skillsIndex: string; mcpDirectory: string; tools: AgentTool[]; memoryTexts: string[]; messages: Message[]; kinds: ('summary'|'message')[] }): Record<ContextPartKey, number>` — `system` = tokens of `systemPrompt` minus the skills and mcpDirectory tokens (floored at 0); `mcp` = mcpDirectory + the schemas of the tools named `list_mcp_tools` / `call_mcp_tool`; `tools` = every other tool's name + description + parameters (`estimateJsonTokens`); `memory` = sum of `memoryTexts`; `summaries` = messages whose kind is `'summary'`; `messages` = the rest minus `memory` (floored at 0).
  - `scaleSnapshot(parts, realInput: number | null): { parts; total; estimated }` — `realInput > 0`: each part × `realInput / sum`, rounded, the rounding remainder put on `messages`, `total = realInput`, `estimated = false`; otherwise unscaled, `estimated = true`.
  - `saveChatContextSnapshot(chatId, snapshot)` / `getChatContextSnapshot(chatId)` live in `db/queries.ts`.
- `RecorderDeps.context?: { parts: Record<ContextPartKey, number>; contextWindow: number; compactAt: number | null; model: string; runId: string } | null`. `RunRecorder` keeps the first `message_end` whose message has `usage`; `persist()` writes the snapshot only when `done` holds an assistant message; `realInput = input + cacheRead + cacheWrite` of that first usage.
- Route: `GET /api/v1/chat/:id/context` → `ChatContextSnapshot` or `404 { code: 'CONTEXT_NOT_FOUND' }`.
- The route computes `compactAt = lcm ? Math.floor(contextWindow * percent / 100) : null` with `contextWindow = model.contextWindow > 0 ? model.contextWindow : 0` (and `compactAt = null` when the window is 0).

- [ ] **Step 1: Write the failing tests** (`context-snapshot.test.ts`):
  - `measureContext` with a system prompt that contains a 400-token skills index and 200-token MCP directory gives `skills ≈ 400`, `mcp ≥ 200`, and `system` excluding both; with no skills/MCP/memory those parts are `0`.
  - A user message holding one 3 MB base64 PNG counts `IMAGE_TOKEN_ALLOWANCE` + its text, not ~900 k.
  - `scaleSnapshot({…sums to 1000}, 2000)` doubles each part, `total === 2000`, parts sum exactly to 2000, `estimated === false`; with `null` and with `0`: unscaled, `estimated === true`.
  - Assembler: a chat with one summary and two runs returns `kinds` `['summary', 'message', …]` parallel to `messages`.
  - `record.test.ts`: (a) a run whose first `message_end` reports `input 900, cacheRead 100` saves a snapshot with `total 1000`, `estimated false`; (b) a run with no assistant message (`run_end` with only the user message) leaves an existing snapshot untouched; (c) usage all zeros → `estimated true`.
  - `chat-context.test.ts`: `404 CONTEXT_NOT_FOUND` before any run; after a faux run (`chat.faux.test.ts` style) the route returns all seven parts in order, `compactAt` = `floor(window × 75 / 100)` with LCM on and `null` with LCM off; a model with `contextWindow: 0` gives `contextWindow 0, compactAt null`.
- [ ] **Step 2: Run** — Expected: FAIL (modules missing).
- [ ] **Step 3: Implement** per Interfaces. In `chat.ts`, call `measureContext` right before `runAgent` with `systemContent`, `skillsIndex` (`''` for Deep Research), `mcpDirectory(mcpTools)` (`''` for Deep Research), `tools`, the memory texts actually placed (this run's `formatRunMemory(memoryRows)` and each `runMemory` value used for a head), `[...contextMessages, promptWithMemory]` and `[...assembledContext.kinds (or all 'message' with LCM off), 'message']`. Pass the result in `RecorderDeps.context`. Generate the migration with `bun run db:generate` and rename to `0021_chat_context_snapshot.sql` only if the generator's name differs from the project's pattern (follow 0019's naming).
- [ ] **Step 4: Run** the new and touched test files, then `bun run typecheck && env PWD=$PWD bun run test`. Expected: green.
- [ ] **Step 5: Commit** `feat(chat): record and serve each chat's context` (Refs ISSUE-235).

### Task 6: The Context ring and panel tab

**Files:**

- Create: `src/renderer/services/chat-context.ts`, `src/renderer/hooks/use-chat-context.ts`, `src/renderer/lib/context-meter.ts`, `src/renderer/components/chat/header/context-ring.tsx`, `src/renderer/components/chat/panel/context-section.tsx`, `tests/unit/renderer/lib/context-meter.test.ts`, `tests/unit/renderer/components/chat/context-section.test.ts`, `tests/e2e/chat-context.spec.ts`
- Modify: `src/renderer/stores/chat.ts:43` (`ChatPanelSection` gains `'context'`), `src/renderer/components/chat/panel/chat-panel.tsx` (`SECTIONS = ['context', 'files', 'tools', 'sources']`, `SECTION_LABELS.context = 'panel.context.tab'`), `src/renderer/components/chat/header/chat-header.tsx` (ring beside `ModelChip`), `src/renderer/lib/stream-manager.ts` (`finally`: also invalidate `chatContextKeys.detail(stream.chatId)`), `packages/shared/src/constants/test-ids.ts`, `packages/shared/src/i18n/locales/*/chat.json`, CLAUDE.md (chat header bullet: the ring; chat panel: the Context tab)

**Interfaces:**

- Consumes: Task 5's `ChatContextSnapshot` and route.
- `chatContextKeys = { detail: (chatId: string) => ['chat', chatId, 'context'] as const }`; `useChatContext(chatId: string | undefined)` — `refetchOnWindowFocus: true`, `retry: false` (404 means "nothing yet" → `data` undefined, never an error toast: use `meta.silent` / treat `HttpError` 404 as `null`).
- `contextMeter(s: ChatContextSnapshot): { percent: number | null; pastCompaction: boolean; rows: { key: ContextPartKey; tokens: number; share: number | null }[]; free: number | null; compactPercent: number | null }` — `percent` and shares are `null` when `contextWindow ≤ 0`; `pastCompaction` = `compactAt != null && summaries + messages >= compactAt`; `compactPercent = compactAt / contextWindow × 100`; `free = max(0, contextWindow − total)`.
- Test ids: `TEST_IDS.chat.header.contextRing = 'chat.header.context-ring'`, `TEST_IDS.chat.panel.contextSection = 'chat.panel.context-section'`.
- i18n (chat namespace, all locales), English copy:
  - `header.contextRing`: `"Context {{percent}}% · {{used}} / {{window}}"` (tooltip and aria-label)
  - `panel.context.tab`: `"Context"`
  - `panel.context.used`: `"{{percent}}% used · {{used}} / {{window}}"`; `panel.context.usedNoWindow`: `"{{used}} tokens"`
  - `panel.context.part.{system,skills,mcp,tools,memory,summaries,messages}`: `"System prompt"`, `"Skills"`, `"MCP"`, `"Tools"`, `"Memory"`, `"Summaries"`, `"Messages"`; `panel.context.free`: `"Free space"`
  - `panel.context.estimated`: `"Estimated"`; `panel.context.asOf`: `"As of {{time}}."`; `panel.context.compactsAt`: `"Compacts when messages reach {{percent}}%."`; `panel.context.compactionOff`: `"Compaction is off."`; `panel.context.empty`: `"Send a message to see what fills this chat's context."`
- Token numbers: `Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 })` through the existing `useFormat()` (add a `compactNumber` formatter there if none exists) — "586.3K / 1M".

- [ ] **Step 1: Write the failing tests.**
  - `context-meter.test.ts`: window 1 000 000, total 586 300 → `percent 58.63` (render rounds to 59); `free 413 700`; compactAt 750 000 with summaries+messages 700 000 → `pastCompaction false`, 760 000 → `true`; `contextWindow 0` → `percent null`, every `share null`, `free null`; `compactAt null` → `pastCompaction false`, `compactPercent null`.
  - `context-section.test.ts` (happy-dom): renders seven rows + Free space with names from the catalog; shows "Estimated" only when `estimated`; shows `compactionOff` when `compactAt` is null.
  - `chat-context.spec.ts` (Playwright, faux provider): send a message → `getByTestId(TEST_IDS.chat.header.contextRing)` is visible → click it → `getByTestId(TEST_IDS.chat.panel.contextSection)` is visible and contains "Messages".
- [ ] **Step 2: Run** the two unit files — Expected: FAIL (modules missing).
- [ ] **Step 3: Implement.** Ring: an SVG circle ~16 px, stroke in `text-primary-ink`, amber (`text-amber-…` is not allowed — use the `--chart-4` or an existing warning token from globals.css) once `pastCompaction`; hidden when there is no snapshot; no percentage text (it is in the tooltip); clicking sets `chatPanelAtom` to `{ open: true, section: 'context' }`. Panel tab: the "used" line, one stacked bar (one segment per part, `--chart-1…` tokens in part order, a 1 px tick at `compactPercent`), one row per part (swatch, name, compact tokens, share %), Free space, then the muted foot (`asOf` with `useFormat().relativeTime`, then `compactsAt` or `compactionOff`, plus "Estimated" when estimated). No snapshot → `panel.context.empty`. Follow `settings-kit` / chat-panel styles; no `transition-all`; entrances from `lib/motion.ts` only if the panel's other tabs use them.
- [ ] **Step 4: Run** the unit files (PASS); `bun run typecheck && bun run lint && bun run i18n:check && env PWD=$PWD bun run test`; then (port 60223 free: `curl -s --noproxy '*' -m 2 -o /dev/null -w '%{http_code}' http://localhost:60223/api/v1/host/status` prints `000`) `bun run package && bunx playwright test tests/e2e/chat-context.spec.ts tests/e2e/sidebar.spec.ts --reporter=line`. Expected: all pass.
- [ ] **Step 5: Commit** `feat(chat): a context ring and a Context tab` (Refs ISSUE-235).

### Task 7: iOS shows no money

**Files** (repo `~/Code/actovia/ios-linear`, branch `linear/2026-10-27-cost` off `main`):

- Modify: `Sources/Models/UsageSummary.swift` (drop cost properties), `Sources/Models/Settings.swift` (`ModelCost`, `cost` on the snapshot), `Sources/Models/Philharmonic/AgentCard.swift:50` (`costUsd`), `Sources/NetworkingKit/PhilharmonicAPI.swift:106` (delete `costs(days:)`), `Sources/PhilharmonicFeature/Dashboard/{DashboardView,DashboardViewModel}.swift` (no cost KPIs / by-employee cost; `load()` no longer awaits costs, so upcoming/recurring load on their own), `Sources/PhilharmonicFeature/Logic/RoundDescription.swift:23,77`, `Sources/PhilharmonicFeature/Chat/DecisionProcessView.swift:115-119`, `Sources/SettingsFeature/{ProfileSettingsPage,ProfileViewModel}.swift` (no "$X spent", total or per-model cost; `UsageFormat.cost` deleted), `Sources/SettingsFeature/SettingsGallery.swift` fixtures, `Resources/App/Localizable.xcstrings` (remove unused cost strings via `scripts/l10n.py`)
- Delete: `Sources/Models/Philharmonic/PhilharmonicCosts.swift` (then `tuist generate --no-open`)
- Test: `Tests/ModelsTests/{UsageSkillsBackupTests,PhilharmonicModelsTests,PhilharmonicFixtures,SettingsTests}.swift`, `Tests/PhilharmonicFeatureTests/{DashboardViewModelTests,RoundDescriptionTests}.swift`, `Tests/NetworkingKitTests/PhilharmonicAPITests.swift`, `Tests/SettingsFeatureTests/{ProfileSettingsTests,SettingsViewModelTests}.swift`

- [ ] **Step 1: Write the failing tests.** `UsageSkillsBackupTests`: decoding a payload **with** `totalCost` and per-day/per-model `cost` (an older desktop) succeeds and exposes the token totals. `DashboardViewModelTests`: with an API stub that has no costs endpoint, `load()` fills `upcoming` and `recurring` and sets no error. `RoundDescriptionTests`: a round with `costUsd: 0.12` describes as tokens only (no `$`).
- [ ] **Step 2: Run** `ModelsTests`, `PhilharmonicFeatureTests` schemes — Expected: FAIL (dashboard awaits costs; round line has `$`).
- [ ] **Step 3: Implement** the removals; run `python3 scripts/l10n.py audit` (0 errors) after removing strings.
- [ ] **Step 4: Run** every scheme's tests (`ActoviaIos-Workspace`) — Expected: TEST SUCCEEDED. Revert `Tuist/Package.resolved` if it changed.
- [ ] **Step 5: Commit** `refactor: no money in Profile or Philharmonic` (Refs ISSUE-235).

### Task 8: Specs that described money say they are superseded

**Files:** `docs/superpowers/specs/2026-09-19-duckdb-chat-audit-design.md`, `2026-09-12-dynamic-model-catalog-design.md`, `2026-10-16-pm-quota-aware-dealing-design.md`, `2026-10-17-pm-decision-trail-design.md` — one line under each title: `> Cost/price parts superseded by 2026-10-27-remove-cost-context-panel-design.md (ISSUE-235).`

- [ ] **Step 1:** Add the lines. **Step 2:** `env PWD=$PWD bunx vitest run tests/unit/claude-md` (freshness/staleness) — Expected: PASS. **Step 3: Commit** `docs: cost parts of older specs are superseded` (Refs ISSUE-235).
