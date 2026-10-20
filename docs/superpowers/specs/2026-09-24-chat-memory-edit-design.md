# Edit memory from the chat — design

Status: approved in conversation on 2026-09-24 (four sections, one at a time). Desktop only; the iOS app follows
later.

## 1. Goal

Memory (`src/main/lib/ai/memory/`) can be stale or wrong. Today the only way to fix it is Settings → Memory. The
user wants to correct it from the chat — "that's wrong, I moved to Linux" — and see it happen. Decisions:

- **Autonomy:** the model changes memory directly when the user corrects it or asks it to remember / forget; the
  change is shown in the transcript with an **Undo**. No confirm step (matches the system prompt's autonomy policy).
- **Engine:** the tool takes a free-text instruction and reuses `runMemoryInstruction` — the same engine as the
  Settings → Memory instruction box. It sees every entry (not only the ones selected for this reply), at the cost
  of one extra model call per edit.
- **Visibility of what was used:** each reply shows which memory entries were injected into it, with a "this is
  wrong" shortcut, so the user knows what to correct.

Current state (checked 2026-09-24): no memory tool in `TOOL_NAMES`; post-run `runMemoryConsolidation` may create
or update implicitly (never deletes, invisible); `runMemoryInstruction` (`manager.ts:259`, route
`POST /api/v1/memory/instruct`) turns an instruction into create / update / delete ops and returns `{ applied }`;
`<user_memory>` carries no ids; `memory_usage_log` records `sessionId` (the chat), not the run.

## 2. Backend: engine, tool, undo

### 2.1 Engine

`runMemoryInstruction` returns `{ applied, changes: MemoryChange[] }`:

```ts
type MemorySnapshot = {
  section: MemorySection
  key: string
  summary: string
  details: string[]
  isActive: boolean
}
type MemoryChange = {
  op: 'create' | 'update' | 'delete'
  id: string
  before: MemorySnapshot | null // null for create
  after: MemorySnapshot | null // null for delete
}
```

(`MemoryChange` / `MemorySnapshot` live in `packages/shared/src/types/memory.ts` — the renderer reads them.)
Deletion stays a hard delete; undo re-inserts the `before` snapshot under the original id. The Settings route
keeps its behaviour (it gains a field in its response).

### 2.2 Tool `update_memory`

- `TOOL_NAMES.updateMemory = 'update_memory'` (added first), `src/main/lib/ai/calling-tools/update-memory.ts`,
  bound by `bindCallingTools` like the other built-ins, listed in `TOOL_REGISTRY` so Settings → Built-in Tools can
  switch it off (a disabled tool is also refused by the kernel's `beforeToolCall`).
- Parameters (TypeBox): `{ instruction: string }` — what to change, in the user's terms.
- Runs the engine with the chat's model and API key.
- Result: text for the model — a one-line summary ("Updated 'Work setup'; deleted 'Old address'"), or "No memory
  change was needed" — and `details: { changes }` for the renderer. An engine failure is a tool error (the model
  sees it; the strip shows the failed state).

### 2.3 Undo

`POST /api/v1/memory/undo { changes: MemoryChange[] }` → `{ undone: string[], skipped: string[] }` (ids).
For each change, in reverse order:

- only if the entry's current state still equals `after` (a missing row equals `after === null`); otherwise it is
  skipped — undo never overwrites a later edit;
- `create` → delete the row; `update` → write `before` back; `delete` → re-insert `before` with the original id.

Running the same undo twice is a no-op the second time (everything is skipped or already in `before`).

### 2.4 Prompt

`prompts.ts`, memory group: when the user corrects something you know about them, or asks you to remember or
forget something, call `update_memory` with a plain instruction — without asking first. `prompts.test.ts` requires
every tool to be described; add it.

## 3. Which memories a reply used

- **Storage:** `memory_usage_log` gains `runId uuid` and `key text` (the entry's title at the time, so a later
  delete still has a name). New Drizzle migration; old rows keep nulls and show nothing.
  `loadRelevantMemories(question, model, apiKey, sessionId, runId)` writes both.
- **While streaming:** memories are chosen before the model starts, so the chat route sends a new SSE event
  `{ type: 'memories_used'; runId; memories: Array<{ id; key; section }> }` before the first frame (added to
  `ChatSseEvent`; clients that do not know it ignore it — the iOS app does).
- **History:** `GET /api/v1/memory/usage?chatId=` → `Record<runId, Array<{ id; key; section }>>`, read by a React
  Query hook per chat; the SSE event writes the live run straight into that hook's cache.
- **UI:** a line at the foot of the reply, beside the action bar — "Used 2 memories · Work setup, Classical music".
  A popover lists each entry live (summary + details; a deleted one greyed, "Deleted"), with **This is wrong**
  (prefills the composer: "The memory about 'Work setup' is wrong: " with the caret after it) and **Open in
  Settings**. Nothing is shown when no memory was used or "use memory in chat" is off.

## 4. The memory-change strip

- **Placement:** at the foot of the run that changed memory, next to the "used memories" line — not inside the
  thinking timeline, which folds when the run ends.
- **Shared component:** the frosted strip of `lcm-status-card.tsx` becomes `StatusStrip`; the compaction card and
  this one both use it.
- **States:**
  - running — "Updating memory…" with a spinner, from the tool's start event;
  - done — "Memory updated · Work setup, Old address"; expands (`Reveal`) to each change: before/after per field,
    "New" for a create, "Deleted" for a delete; **Undo** on the right;
  - undone — "Undone"; partial — "Undid 1 · 1 was changed since and kept";
  - failed — the destructive strip ("Couldn't update memory"), error reported to the log.
- **After a reload:** undo state is not stored. On mount the strip compares the entries' current state with
  `after`; if none still match, the button is hidden and the text reads "Undone or changed since".
- A finished `update_memory` (and an undo) invalidates the memory queries, so an open Settings → Memory page
  refreshes (move that page's reads onto React Query if they are not yet).
- Motion: `ENTER_UP` entrance like the compaction strip, `Reveal` for the details (CLAUDE.md "Motion"). All copy in
  the `chat` namespace, 10 locales in the same commit. `TEST_IDS` for the strip, its Undo, the used-memories line,
  its popover and "This is wrong".
- **The iOS app:** out of scope. It ignores the new event and shows the tool as a generic card.

## 5. Testing

- Engine on a real in-memory PGlite (`createMigratedPglite`) with the model on pi's faux provider: `changes` has
  the right before/after for create, update and delete; an unparseable reply still throws; the Settings route
  tests stay green.
- Undo: each op reversed (a delete re-inserted under its id); a change whose current state differs from `after` is
  skipped and reported; running it twice equals running it once.
- Tool: a faux run calling `update_memory` → the tool result carries `changes` and the right summary; disabled in
  settings → blocked by `beforeToolCall`; `prompts.test.ts` covers it.
- Used memories: the migration on PGlite; `loadRelevantMemories` records `runId` and `key`; the usage route groups
  by run; the chat route's faux test sees `memories_used` before the first `message_update`.
- Renderer (happy-dom): the hook takes the SSE event into its cache; strip states (running, done, undone, partial,
  failed); "This is wrong" prefills the composer; `messages-rerender.test.ts` stays green — the new foot line
  re-renders only when its own run's data changes.
- Playwright e2e on the faux provider: a scripted `update_memory` shows the strip; Undo restores the entry.
- Gate: fmt → lint → typecheck → i18n:check → test. CLAUDE.md updated (tool list, Memory section, routes, SSE
  events).

## 6. Out of scope

The iOS app; editing memory by clicking in the popover (the chat does it); soft delete; persisting the undo state.
