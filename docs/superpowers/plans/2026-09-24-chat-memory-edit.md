# Edit Memory From the Chat — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** the chat model can change the user's memory when corrected (`update_memory`), the change shows as a strip
at the foot of the run with Undo, and every reply shows which memory entries it used.

**Architecture:** the tool wraps the existing `runMemoryInstruction` engine, which now returns before/after snapshots
(`MemoryChange[]`); a new undo route reverses them only where the entry still equals `after`. The memories chosen
for a reply are logged per run (`memory_usage_log.runId`), announced over SSE (`memories_used`) and readable per chat
(`GET /api/v1/memory/usage`). The renderer reads both through React Query hooks and draws them in the assistant
turn's foot with a `StatusStrip` shared with the LCM compaction card.

**Tech Stack:** Electron + Hono + PGlite/Drizzle (main), React 19 + React Query 5 + Jotai + Tailwind/shadcn
(renderer), pi-ai/pi-agent-core 0.85 tools (TypeBox), Vitest (+ happy-dom), Playwright e2e on pi's faux provider.

**Spec:** `docs/superpowers/specs/2026-09-24-chat-memory-edit-design.md` (read it first).

## Global Constraints

- Branch `feat/react-query` (the owner's call); the tree is shared with other sessions — stage by name, never
  `git add -A`, never touch files you did not change; `cd /Users/yanceyleo/Code/actovia/actovia` (capital C) before
  bun/tsc (`env PWD=/Users/yanceyleo/Code/actovia/actovia bun run typecheck` if TS1149 appears).
- Pre-commit gate: `bun run fmt` → `bun run lint` → `bun run typecheck` → `bun run i18n:check` → `bun run test`.
  Never `--no-verify` except the documented PGlite WASM teardown flake after one clean retry.
- Commit trailer: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Tool wire name `update_memory` goes into `TOOL_NAMES` first; parameters are TypeBox (`Type` from
  `@earendil-works/pi-ai`); enum params use `StringEnum`, never `Type.Union(Type.Literal…)`.
- Every user-facing string is a catalog key (English source, all 10 locales in the same commit; `bun run i18n:check`).
- Every interactive element gets a `TEST_IDS` entry + `data-testid` and is referenced from a Playwright spec.
- Anything that talks to a model is tested on pi's faux provider or with `completeSimple` mocked at
  `@main/lib/ai/kernel/models` — never a real key. Queries/migrations are tested on `createMigratedPglite`.
- Components never import `useQuery`/`useMutation`/`useQueryClient`; services are pure `fetcher` wrappers;
  mutation failures toast once through the global handler (`meta.errorTitle`).
- Motion: `ENTER_UP` for the strip, `Reveal` for its details; no `transition-all`; tokens, not raw palette colours.
- The chat render path stays cheap: `AssistantTurnSegment` is memoized; new foot components subscribe to their own
  run's data only (`messages-rerender.test.ts` must stay green).

## Review Focus

- **An undo after the user edited the same entry elsewhere** (Settings, another chat) must skip that entry and say
  so, never overwrite it — Task 2 pins it.
- **An `update_memory` call when memory is empty or the instruction needs no change** returns "no change" as a
  normal result, not an error, and draws no strip — Task 3 pins it.
- **A chat opened from history whose runs predate the migration** (null `runId` in the log) shows no "used
  memories" line and does not error — Task 4 (route) and Task 6 (component) pin it.
- **A memory used by a reply and later deleted** still shows its logged title, greyed "Deleted", in the popover —
  Task 6 pins it.
- **Two `update_memory` calls in one run** show one strip listing both calls' changes; Undo reverses all of them
  newest first — Task 6 pins it.

---

### Task 1: Engine returns before/after snapshots

**Files:**

- Create: `packages/shared/src/types/memory.ts`
- Modify: `src/main/lib/ai/memory/manager.ts:259-335` (`runMemoryInstruction`)
- Modify: `src/main/lib/db/memory-queries.ts` (add `restoreMemory`)
- Test: `tests/unit/main/lib/ai/memory/instruction-changes.test.ts`

**Interfaces:**

- Produces:

  ```ts
  // packages/shared/src/types/memory.ts
  export type MemorySection = 'profile' | 'topic' | 'person'
  export interface MemorySnapshot {
    section: MemorySection
    key: string
    summary: string
    details: string[]
    isActive: boolean
  }
  export interface MemoryChange {
    op: 'create' | 'update' | 'delete'
    id: string
    before: MemorySnapshot | null
    after: MemorySnapshot | null
  }
  export interface MemoryInstructionResult {
    applied: number
    changes: MemoryChange[]
  }
  ```

  `runMemoryInstruction(instruction, scopeMemoryId, model, apiKey): Promise<MemoryInstructionResult>`;
  `snapshotOf(row: MemoryRow): MemorySnapshot` (exported from manager.ts);
  `restoreMemory(id: string, userId: string, s: MemorySnapshot, source: MemorySource): Promise<MemoryRow>` in
  memory-queries.ts (inserts with the given id).

- [ ] **Step 1: Write the failing test.** Real PGlite: mock `@main/lib/db/db` with
      `drizzle(await createMigratedPglite('0008'))` (see `tests/unit/helpers/migrated-pglite.ts` and an existing
      PGlite-backed test such as `tests/unit/main/lib/ai/context-management/context-assembler.property.test.ts` for the
      mock pattern); mock `@main/lib/ai/kernel/models` so `completeSimple` returns a scripted JSON reply (pattern in
      CLAUDE.md "Writing Tests"). Seed two rows with `createMemory`.

  ```ts
  it('reports before/after for each op', async () => {
    const work = await createMemory({
      userId: LOCAL_USER_ID,
      section: 'profile',
      key: 'Work setup',
      summary: 'Uses macOS',
      details: ['MacBook'],
      source: 'explicit'
    })
    const old = await createMemory({
      userId: LOCAL_USER_ID,
      section: 'person',
      key: 'Old address',
      summary: 'Lived in Lyon',
      source: 'implicit'
    })
    reply(
      JSON.stringify({
        operations: [
          {
            op: 'update',
            id: work.id,
            section: 'profile',
            key: 'Work setup',
            summary: 'Uses Linux',
            details: ['ThinkPad']
          },
          { op: 'delete', id: old.id },
          {
            op: 'create',
            section: 'topic',
            key: 'Rust',
            summary: 'Learning Rust',
            details: []
          }
        ]
      })
    )

    const { applied, changes } = await runMemoryInstruction(
      'I use Linux now…',
      null,
      model,
      'k'
    )

    expect(applied).toBe(3)
    expect(changes[0]).toEqual({
      op: 'update',
      id: work.id,
      before: {
        section: 'profile',
        key: 'Work setup',
        summary: 'Uses macOS',
        details: ['MacBook'],
        isActive: true
      },
      after: {
        section: 'profile',
        key: 'Work setup',
        summary: 'Uses Linux',
        details: ['ThinkPad'],
        isActive: true
      }
    })
    expect(changes[1]).toEqual({
      op: 'delete',
      id: old.id,
      before: expect.objectContaining({ key: 'Old address' }),
      after: null
    })
    expect(changes[2]).toMatchObject({
      op: 'create',
      before: null,
      after: expect.objectContaining({ key: 'Rust' })
    })
    expect(await getMemoryById(changes[2].id)).not.toBeNull()
  })
  it('an instruction that needs no change returns no changes', async () => {
    /* reply {operations:[]} → { applied: 0, changes: [] } */
  })
  it('an unknown id is ignored, not reported', async () => {
    /* update with id 'nope' → no change entry */
  })
  it('still throws on an unparseable reply', async () => {
    /* reply 'not json' → rejects "Couldn't interpret" */
  })
  ```

  Also: `restoreMemory` inserts under the given id and `getMemoryById` returns it.

- [ ] **Step 2: Run** `bunx vitest run tests/unit/main/lib/ai/memory/instruction-changes.test.ts` — expect FAIL
      (`changes` undefined, `restoreMemory` not exported).
- [ ] **Step 3: Implement.** Add the shared types. In `memory-queries.ts`:
  ```ts
  export async function restoreMemory(
    id: string,
    userId: string,
    s: MemorySnapshot,
    source: MemorySource
  ): Promise<MemoryRow> {
    const [row] = await db
      .insert(memory)
      .values({
        id,
        userId,
        section: s.section,
        key: s.key,
        summary: s.summary,
        details: s.details,
        isActive: s.isActive,
        source
      })
      .returning()
    return row as unknown as MemoryRow
  }
  ```
  In `manager.ts` add `snapshotOf` and make `runMemoryInstruction` build `changes`: `before = snapshotOf(existing
  row)` looked up from `all` by id; `after = snapshotOf(returned row)` from `updateMemory`/`createMemory` (they
  return the row); delete → `after: null`. Return `{ applied, changes }`. `applied === changes.length`.
- [ ] **Step 4: Run** the test file and the existing memory route tests
      (`bunx vitest run tests/unit/main/lib/server/routes tests/unit/main/lib/ai/memory`) — PASS.
- [ ] **Step 5: Commit** `feat(memory): the instruction engine reports what it changed` (the three source files +
      the test).

### Task 2: Undo

**Files:**

- Create: `src/main/lib/ai/memory/undo.ts`
- Modify: `src/main/lib/server/routes/memory.ts` (add `POST /undo` BEFORE the `/:id` routes)
- Test: `tests/unit/main/lib/ai/memory/undo.test.ts`, `tests/unit/main/lib/server/routes/memory-undo.test.ts`

**Interfaces:**

- Consumes: `MemoryChange`, `MemorySnapshot`, `snapshotOf`, `restoreMemory`, `updateMemory`, `hardDeleteMemory`,
  `getMemoryById`, `LOCAL_USER_ID`.
- Produces: `undoMemoryChanges(changes: MemoryChange[]): Promise<{ undone: string[]; skipped: string[] }>`;
  route `POST /api/v1/memory/undo` body `{ changes: MemoryChange[] }` → `successResponse(c, { undone, skipped })`
  (validate `changes` is an array with a zod schema; 400 via `ValidationError` otherwise).

- [ ] **Step 1: Failing tests** (real PGlite as in Task 1):
  ```ts
  it('reverses create, update and delete, newest first', …)          // create → row gone; update → before written; delete → row back under same id
  it('skips an entry changed since, and reports it', …)              // update the row after the change → skipped: [id], row untouched
  it('is a no-op the second time', …)                                // run twice → second: undone [] skipped [...ids] and DB equal to after-first
  it('treats a missing row as matching after === null', …)           // delete change, row still missing → restored
  ```
  Equality = `snapshotOf(current)` deep-equals `after` (compare `details` arrays in order); a missing row matches
  only `after === null`. Route test: 400 on `{}`; 200 returns `{ undone, skipped }` (mount `memoryRouter` on a
  Hono app like the existing route tests do).
- [ ] **Step 2: Run** — FAIL (module missing).
- [ ] **Step 3: Implement** `undo.ts`:
  ```ts
  export async function undoMemoryChanges(changes: MemoryChange[]) {
    const undone: string[] = []
    const skipped: string[] = []
    for (const change of [...changes].reverse()) {
      const row = await getMemoryById(change.id)
      const current = row ? snapshotOf(row) : null
      if (!isEqual(current, change.after)) {
        skipped.push(change.id)
        continue
      }
      if (change.op === 'create') await hardDeleteMemory(change.id)
      else if (change.op === 'update' && change.before)
        await updateMemory(change.id, change.before)
      else if (change.op === 'delete' && change.before)
        await restoreMemory(change.id, LOCAL_USER_ID, change.before, 'explicit')
      undone.push(change.id)
    }
    return { undone, skipped }
  }
  ```
  (`isEqual` from `lodash-es` if already a dependency — check `package.json`; otherwise a small local deep compare.)
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(memory): undo a set of memory changes unless edited since`.

### Task 3: The `update_memory` tool, its setting and its prompt line

**Files:**

- Modify: `packages/shared/src/constants/tool-names.ts` (add `updateMemory: 'update_memory'`)
- Modify: `packages/shared/src/constants/tools.ts` (registry entry, group `'AI & Data'`)
- Modify: `packages/shared/src/i18n/locales/*/settings.json` (`tools.registry.updateMemory.label` / `.description`, 10 locales)
- Create: `src/main/lib/ai/calling-tools/update-memory.ts`; Modify: `calling-tools/index.ts` (export)
- Modify: `src/main/lib/ai/utils/tool-binding-util.ts` (bind for chats only)
- Modify: `src/main/lib/ai/prompts.ts` (memory group line)
- Modify: `src/renderer/components/settings/settings-form/tool-config.tsx` only if its keyed map requires an entry
  (read `tool-config.test.ts` — it pins keys to the registry)
- Test: `tests/unit/main/lib/ai/calling-tools/update-memory.test.ts`, `tests/unit/main/lib/ai/prompts.test.ts`
  (extend), `tests/unit/main/lib/ai/utils/tool-binding-util.test.ts` (extend or create)

**Interfaces:**

- Consumes: `runMemoryInstruction` (Task 1).
- Produces: `updateMemory(model: Model<string>, apiKey: string): AgentTool<typeof schema>` with
  `details: { changes: MemoryChange[] }` — the renderer (Task 6) reads `toolResult.details.changes` for
  `toolName === TOOL_NAMES.updateMemory`.

- [ ] **Step 1: Failing tests.**
  ```ts
  // update-memory.test.ts — mock @main/lib/ai/memory/manager
  it('passes the instruction and returns a summary + changes', async () => {
    runMemoryInstruction.mockResolvedValue({ applied: 2, changes: [update('Work setup'), del('Old address')] })
    const tool = updateMemory(model, 'k')
    const result = await tool.execute('call-1', { instruction: 'I use Linux now' })
    expect(runMemoryInstruction).toHaveBeenCalledWith('I use Linux now', null, model, 'k')
    expect(result.content[0].text).toBe("Updated 'Work setup'; deleted 'Old address'.")
    expect(result.details.changes).toHaveLength(2)
  })
  it('no change is a normal result', async () => { /* changes [] → text 'No memory change was needed.', details.changes [] */ })
  it('an engine failure throws (the kernel turns it into a tool error)', …)
  // tool-binding-util: bound when chatId + model + apiKey; not bound without chatId (Philharmonic); not bound when disabled
  // prompts.test.ts: the existing per-tool assertion covers TOOL_NAMES.updateMemory once it is in TOOL_NAMES
  ```
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement.**
  ```ts
  const schema = Type.Object({
    instruction: Type.String({
      description:
        'What to change in the user\'s memory, in plain words — e.g. "They use Linux now, not macOS" or "Forget their old address".'
    })
  })
  export function updateMemory(
    model: Model<string>,
    apiKey: string
  ): AgentTool<typeof schema> {
    return {
      name: TOOL_NAMES.updateMemory,
      label: 'Update memory',
      description:
        "Change the user's long-term memory: correct, add or remove what you know about them. " +
        'Call it when the user corrects something you know about them, or asks you to remember or forget something.',
      parameters: schema,
      execute: async (_id, { instruction }, signal) => {
        if (signal?.aborted) throw new Error('Aborted')
        const { changes } = await runMemoryInstruction(
          instruction,
          null,
          model,
          apiKey
        )
        return {
          content: [{ type: 'text' as const, text: summarize(changes) }],
          details: { changes }
        }
      }
    }
  }
  ```
  `summarize`: `create` → `Added 'K'`, `update` → `Updated 'K'`, `delete` → `deleted 'K'` (key from `after ?? before`),
  joined with `; `, capitalised first word, trailing `.`; empty → `No memory change was needed.`
  Binding: `if (chatId && chatModel && apiKey && enabled(TOOL_NAMES.updateMemory)) tools.push(updateMemory(chatModel, apiKey))`.
  Prompt (memory group of `prompts.ts`, match its voice): "`update_memory` — when the user corrects something you
  know about them, or asks you to remember or forget something, call it with a plain instruction; don't ask first."
  Registry + 10 locales (label "Update memory"; description "Lets the assistant correct, add or remove memories when
  you tell it something about you is wrong.") — write real translations.
- [ ] **Step 4: Run** the three test files + `tests/unit/renderer/components/settings/tool-config.test.ts` +
      `bun run i18n:check` — PASS.
- [ ] **Step 5: Commit** `feat(chat): an update_memory tool the model calls when corrected`.

### Task 4: Which memories a run used — storage, SSE and route

**Files:**

- Modify: `src/main/lib/db/schema.ts` (`memoryUsageLog`: `runId: uuid('runId')`, `key: text('key')`)
- Create: `resources/drizzle/0009_*.sql` via `bun run db:generate` (commit the generated SQL + `meta/` changes)
- Modify: `src/main/lib/db/memory-queries.ts` (`logMemoryUsage` takes `runId`, `key`; add `getMemoryUsageByChat`)
- Modify: `src/main/lib/ai/memory/manager.ts` (`loadRelevantMemories(question, model, apiKey, sessionId, runId)`)
- Modify: `src/main/lib/server/routes/chat.ts` (keep the rows; send `memories_used` first)
- Modify: `packages/shared/src/types/chat.ts` (`ChatSseEvent` member + `UsedMemory` type)
- Modify: `src/main/lib/server/routes/memory.ts` (`GET /usage?chatId=`, before `/:id`)
- Test: `tests/unit/main/lib/db/memory-usage.test.ts`, extend `tests/unit/main/lib/server/routes/chat.faux.test.ts`

**Interfaces:**

- Produces:

  ```ts
  export interface UsedMemory { id: string; key: string; section: MemorySection }
  // ChatSseEvent gains: | { type: 'memories_used'; runId: string; memories: UsedMemory[] }
  getMemoryUsageByChat(chatId: string): Promise<Record<string, UsedMemory[]>>  // runId → entries, runId null rows skipped
  ```

  `GET /api/v1/memory/usage?chatId=` → `successResponse(c, Record<runId, UsedMemory[]>)`; 400 without `chatId`.
  `section` for a deleted entry: store it too — add `section text` to the log in the same migration (spec §3 lists
  runId + key; section is needed to render a deleted entry; record this as an owner-visible deviation in the report).

- [ ] **Step 1: Failing tests.** Migration applies on `createMigratedPglite('0009')`; `logMemoryUsage` with
      runId/key/section; `getMemoryUsageByChat` groups by run, skips null-run rows (old data), keeps the logged key after
      the memory row is deleted, de-duplicates an entry logged twice in one run. `chat.faux.test.ts`: with memory rows
      and a mocked read filter selecting one, the SSE stream's first event is
      `{ type: 'memories_used', runId: <user message id>, memories: [{ id, key, section }] }`; with none selected, no
      `memories_used` event is sent.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement.** Schema columns (nullable), `bun run db:generate`, inspect the SQL (only `ALTER TABLE
  ... ADD COLUMN`). In chat.ts: `memoryPromise` resolves to `MemoryRow[]` (still `[]` on failure / when off);
      `memoriesSection = formatMemoriesForSystem(rows)`; inside `start(controller)` right after `createSseWriter`, if
      `rows.length` → `sse.send({ type: 'memories_used', runId: userMessage.id, memories: rows.map(({ id, key, section }) => ({ id, key, section })) })`.
      Pass `userMessage.id` as `runId` into `loadRelevantMemories`.
- [ ] **Step 4: Run** the tests + `tests/unit/main/lib/server/routes` — PASS.
- [ ] **Step 5: Commit** `feat(memory): record and announce the memories each run used`.

### Task 5: Renderer data layer — services, hooks, stream wiring, Settings page on React Query

**Files:**

- Modify: `src/renderer/services/memory.ts` (`getMemoryUsage(chatId)`, `undoMemoryChanges(changes)`; `instructMemory`
  return type → `MemoryInstructionResult`)
- Create: `src/renderer/hooks/use-memory.ts`
- Modify: `src/renderer/lib/stream-manager.ts` (handle `memories_used`; invalidate memory after an `update_memory`
  `tool_call_end`)
- Modify: `src/renderer/components/settings/settings-form/memory.tsx` (list read via `useMemories`)
- Test: `tests/unit/renderer/hooks/use-memory.test.ts`, extend `tests/unit/renderer/lib/stream-manager*.test.ts`
  (find the existing file)

**Interfaces:**

- Produces:

  ```ts
  export const memoryKeys = { all: ['memory'] as const, list: ['memory', 'list'] as const,
    usage: (chatId: string) => ['memory', 'usage', chatId] as const }
  useMemories(): { data: MemoryItem[] | undefined; isLoading: boolean }
  useRunMemoryUsage(chatId: string, runId: string): UsedMemory[]            // select → only this run; [] when none
  useUndoMemoryChanges(): UseMutationResult<{ undone: string[]; skipped: string[] }, Error, MemoryChange[]>
  // stream-manager (module level, uses the exported queryClient):
  //   'memories_used' → queryClient.setQueryData(memoryKeys.usage(chatId), (old) => ({ ...(old ?? {}), [runId]: memories }))
  //   'tool_call_end' with toolName === TOOL_NAMES.updateMemory → queryClient.invalidateQueries({ queryKey: memoryKeys.all })
  ```

  `useUndoMemoryChanges`: wrapped `mutationFn`, `meta.errorTitle = i18n.t('chat:memoryStrip.undoFailed')`,
  `onSettled` returns `invalidateQueries({ queryKey: memoryKeys.all })`. `useMemories` gets
  `refetchOnWindowFocus: true` (the chat and consolidation write memory behind the page) — keep the WHY comment.

- [ ] **Step 1: Failing tests** (conventions of `tests/unit/renderer/hooks/use-installed-skills.test.ts`):
      `useRunMemoryUsage` selects one run and returns a stable `[]` when absent; a `memories_used` event handled by the
      stream manager lands in the cache and a mounted `useRunMemoryUsage` for that run re-renders while one for another
      run does not (render counter); an `update_memory` `tool_call_end` invalidates `memoryKeys.all`; undo mutation
      args exact, failure = one toast + one report, invalidation on settle.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement.** In `memory.tsx`, replace the `load()`/`setMemories` list state with `useMemories()`;
      local optimistic patches (`patchLocal`) become `queryClient.setQueryData(memoryKeys.list, …)` exposed as a hook
      helper (`useSetMemoryList()`), and every place that called `load()` after a write calls the hook's invalidate.
      Keep behaviour identical otherwise; read the whole file first and list every `setMemories`/`load` call site in the
      report with its replacement.
- [ ] **Step 4: Run** the hook/stream tests + `tests/unit/renderer` — PASS.
- [ ] **Step 5: Commit** `feat(memory): renderer hooks for memory usage and undo; the Memory page reads through React Query`.

### Task 6: UI — `StatusStrip`, the memory-change strip, the used-memories line

**Files:**

- Create: `src/renderer/components/status-strip.tsx` (extracted from `chat/lcm-status-card.tsx`)
- Modify: `src/renderer/components/chat/lcm-status-card.tsx` (use it; behaviour unchanged)
- Create: `src/renderer/components/chat/memory-change-strip.tsx`, `src/renderer/components/chat/used-memories.tsx`
- Create: `src/renderer/lib/run-memory-changes.ts` (pure: collect a run's changes / running state from `turn.messages`)
- Modify: `src/renderer/components/messages.tsx` (`AssistantTurnSegment` foot)
- Modify: `packages/shared/src/i18n/locales/*/chat.json` (10 locales), `packages/shared/src/constants/test-ids.ts`
- Test: `tests/unit/renderer/lib/run-memory-changes.test.ts`, `tests/unit/renderer/components/chat/memory-foot.test.ts`

**Interfaces:**

- Consumes: `MemoryChange` (Task 1), `TOOL_NAMES.updateMemory` + `details.changes` (Task 3), `useRunMemoryUsage`,
  `useUndoMemoryChanges`, `useMemories` (Task 5), `chatInputAtom` (`src/renderer/stores/input.ts`).
- Produces:

  ```ts
  // run-memory-changes.ts
  export function runMemoryChanges(messages: ChatMessage[]): { running: boolean; failed: boolean; changes: MemoryChange[] }
  //   running: an assistant toolCall named update_memory without a matching toolResult yet
  //   failed:  a matching toolResult with isError
  //   changes: every update_memory toolResult's details.changes, in call order
  <StatusStrip tone="default" | "destructive" icon={ReactNode} leaving?: boolean role="status">{children}</StatusStrip>
  <MemoryChangeStrip messages={turn.messages} />     // renders nothing when no update_memory in the run
  <UsedMemories chatId runId />                      // renders nothing when the run used none
  ```

  TEST_IDS (kebab values mirror the path): `chat.memoryStrip.root`, `chat.memoryStrip.toggle`,
  `chat.memoryStrip.undo`, `chat.usedMemories.trigger`, `chat.usedMemories.wrong`.
  i18n (`chat` ns, all 10 locales): `memoryStrip.updating` "Updating memory…", `memoryStrip.updated`
  "Memory updated · {{keys}}", `memoryStrip.undo` "Undo", `memoryStrip.undone` "Undone",
  `memoryStrip.partial` "Undid {{undone}} · {{skipped}} changed since and kept", `memoryStrip.stale`
  "Undone or changed since", `memoryStrip.failed` "Couldn't update memory", `memoryStrip.undoFailed`
  "Couldn't undo", `memoryStrip.new` "New", `memoryStrip.deleted` "Deleted", `usedMemories.label`
  "Used {{count}} memories · {{keys}}" (with `_one` plural), `usedMemories.wrong` "This is wrong",
  `usedMemories.openSettings` "Open in Settings", `usedMemories.deleted` "Deleted",
  `usedMemories.prefill` "The memory about '{{key}}' is wrong: ".

- [ ] **Step 1: Failing tests.** Pure `runMemoryChanges`: none → `{running:false,failed:false,changes:[]}`;
      pending call → running; two calls → both changes in order; error result → failed. Component tests (happy-dom,
      `createElement`, real i18n per `tests/unit/i18n` patterns or a `t` mock returning keys): strip states — running,
      done (keys listed, Undo visible), after Undo success (`undone` text), partial, stale-on-mount (current memory ≠
      `after` for all → no Undo, `stale` text), failed; Undo calls the mutation with the run's changes (both calls, see
      Review Focus). Used-memories: nothing for a run without usage; label with keys; popover shows a deleted entry
      greyed with `usedMemories.deleted`; "This is wrong" sets `chatInputAtom` to the prefill for that key.
      `tests/unit/renderer/components/messages-rerender.test.ts` still passes (run it).
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement.** Extract `StatusStrip` (the `surface` classes + tones from `lcm-status-card.tsx`), keep
      `LcmStatusCard` output identical. In `AssistantTurnSegment` render, after `MessageAction` (and also when the run
      has no body but does have memory changes), add
      `<div className="mt-2 flex flex-col gap-2"><UsedMemories chatId={chatId} runId={turn.runId} /><MemoryChangeStrip messages={turn.messages} /></div>`
      — both are small memoized components; `MemoryChangeStrip` memoizes `runMemoryChanges(messages)` on the messages
      array identity. Undo state is component-local (`idle | undone | partial`); the stale check reads `useMemories()`
      and compares each change's `after` with the current entry (`null` ↔ missing). Popover: shadcn `Popover`
      (`@/components/ui/popover`), entries from `useMemories()` by id, fallback to the logged key when missing. "This is
      wrong": `setInput(t('usedMemories.prefill', { key }))` then focus the composer (find how the composer exposes
      focus; if it doesn't, set the atom only and say so in the report). Motion: `ENTER_UP`; details via `Reveal`
      (`@/components/morph`).
- [ ] **Step 4: Run** the tests, `tests/unit/renderer`, `bun run i18n:check`, the test-ids linkage test — PASS.
- [ ] **Step 5: Commit** `feat(chat): show which memories a reply used and the memory it changed, with undo`.

### Task 7: e2e, CLAUDE.md, final gate

**Files:**

- Create: `tests/e2e/chat-memory-edit.spec.ts`
- Modify: the faux boot script if needed (`src/main/lib/ai/kernel/faux-boot.ts`) to script an `update_memory` call
  (read how existing e2e specs script replies under `ACTOVIA_FAUX_PROVIDER=1`)
- Modify: `CLAUDE.md` (tool list + `update_memory`; Memory section: per-run usage log, `memories_used` SSE event,
  `/memory/usage`, `/memory/undo`; Chat render path: the run foot components; `StatusStrip`)

- [ ] **Step 1:** e2e: seed a memory (via the API the app exposes in e2e, as other specs do), send a message whose
      scripted faux reply calls `update_memory`; expect `TEST_IDS.chat.memoryStrip.root` with the key; click
      `…undo`; expect the undone text and (via the Memory settings page or API) the entry restored. Also open
      `…usedMemories.trigger` if the scripted run used a memory, click `…wrong`, expect the composer to hold the prefill.
      Every new TEST_ID must be referenced here.
- [ ] **Step 2:** `bun run package` then `bun run test:e2e:electron -- chat-memory-edit` (never with the owner's dev
      app running on 60223 — the fixture refuses; the owner's installed Actovia.app IS running, so if the fixture refuses,
      report it and stop rather than killing the app).
- [ ] **Step 3:** CLAUDE.md edits; full gate.
- [ ] **Step 4: Commit** `test(e2e): editing memory from the chat, and docs`.

---

## Self-review notes

- Spec §2.1 → Task 1; §2.2 → Task 3; §2.3 → Task 2; §2.4 → Task 3; §3 storage/SSE/route → Task 4, hook → Task 5,
  UI → Task 6; §4 → Tasks 5–6; §5 → every task's tests + Task 7; §6 respected (no iOS, no persisted undo state).
- Deviation to confirm at review: `memory_usage_log.section` column (Task 4) so a deleted entry still renders.
- Types used across tasks: `MemoryChange`, `MemorySnapshot`, `MemoryInstructionResult`, `UsedMemory`,
  `memoryKeys`, `runMemoryChanges`, `TOOL_NAMES.updateMemory` — defined once (Tasks 1, 4, 5, 6, 3).
