# Chat kernel on pi 0.85 — Design

Date: 2026-09-22
Status: Implemented on `feat/chat-kernel` (plan: `docs/superpowers/plans/2026-09-22-chat-kernel.md`).
Background: `docs/pi-ai-review.md` (the deprecated packages and the migration
path), the 2026-09-21 failure `messages.0.content.5: unexpected tool_use_id
found in tool_result blocks` (trace `1a801fcf…`).

## Summary

The chat kernel — everything between "the user pressed send" and "the rows are
in the database" — is rebuilt on `@earendil-works/pi-ai` and
`@earendil-works/pi-agent-core` 0.85, around one structural change: a **run**
(one user prompt through the final answer, with every model step and tool
result in between) gets an identity in the data, `message.runId`, and becomes
the unit that context assembly, compaction and rendering work in. Today a run
is guessed from row order in three places, and each guess fails somewhere:
context assembly cuts runs in half (the 400 above), the renderer shows one run
as several messages, three failed sends in a row break the grouping.

Alongside: the 19 built-in tools are renamed to snake_case, MCP tools are
offered through a two-tool toolbox instead of being bound one by one (and
silently truncated at 128), and the hand-written agent loop in `chat.ts` is
replaced by pi's `Agent`.

## Goals

- A request to a provider never contains a `tool_result` without its
  `tool_use`, and always starts with a user message — by construction, and
  under test for any conversation and any token budget.
- One run renders as one assistant message: a timeline of steps above one
  body of text with one action bar, streaming or replayed from the database.
- The kernel runs on maintained packages, with the loop, parallel tools,
  cancellation and cross-provider message handling owned by pi.
- Every MCP tool is reachable by the model, however many servers are
  connected; nothing is dropped silently.
- The whole kernel is testable without a provider key, including end to end.

## Non-goals

- Moving Philharmonic's employee loop, PM coordinator or recruit flow onto the
  kernel. They switch package names and keep their code; a later project.
- Steering (a message injected while tools run) and follow-up queues: pi
  supports them, this design leaves the door open (the kernel builds on
  `Agent`), and does not use them.
- The system prompt's design for autonomous tool and skill use — the next
  project, which depends on this one's tool surface.
- Any change to the iOS app: the wire format gains a field and loses nothing.

## Decisions already made

| Question                              | Decision                                                        |
| ------------------------------------- | --------------------------------------------------------------- |
| How is a run represented?             | Rows stay one per step; a `runId` column groups them            |
| Migrate to pi 0.85?                   | Yes, and the kernel targets the new API directly — no `/compat` |
| MCP tools vs the provider's tool cap? | A two-tool toolbox; built-ins stay bound directly               |
| Tool naming                           | snake_case, with a one-time migration of stored rows            |

## Architecture

### Data model

- `message.runId` — `uuid`, indexed with `chatId`. Every row of a run carries
  the id of the run's user message: the user message itself, each assistant
  step, each tool result. Not a new id space.
- **Backfill.** One Drizzle migration walks each chat in `createdAt` order: a
  `user` row opens a run, the assistant and toolResult rows after it join it.
  This is exactly the grouping the renderer infers today, so no existing chat
  changes shape.
- **Tool names.** The same migration rewrites stored rows to snake_case: the
  `toolName` column on toolResult rows, and `name` inside `toolCall` blocks in
  assistant `content`. The rename table is the source of truth for both the
  migration and the renderer; after it runs there is one spelling in the
  database and no alias layer.

| Before                                                                                                                                                                                                                                                    | After                                                                                                                                                                                                                                                                      |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `computerUse` `deepResearch` `createArtifact` `imageGeneration` `findFiles` `editFile` `lcmGrep` `grep` `lcmDescribe` `searchKnowledgeBase` `mapItinerary` `webSearch` `lcmExpand` `weather` `listDirectory` `terminal` `readFile` `webFetch` `writeFile` | `computer_use` `deep_research` `create_artifact` `image_generation` `find_files` `edit_file` `lcm_grep` `grep` `lcm_describe` `search_knowledge_base` `map_itinerary` `web_search` `lcm_expand` `weather` `list_directory` `terminal` `read_file` `web_fetch` `write_file` |

- Unchanged: every other column, the `chat` table, db-io export/import (one
  more field, backward compatible), `lcm_summary` rows.

### Context assembly: the run is the atom

`context-assembler.ts` today takes the last `freshTailSize` **items** and
back-fills older items until the token budget is spent — either cut can land
inside a run. Both become run-aligned:

- The fresh tail is the most recent N runs (`memory.freshTailSize` changes
  meaning from "16 messages" to "runs", default 6; the settings copy follows).
- Back-fill adds whole runs, newest first, and stops at the first run that
  does not fit — it is left out entirely, never trimmed.
- Compaction (`compaction.ts`) chunks leaf summaries on run boundaries: a run
  is summarized whole or kept whole. Where summaries are injected does not
  change.
- **Invariant**, under a property test (random conversations, random budgets):
  the assembled message list starts with a `user` message, and every
  `tool_result` has its `tool_use` earlier in the list.

`transform-messages.ts` is deleted. Its thinking-block conversion is done by
pi 0.85 itself (cross-provider handoff); orphaned tool results cannot arise
under the rule above; error-stopped assistant messages are no longer
persisted at all.

### The kernel: `src/main/lib/ai/kernel/`

