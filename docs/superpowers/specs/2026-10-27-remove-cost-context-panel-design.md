# Remove cost, show context — design

Linear: ISSUE-235 (owner, 2026-10-26: "把计费系统全部去掉, 一是算的不准, 二是没意思 … 那个 context
反倒更有意义", with Claude Code's Context panel as the reference). Decisions taken with the owner
on 2026-10-27 are marked **(owner)**; the rest are the builder's calls, marked **(call)**.

## Why

Every dollar figure Actovia shows is an estimate from a price table that drifts (live prices only
for xAI, fallbacks elsewhere, nothing for a CLI employee on a subscription). It is wrong often
enough to mislead and, for a single user paying their own keys, says little they act on. What
they do act on is how full a chat's context is — when it will compact, what is filling it.

## Goals

1. **No money anywhere.** Nothing computes, stores, serves or shows a cost in either app.
2. **Tokens stay.** Every token count shown today keeps showing.
3. **A Context view on the desktop**: how much of the chat's context window the chat uses, made
   of what, and where compaction starts.

## Non-goals

- iOS Context view — later, once the desktop one has settled **(owner)**. iOS loses its money
  this round.
- Rewriting stored rows. Old `message.usage.cost`, `task_execution.tokenUsage.cost` and PM round
  `costUsd` stay in their JSON; nothing reads them **(call)** — a migration over every message row
  buys nothing.
- Changing _how_ LCM compacts. One fix is in scope (§3): it is handed the model's real window.

## Anti-goals

- A "cost" that reappears under another name (credits, units, "≈$"). Chat Audit's
  `input_cost_units` (a cache-weighted token unit, not money) goes with the rest **(call)**; the
  preset keeps `hit_pct`.
- A context number that disagrees with the provider's. Where the provider reported the real
  input size, that is the total.

## 1. Removing money

**Main**

- `ai/utils/cost.ts` (`calculateCost`) is deleted; the kernel stops attaching its own `cost`
  (`run.ts`, `ChatAssistantMessage.cost` / `CostBreakdown` in `types/chat.ts` go) and the employee
  loop stops calling it. pi's types require `usage.cost` and `model.cost`, and pi computes
  `usage.cost` itself from `model.cost` (`pi-ai/dist/models.js`, called by each provider): so
  `resolveModel()` forces `cost` to zeros on **every** return path — the catalog (`registered`)
  branch returns pi's own prices, and the snapshot path falls back to `known?.cost` — and a test
  holds each path. The per-model price rows leave `resolve-model.ts` and the list-models handlers;
  `MODEL_METADATA_FALLBACK` keeps `contextWindow` / `maxTokens` only. `ModelSnapshotSchema.cost`
  leaves the settings schema (a stored catalog's `cost` is dropped on the next parse) **(call)**.
- Philharmonic: the employee loop, the execution engine (incl. ISSUE-132's `estimated` cost), the
  round recorder and the CLI drivers (`costUsd` on `turn_end`, the agent card) stop carrying
  money; their token counts stay.
- Routes: `GET /api/v1/philharmonic/costs` is removed with its page **(owner: delete the Costs
  page)**; `aggregateCosts` and `getPmCostRows` go. `GET /api/v1/usage` drops `totalCost` and every
  `cost` field (tokens and the per-model / per-day token breakdowns stay).
- Chat Audit: `cost_usd` leaves the schema and the snapshot; the `costByModel` preset goes;
  `pmDecisions` loses its `cost_usd` column; `cacheByRun` loses `input_cost_units`.

**Desktop UI**: the Costs tab and `cost-analysis.tsx` go (and their i18n keys in all locales);
the decision process's round line shows tokens only; the commented-out composer cost line is
removed.

**iOS**: the Philharmonic dashboard's cost KPIs and cost-by-employee go (the dashboard keeps what
is not money); the round line shows tokens only; Profile's "Last 30 days · $X spent", total cost
and per-model cost go; `costs(days:)` and the cost models go. Decoding tolerates an older desktop
that still sends the fields (ignored, never required).

**Compatibility** (checked 2026-10-27): the newest released iOS (v1.3.2, 2026-10-21) has no
Philharmonic, and every cost field it decodes (`UsageSummary`) falls back to `0`, as does
`ModelSnapshot.cost`. Removing the fields and the `/costs` route breaks no released build.
Unreleased iOS HEAD's dashboard awaits `costs` first in one `do` block: it is changed in the same
round so the rest of the dashboard (upcoming, recurring) loads without it.

## 2. The Context view

**What is measured.** At the start of every chat run the route already holds every part of the
request. It records, per run, a context snapshot:

| part          | from                                                                                        |
| ------------- | ------------------------------------------------------------------------------------------- |
| System prompt | `systemContent` without the parts below                                                     |
| Skills        | the `skillsIndex` string                                                                    |
| MCP           | `mcpDirectory(mcpTools)` + the two toolbox tools' schemas (bound only when MCP tools exist) |
| Tools         | the other bound tools' names, descriptions and schemas                                      |
| Memory        | `formatRunMemory(memoryRows)` + the `runMemory` blocks put before earlier runs              |
| Summaries     | LCM summary messages in the context                                                         |
| Messages      | everything else: the runs and this question                                                 |

The route holds each of these as a separate value before it joins them (`systemContent` is
`getSystemPrompt(...) + personalityPrompt`; Deep Research uses `deepResearchBootPrompt`, so
Skills and MCP are 0 there). Summaries are not marked today — they are `role: 'user'` messages
of `<summary …>` XML, which a user could also type — so `assembleContext` returns a `kinds`
array beside `runHeads` (`'summary' | 'message'`) and the route counts by it; with LCM off there
are none **(call)**.

Each part is `estimateTokens` / `estimateJsonTokens` (`context-management/token-counter.ts`),
except that an image part counts a fixed allowance (1 600 tokens, the size of a 2048 px picture
after the shared fit) instead of its base64 length — a 3 MB attachment would otherwise read as
~900k tokens and crush every other part when scaled **(call)**. The model's `contextWindow` and
the compaction mark (§3) are recorded beside them.

**Total.** The run's first `message_end` kernel event carries pi's `usage` for the first
provider call. `RunRecorder` keeps it (it observes only `run_end` today); when it is non-zero the
total is that call's real input (`input + cacheRead + cacheWrite`) and the parts are scaled to it
in proportion. A zero usage (a failed step, a provider that reports nothing) leaves the estimates,
and the view says "estimated" **(call)**.

**Stored** as one JSON column on `chat` (`context_snapshot`, migration), written by
`RunRecorder.persist()` (which runs however the run ended) and only when the run produced an
assistant message — a run that failed before any answer leaves the last good snapshot **(call)**.
The view is "as of the last message", like the reference ("Last updated … Send a message to
refresh"); a compaction after the run makes it stale, and the view says when it was taken.
Served by `GET /api/v1/chat/:id/context` → `{ takenAt, runId, model, contextWindow,
compactAt | null, total, estimated, parts: [{ key, tokens }] }`; `404` for a chat that has run
nothing.

**UI** **(owner: header ring + side panel)**

- Header, beside the model chip: a small ring filled to the share used, the ink colour of the
  tone; amber past the compaction mark. Tooltip "Context 59% · 586k / 1M". Click opens the chat
  panel on its Context section.
- Chat panel (`components/chat/panel/chat-panel.tsx`), a `context` tab, first of
  `ChatPanelSection` (files / tools / sources follow), so `chatPanelAtom` can open it: "59% used ·
  586.3k / 1M"; a single stacked bar, one segment per part (chart tokens, `--chart-*`), a tick at
  the compaction mark; one row per part — swatch, name, tokens, share — then Free space; a muted
  foot "As of <relative time>. Compacts at 75%." (or "Compaction is off").
- Refreshes when a run ends — the stream manager invalidates `['chat', id, 'context']` itself, as
  it does the history today — and on window focus.
- A chat that has run nothing shows no ring and no section.

## 3. LCM uses the model's window **(owner, 2026-10-27)**

Today neither the chat route nor the `lcm-post-turn` job hands `LcmManager` a `contextWindow`, so
every chat compacts against `DEFAULT_CONTEXT_WINDOW` (128k) whatever its model — at ~96k of
messages and summaries on a 1M model. Both now pass the chat's model's `contextWindow` (the
model `settingsForChat()` resolves). LCM still counts only context items (messages + summaries)
against `contextWindow × contextWindowPercent` (default 75%) and still compacts down toward its
target; nothing else about it changes. Consequence the owner accepted: a long chat on a large
model sends much bigger requests before it compacts.

The view's mark is that threshold: drawn on the bar at
`contextWindow × contextWindowPercent`, compared — like LCM — with Summaries + Messages, so the
ring turns amber exactly when the next run will compact. The note reads "Compacts when messages
reach 75%".

## Tests that hold it

- No money: a unit test greps `src/`, `packages/shared/src` for `cost`-named fields in wire types
  and routes (an allowlist for pi's required zeros); the API spec for `/usage` asserts no cost key.
- Snapshot: on the faux provider, a run records a snapshot whose parts sum to the total, scaled
  to the reported input; with LCM off `compactAt` is null; skills/MCP/memory parts are zero when
  absent.
- Route: 404 before any run; shape after one.
- Renderer: the ring's percentage and amber state; the section's rows and the "estimated" note;
  a Playwright check on the faux provider that the ring appears after a send and opens the panel
  (`TEST_IDS.chat.header.contextRing`, `TEST_IDS.chat.panel.contextSection`).
- LCM: the route and the post-turn job construct `LcmManager` with the model's window (a test
  that a 1M model does not compact at 96k of messages).
- `resolveModel()`: every return path has zero `cost`.
- Images: a message with a 3 MB picture counts the fixed allowance.
- iOS: the dashboard loads upcoming / recurring with no costs call.
- iOS: decoding an old desktop payload with cost fields still works; Profile and the dashboard
  render without them.

## Docs

CLAUDE.md (Chat Audit, resolve-model, Philharmonic Costs bullet, chat panel, routes),
`docs/chat-api.md` (the new route), and the specs that describe cost get a one-line "superseded
by" note.
