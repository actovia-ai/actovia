# pi-ai usage review (2026-09-19)

Actovia's model layer is `@mariozechner/pi-ai` + `@mariozechner/pi-agent-core`
0.73.1 (58 import sites). This is a review of that usage against the current
upstream README
(<https://github.com/earendil-works/pi/blob/main/packages/ai/README.md>), what
was fixed as a result, and what a migration would involve.

## Fixed

### Failed requests were read as empty answers

pi-ai does not reject when a request fails. A 429, an expired key or a dropped
connection **resolves** to an assistant message with `stopReason: 'error'`, the
detail on `errorMessage`, and empty `content` (README, "Error Handling"). The
chat route already knew this; none of the eleven `completeSimple` callers did.
Each turned the reply into `''` and carried on:

| Caller                                | What a transient provider error did                                                                                |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `philharmonic/lcm/summarize.ts`       | Overwrote the group's rolling summary with `''` — previous summary included — and marked the messages as covered   |
| `context-management/compaction.ts`    | Burned both LLM attempts instantly and fell through to the truncating fallback, replacing real context with a stub |
| `utils/chat-message-util.ts` (titles) | Saved a blank chat title                                                                                           |
| `deep-research/*`                     | "Completed" a research job with no learnings and an empty report                                                   |
| `memory/manager.ts`                   | Consolidation and recall silently did nothing                                                                      |
| `discover/manager.ts`                 | Treated as "no items"                                                                                              |

`src/main/lib/ai/utils/complete.ts` now wraps `completeSimple` and rejects with
`LlmRequestError`; every caller already had a `catch` that does the right thing
once there is something to catch. Title generation falls back to the start of
the user's message instead of rejecting (the chat route awaits it inside the
turn's `try`), and the Philharmonic summarizer refuses an empty summary.

Not routed through it: `computer-use/agent.ts` calls `complete()` and treats a
reply with no tool call as "done, unsuccessful", which already fails safe —
though the provider's reason is lost.

### Enum tool parameters

`webSearch` (`precision`, `media`) and `readFile` (`encoding`) declared enums as
`Type.Union([Type.Literal(…)])`, which serializes to `anyOf` + `const`. Google's
function-calling schema rejects that; `StringEnum` emits
`{"type":"string","enum":[…]}` (README, "Defining Tools"). Switched.

### Streaming cost

Not pi-ai's doing, but the README's warning applies: the partial message is a
live, growing object, and relaying it whole per delta is O(n²). The chat route
now coalesces `message_update` frames (`routes/chat-sse.ts`). Upstream's
`AssistantMessageFrameEncoder` (0.85) is the principled version — deltas on the
wire, one reducer on the client — and is the natural next step after a
migration, since it changes the SSE contract the iOS app also speaks.

## The package is deprecated — migrated

Done 2026-09-22, with the chat kernel
(`docs/superpowers/specs/2026-09-22-chat-kernel-design.md`,
`src/main/lib/ai/kernel/`). Both packages are `@earendil-works/pi-ai` and
`@earendil-works/pi-agent-core` 0.85; the kernel targets the `Models`
collection API directly (`getKernelModels()` in `kernel/models.ts`), and
nothing imports the `/compat` entrypoint. What the move changed in practice:

- `completeSimple` / `complete` / `getModel` go through the collection;
  `src/main/lib/ai/utils/complete.ts` keeps its contract.
- `agentLoop` takes `streamFn` as its fifth argument (Philharmonic), and the
  chat route is on pi's `Agent` through `runAgent()`.
- Ollama is a dynamic provider of its own (`ollama`); the `openai` provider in
  0.85 serves the Responses API only, as does `xai`, so the xAI spec row is
  `openai-responses`.
- `ThinkingLevel` has `max` and no `off`.
- `transform-messages.ts` is gone: cross-provider handoff of thinking blocks
  is pi's; orphaned tool results cannot arise now that context is assembled in
  whole runs (`dropBrokenRuns()` in `kernel/invariant.ts` is the last line of
  defence).

## Smaller observations

- Background completions (titles, memory, LCM, discover) pass no `signal`, so
  they cannot be cancelled on quit; `will-quit` force-exits after 5s anyway.
- `lcm-post-turn` and `memory-consolidate` job payloads carry `apiKey` and a
  serialized `Model`. Resolving both from settings inside the handler would
  keep secrets out of the queue table and survive a key rotation between
  enqueue and run.