- `models.ts` — the process's `Models` collection: the five built-in
  providers registered through 0.85's provider factories, Ollama through
  `createProvider()` as a dynamic provider. `resolveModel()` keeps its
  contract (including the live-fetched snapshot override from Settings) and
  now hands back a `Model` this collection can route; `streamFn` comes from
  here. The explicit `apiKey` per request stays, as today.
- `run.ts` — `runAgent(input): AsyncIterable<KernelEvent>`. Input: `chatId`,
  the user message, system prompt, tools, model, reasoning level, signal. It
  builds an `Agent` (`transformContext` = context assembly, `convertToLlm` =
  the LLM-role filter plus the orphan assertion below, `beforeToolCall` = the
  disabled-tool gate), subscribes, and yields the kernel's own event union —
  stable, snake_case, each carrying `runId`:

  `message_update` · `message_end` · `tool_start` · `tool_update` ·
  `tool_end` · `run_end` · `error`

- `record.ts` — `RunRecorder`: consumes those events, accumulates the run's
  messages, and persists them however the run ends (done, provider error,
  Stop). This is `chat.ts`'s current `persistTurn` moved and given `runId`;
  the post-run jobs (LCM, memory, search indexing) are enqueued from here.
- `chat.ts` becomes: validate → build the recorder → `for await` over
  `runAgent()` → write SSE. The hand-rolled loop, `toolMsgIds`, the
  `effectiveReasoning` mapping and the message-shape juggling go.

### Tools

- All 19 built-ins renamed per the table; `AgentTool` and `Type` come from the
  0.85 packages (TypeBox is re-exported by pi-ai). `label` stays for the UI.
- **MCP toolbox.** MCP servers are not bound tool by tool. Two built-ins stand
  in for all of them: `list_mcp_tools({ server?, query? })` returns each
  tool's name, one-line description and parameter schema (filtered by server
  and/or a substring); `call_mcp_tool({ server, tool, arguments })` forwards
  the call and returns the result unchanged. The system prompt carries a
  directory — one line per connected server: name, description, tool count —
  so the model knows what exists and looks up details when it needs them.
- `MAX_TOOLS` and its silent truncation are removed: 19 built-ins plus two
  meta-tools sit far below every provider's limit, and exceeding it in future
  is an error, not a trim.
- The "this tool is disabled in settings" checks move into one
  `beforeToolCall` hook.

### Wire format and rendering

- SSE events keep their shapes; every message on the wire gains `runId`.
  The frame coalescing in `chat-sse.ts` stays. The iOS app needs nothing.
- `messages.tsx` groups by `runId` — no more "a run is a contiguous
  non-user span". One run renders as **one** assistant message: the existing
  `ThinkingTimeline` (thinking, tool calls, tool results) above one body that
  joins every assistant text block of the run in order — the text after a
  `toolUse` stop is the next paragraph, not the next message — with one
  action bar (copy, regenerate, timestamp, "Worked for Xs").
- While streaming, the body grows with the last text block; a tool call in the
  middle adds a timeline step and the body continues. The render-path caches
  and memo rules (`CLAUDE.md`, "When Working with the Chat Render Path")
  carry over keyed on `runId`.
- Backfilled chats render under the same rule, which merges what used to be
  several messages into one.

### Errors and Stop

- A provider failure mid-run (4xx/5xx, timeout): the run ends, the steps that
  completed are persisted (the `finally` persistence from the hardening pass
  stays), one `error` event is sent, and the renderer shows the error at the
  foot of that message rather than as a message of its own.
- Stop: `agent.abort()`; the partial assistant message is persisted with
  `stopReason: 'aborted'`; the next prompt includes it — pi 0.85 documents
  continuing after an aborted message.
- Last line of defence for the 400 class: `convertToLlm` asserts the
  invariant; a violation drops the offending run from the request and logs
  an `error` with the chat id, instead of sending it.

### Testing

- **Kernel**: pi's `fauxProvider()` with scripted replies — call this tool,
  then say this, fail at step three, get aborted — covering multi-step and
  parallel tool runs, provider errors, Stop, and the toolbox's list/call. No
  provider key anywhere.
- **Context invariant**: the property test above.
- **Migration**: on a real in-memory PGlite — runId backfill on a fixture
  chat, snake_case rewrite of both the column and the JSON.
- **Rendering**: grouping by `runId`, one message per run, and the existing
  render-count tests extended so that only the streaming run re-renders.
- **E2E**: a faux provider registered only when `ACTOVIA_FAUX_PROVIDER=1` lets
  the Electron e2e run a full conversation with a tool call. Today every chat
  spec is skipped for want of a key; this is the base for all chat e2e from
  here on.
- **Real providers**: after the migration, `tests/providers` with the user's
  keys — one tool-calling conversation each on Anthropic, OpenAI and Gemini.

## Risks

- **Package surface.** 0.85 changes `agentLoop`'s signature, event types and
  the `Models` API; Philharmonic's code compiles against the new packages
  without behaviour changes, which is a mechanical but wide edit. Covered by
  its existing unit tests.
- **Snapshot models.** The Settings-fetched model snapshots are hand-built
  `Model` objects layered over the registry; 0.85 routes by `model.provider`,
  so they keep working as long as the provider is registered. Verified in the
  models unit tests.
- **Backfill on large databases.** The migration is a single pass per chat in
  SQL; measured on the user's own database before it ships.

## Documentation

`CLAUDE.md`: the kernel module, `runId`, the tool-name table, the toolbox, the
new meaning of `freshTailSize`, the faux-provider e2e switch; the Chat Flow
section is rewritten around `runAgent()`. `docs/pi-ai-review.md`: the
migration section becomes "done, see the kernel spec".
