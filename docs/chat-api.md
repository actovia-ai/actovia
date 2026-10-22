# The chat API — technical specification

The chat API is the core of Actovia: every conversation, on the desktop and on the iOS app, goes through it, and
everything the product does with a model — tools, memory, search, regenerate, approvals — meets in it. This
document is the contract. It says what each endpoint takes and answers, what the server does with a message and in
what order, what the model is sent and why, and what a client must do with what it receives. It is written to be
kept true: when the code and this document disagree, one of them is a bug, and the change that fixes it updates
both (the checklist is §14).

Sources of truth, in the order to read them:

| What                                 | Where                                                                                                          |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| The routes                           | `src/main/lib/server/routes/chat.ts`, `chat-sse.ts`, `chat-persistence.ts`                                     |
| Request validation                   | `src/main/lib/server/schemas/chat.ts`                                                                          |
| Wire types                           | `packages/shared/src/types/chat.ts`, `chat-page.ts`, `web-search.ts`                                           |
| A run, from prompt to persisted rows | `src/main/lib/ai/kernel/` (`run.ts`, `record.ts`, `invariant.ts`, …)                                           |
| History, pages, sources, regenerate  | `src/main/lib/chat/` (`history.ts`, `page.ts`, `sources.ts`, `attempts.ts`)                                    |
| What the model sees of earlier runs  | `src/main/lib/ai/context-management/` (`context-assembler.ts`, `aging.ts`)                                     |
| The design behind §5, §7–§8          | `docs/superpowers/specs/2026-10-01-chat-history-and-context-design.md`                                         |
| Regenerate groups                    | `docs/superpowers/specs/2026-09-26-regenerate-compare-design.md`                                               |
| The kernel                           | `docs/superpowers/specs/2026-09-22-chat-kernel-design.md`                                                      |
| Approvals and the threat model       | `docs/superpowers/specs/2026-09-25-secrets-and-exfiltration-hardening-design.md`, `docs/security-hardening.md` |

---

## 1. Vocabulary

- **Chat** — a conversation, a row of `chat` (`id`: a v4 UUID the client makes; `title`; `projectId`).
- **Message** — a row of `message`: a user message, an assistant message (one model step: text, thinking, tool
  calls) or a tool result. On the wire, `ChatMessage` (§3.2).
- **Run** — one user message and everything that answered it: every model step and every tool result up to the
  final answer. `runId` is the id of the run's user message; every row of the run carries it (`message.runId`, and
  `runId` on every wire message). The run is the unit of everything below: context assembly, compaction, aging,
  pages, regenerate, rendering.
- **Regenerate group** — the runs that asked the same question again (§6). A run of a group carries an `attempt`
  state on its user row.
- **Source** — a numbered web result: a result of `web_search` or a page `web_fetch` read. Numbers (`rank`) count
  through the whole chat; the model cites one as `【N-source】` (§7).
- **Page** — some of a chat's runs, newest first, with what a client needs of the runs it has not loaded (§8).
- **Protocol 2** — the current send contract: a client sends only the new message and merges the run the server
  answers with (§4.1, §4.5). Without it the server keeps the older contract.

## 2. Transport

### 2.1 Listeners

The API is served twice from the main process (`src/main/lib/server/app.ts`):

| Listener | Address                                    | Who                                                                   | Auth                                                |
| -------- | ------------------------------------------ | --------------------------------------------------------------------- | --------------------------------------------------- |
| Loopback | `http://127.0.0.1:60223` and `[::1]`       | the desktop renderer, the Actovia CLI, `tests/api`, the iOS Simulator | none (a local process can read `~/.actovia` anyway) |
| LAN      | `https://<host>:63129` (`LAN_SERVER_PORT`) | the iOS app on a device                                               | `Authorization: Bearer <device token>`              |

The LAN listener exists only while a device is paired or a pairing window is open. Its certificate is pinned by the
device. Ports are `SERVER_PORT` / `LAN_SERVER_PORT` in `packages/shared/src/constants/systems.ts`.

### 2.2 Middleware, in order

Every request passes, in this order (`app.ts`): **compression** (LAN only, §2.4) → **origin gate** (a request with an
`Origin` other than the dev renderer's is `403`) → CORS → **auth gate** (LAN: a paired device's bearer token, else
`401`) → **lock gate** (`423 APP_LOCKED` while the app is locked) → **presence gate** (`POST /api/v1/chat/approval`
on loopback needs the window's `x-actovia-presence` token, else `403 PRESENCE_REQUIRED`) → trace (`x-trace-id` on
every response) → settings injection → the route. Every business route lives under `/api/v1`; a breaking change
ships as `/api/v2` beside it, never by changing v1 in place.

### 2.3 Responses and errors

A JSON success is the value itself (an object or a bare array), status 200. An error is always

```json
{
  "type": "error",
  "error": {
    "code": "RUN_NOT_FOUND",
    "message": "No run with that id in this chat."
  }
}
```

with the status of its code (`ERROR_STATUS` in `packages/shared/src/constants/error-codes.ts`). The codes a chat
client meets:

| Code                         | Status | When                                                                                      |
| ---------------------------- | ------ | ----------------------------------------------------------------------------------------- |
| `VALIDATION_FAILED`          | 400    | a body, a query or a path parameter does not match its schema                             |
| `VALIDATION_NO_USER_MESSAGE` | 400    | the message a send carries is not a user message                                          |
| `RUN_NOT_FOUND`              | 404    | a regenerate's `alternateOf`, a `choose`'s `runId`, a page cursor: not a run of this chat |
| `MESSAGE_NOT_FOUND`          | 404    | `GET …/messages/:messageId`: not a message of this chat                                   |
| `APPROVAL_NOT_FOUND`         | 404    | nothing waits under that `runId` + `toolCallId` (answered, timed out, stopped)            |
| `ATTEMPT_LOCKED`             | 409    | `choose` once a later run exists                                                          |
| `APP_LOCKED`                 | 423    | the app is locked                                                                         |
| `PRESENCE_REQUIRED`          | 403    | an approval answered from loopback without the window's token                             |

A failure **inside** a run (the provider refused, the network dropped) is not an HTTP error: the send was accepted,
and the failure arrives on the stream as an `error` event (§4.4).

### 2.4 Compression

On the LAN listener only (`middlewares/compress.ts`), a JSON or text response of at least 1 KB is compressed —
brotli (quality 5) when the request accepts `br`, else gzip — and never an event stream (each SSE frame must reach
the client when it is written). A page of a long chat is about seven times smaller. Loopback is never compressed:
there is no link to save.

## 3. Data

### 3.1 The `message` row

| Column                                                            | Meaning                                                                           |
| ----------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `id`                                                              | v4 UUID. A user message's id is made by the client; everything else by the kernel |
| `chatId`                                                          | the chat                                                                          |
| `runId`                                                           | the run (the id of its user message; a user row's `runId` is its own `id`)        |
| `role`                                                            | `user` · `assistant` · `toolResult`                                               |
| `content`                                                         | pi-ai content, JSONB: a string or parts (`text`, `image`, `thinking`, `toolCall`) |
| `usage`, `api`, `provider`, `model`, `stopReason`, `errorMessage` | assistant only: who answered and what it cost                                     |
| `durationMs`                                                      | the run's wall-clock time, on its last assistant row only                         |
| `toolCallId`, `toolName`, `details`, `isError`                    | tool result only. `details` is the structured payload the cards render            |
| `alternateOf`, `attempt`                                          | regenerate groups, on a run's user row only (§6)                                  |
| `searchText`                                                      | the indexable text (never sent by the pages)                                      |
| `createdAt`                                                       | order. A user row is stamped by the server; a run's rows are strictly increasing  |

Every read orders by `createdAt`. Two rules keep that order true: the server stamps the user row when it receives
it (a phone with a skewed clock once sorted its question before earlier answers), and `RunRecorder.persist()` makes
the stamps of a run's rows strictly increasing (a tool result and the next step often share a millisecond).

### 3.2 `ChatMessage` on the wire

The stream and `done` carry pi-ai messages with two fields added (`packages/shared/src/types/chat.ts`):

```ts
type ChatMessage =
  | (UserMessage & {
      id
      runId
      alternateOf?: string | null
      attempt?: Attempt | null
    })
  | (AssistantMessage & { id; runId; cost?; durationMs? })
  | (ToolResultMessage & { id; runId }) // toolCallId, toolName, content, details, isError
```

The history routes (`GET /:id`, pages) answer **rows** (§3.1's shape, `createdAt` as an ISO string); a client turns
a row into a `ChatMessage` itself (`convertToUIMessages` on the desktop, `ChatHistoryRows` on iOS: `timestamp` from
`createdAt`, the regenerate fields on user rows only).

### 3.3 The run invariant

A request to a provider must start with a user message, and every tool result must follow the assistant message
that called it. The server holds this by construction — context is assembled in whole runs (§5.2), aging replaces
content but never removes a call or a result (§5.4) — and checks it once more before anything is sent
(`dropBrokenRuns`, `kernel/invariant.ts`): a run that breaks it is dropped from the request and logged, never sent
(a single broken run once failed every request of a chat with `unexpected tool_use_id`).

### 3.4 `chat_source`

A chat's numbered sources, one row per (chat, call, rank): `rank`, `link`, `title`, `siteName`, `hostname`,
`favicon`, `snippet`, `thumbnail`, `age`, the `runId` and `toolCallId` that found it, and `content` — the text the
model was given (a search result's extract; a fetched page whole). Derived from `message`, which stays the record:
a run's sources are saved with its rows, and a chat older than the table — or restored by an import, which carries
messages only — is filled in from its messages the first time it is read (`ensureChatSources`). See §7.

## 4. Sending a message: `POST /api/v1/chat`

### 4.1 Request

```jsonc
{
  "id": "5b30d978-…",            // the chat, v4 UUID; a new id creates the chat
  "message": {                   // the new question — protocol 2
    "id": "9c1e…",               // v4 UUID: the run's id
    "role": "user",
    "content": "…" | [{ "type": "text", "text": "…" }, { "type": "image", "data": "<base64>", "mimeType": "image/png" }],
    "alternateOf": "…"           // optional: a Regenerate (§6)
  },
  "protocol": 2,
  "advancedTools": [],           // [] or ["Deep Research"]
  "reasoningEffort": "medium",   // optional: off | low | medium | high | xhigh | max
  "projectId": "…"               // optional: the chat's project (its instructions join the system prompt)
}
```

- `message` is validated (`userMessageSchema`): a v4 UUID id, `role: "user"`, text or text/image parts. Other
  fields are kept and ignored; an `attempt` a client sends is dropped — only the server sets one.
- **Pictures are prepared by the client** (`@actovia/shared/utils/image-fit`: longest side at most 2048 px, JPEG at
  0.85, PNG when transparent — the desktop's `prepareImageFile()`, exodus-ios's `ComposerPicture`). An image part
  past those limits (over 2048 px, or over 3 MB) is fitted by the server before the row is saved
  (`withFittedImages`, `ai/utils/image-fit.ts`), so the stored question — the one `done` echoes — can differ from the
  one sent in that part's `data` and `mimeType`. A remote URL, a GIF or anything that will not decode is kept as is.
- **The server owns the history.** It reads the conversation from its own rows; a send carries only what is new.
  (Clients used to post the whole conversation back with every message — 2.4 MB for a chat with a few searches, on
  a phone's uplink.)
- **Compatibility:** `messages: ChatMessage[]` instead of `message` is accepted from an older client; only its last
  element — the new question — is used. A body must carry one or the other (`400 VALIDATION_FAILED`).

### 4.2 What the server does, in order

1. **Validate** the body; the new message must be a user message (`400 VALIDATION_NO_USER_MESSAGE`).
2. **Regenerate?** `alternateOf` is resolved to its group's first run (`404 RUN_NOT_FOUND` before anything is
   written). Any client `attempt` is dropped.
3. **Stamp** the user message: `runId = id`, `timestamp = now`.
4. **Create the chat** if it is new (title "New chat"; the project's `updatedAt` bumped) and start generating its
   title from the question (§4.3, `title`).
5. **Settle regenerate groups** before any context is assembled: a Regenerate saves its row and opens a comparison
   (`recordRegenerate`); an ordinary message first closes an open one (`settleOpenComparison`). §6.
6. **Read the history** from the database (`loadChatHistory`: every row → `ChatMessage`, every field kept,
   assistant usage rebuilt by `storedUsage`).
7. **In parallel:**
   - assemble the context of the runs before this one (§5.2) — LCM, or the history itself with LCM off;
   - the memory read filter for this message (one LLM call; skipped for Deep Research or with memory off);
   - the memory blocks of the earlier runs (§5.3);
   - the MCP servers' tools (cached five minutes per server);
   - the highest source number of the chat (§7);
   - saving the user row (an ordinary run; a Regenerate's was saved in step 5).
8. **Bind the tools** (`bindCallingTools`): the built-ins not switched off in Settings, `recall` for a chat, the
   MCP toolbox when a server is connected; with `advancedTools: ["Deep Research"]`, `deep_research` alone. Search
   tools number their sources from step 7's highest number.
9. **Age the earlier runs' tool output** (§5.4) — only while `recall` is bound.
10. **Put each run's memory block** before its question (§5.3) and this run's before this question.
11. **Compose the system prompt** (§5.1): the base prompt with the workspace, the skills index and the MCP
    directory; the personality; the project's instructions. Deep Research has a boot prompt of its own.
12. **Run the kernel** (`runAgent`, `kernel/run.ts`): pi's `Agent` over `streamFn`, with the chat id as the
    provider session (`sessionId` → OpenAI's `prompt_cache_key`), the reasoning effort (`high` for Deep Research,
    none for `off`), the request's abort signal (Stop), and the tools a setting disabled blocked before they run.
13. **Stream** every kernel event to the client (§4.3).
14. **Persist** — always, from `finally`, however the run ended (§4.4).

### 4.3 The stream

The response is `text/event-stream`. Each event is one frame, `data: <JSON>\n\n`; there are no event names, ids or
comments, and nothing is resent on reconnect. Events in the order they can occur:

| Event               | Shape                                                                                                                          | Meaning                                                                                                                     |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| `memories_used`     | `{ runId, memories: [{ id, key, section }] }`                                                                                  | Which memories the read filter chose for this run. First, before any other event, and only when it chose something          |
| `message_update`    | `{ message: ChatMessage }`                                                                                                     | The **whole** message so far — an assistant step while it streams, or a tool result. Replace by `id`                        |
| `tool_call_start`   | `{ toolCallId, toolName }`                                                                                                     | A tool began                                                                                                                |
| `approval_required` | `{ runId, toolCallId, toolName, summary, truncated?, hiddenChars?, expiresAt }`                                                | A call is paused for the user (§9)                                                                                          |
| `approval_resolved` | `{ runId, toolCallId, outcome: "allowed" \| "denied" \| "timed_out" \| "stopped" }`                                            | How the pause ended                                                                                                         |
| `notice`            | `{ level: "warning" \| "info", message }`                                                                                      | A tool's non-fatal heads-up (e.g. an expired key that only degraded enrichment). The text is the server's; show it as it is |
| `tool_call_end`     | `{ toolCallId, toolName, isError }`                                                                                            | The tool finished; its result was the `message_update` just before                                                          |
| `title`             | `{ title }`                                                                                                                    | A new chat's generated title, before `done`                                                                                 |
| `done`              | protocol 2: `{ messages: [userMessage, …run], attempts: { [runId]: Attempt } }` · otherwise `{ messages: [...history, …run] }` | The run ended and its messages are final, the last assistant one with its `durationMs`                                      |
| `error`             | `{ error: string }`                                                                                                            | The run failed (a friendly sentence, `toFriendlyChatError`); after `done` when the provider failed midway                   |

Guarantees:

- **Order.** Events arrive in the order the kernel produced them. Streaming snapshots are coalesced to at most one
  per `STREAM_FLUSH_INTERVAL_MS` (40 ms), and any other event first flushes the pending snapshot, so a client never
  sees a tool result before the step that called it.
- **Snapshots, not deltas.** A `message_update` always carries the whole message; the last one of a step is its
  final form. A client keeps one copy per `id`.
- **Ids are final.** A message's `id` and `runId` never change between its first `message_update` and `done`.
- **A tool result** arrives as `message_update` (role `toolResult`) followed by `tool_call_end` — and, between
  them, any `notice` its `details.notice` carried. A tool that reports progress (computer use) sends
  `message_update`s for its result before it ends.
- **Stop** is the client closing the request. The server aborts the agent, keeps a partial answer (marked
  `stopReason: "aborted"`), declines any paused approval as `stopped`, and still persists; writes after the client
  left are no-ops.

A typical run with one search:

```
memories_used → message_update (assistant, text + toolCall, streaming…) ×n → tool_call_start
→ message_update (toolResult) → tool_call_end → message_update (assistant, answer, streaming…) ×n
→ title (new chat only) → done
```

### 4.4 How a run ends

| Ending                 | Stream                                  | Persisted                                          |
| ---------------------- | --------------------------------------- | -------------------------------------------------- |
| Finished               | `done`                                  | every message                                      |
| Provider failed midway | `done` (what completed), then `error`   | the steps that completed; the failure is not a row |
| Failed before a step   | `done` with the question alone, `error` | the question                                       |
| Stop                   | ends; partial answer kept               | the steps that completed and the partial answer    |
| The client vanished    | —                                       | as Stop                                            |

`RunRecorder.persist()` (`kernel/record.ts`) runs from the route's `finally`. It stamps the run's duration on its
last assistant row, makes the rows' `createdAt` strictly increasing, saves them, saves the run's sources
(`chat_source`), and — with LCM on — tracks the rows into the chat's context **synchronously** (a follow-up sent a
second later must see this run). Then it enqueues the background jobs on the pgmq queue: `lcm-post-turn`
(compaction; it reads its key from settings when it runs), `memory-consolidate` (reads the conversation from the
rows when it runs; no conversation sits in the queue).
The stream stays open until the rows are written, so a client that sees the stream end can read them.

### 4.5 What a client must do

- **Show the question at once** with the id it made; it is the run's id.
- **Replace by `id`** on every `message_update`: append a message not seen yet, replace one that was.
- **On `done` (protocol 2), merge** (`mergeRun` in `packages/shared/src/utils/run-merge.ts`; `RunMerge` on iOS — the
  same vectors in both test suites): remove every message of the run (`runId`), put the run's messages where the
  run stood (or at the end), then apply `attempts` to every run's user message. Messages of other runs are kept as
  the client holds them — identity included, which the desktop's render memoization relies on.
- **On `error`**, keep what streamed and show the error at the foot of that run (the desktop's `runError`; iOS's
  `liveRunError`): it is not a row, and it lives for the session only.
- **One stream per chat.** The desktop keeps a run's stream in `lib/stream-manager.ts`, beyond the chat page, so
  opening another chat does not stop it and coming back re-attaches; it refreshes the chat list on `title` and when
  a run ends. The iOS app does the same in `ChatStreamManager`.
- **Do not send** until the history is loaded: a run is merged into the transcript the client holds.

## 5. What the model is sent

A request is `tools → system → messages`. Providers cache a prompt by its **prefix** (Anthropic: explicit
breakpoints, which pi puts on the last tool, the system prompt and the last user message; OpenAI and Gemini:
automatically): a change anywhere invalidates everything after it, and a re-written prefix costs 1.25× where a read
costs 0.1×. One measured chat cost nine times what it should have, because its prefix changed on every request.
So everything below follows one rule: **whatever is sent for the past is a pure function of stored data**, the
same bytes on every request until something real changes.

### 5.1 The system prompt

`getSystemPrompt()` (`ai/prompts.ts`), then the personality, then the project's `<project_instructions>` /
`<project_guidelines>`. It holds the date at day granularity (never a time); the skills index sorted by slug; the MCP
directory sorted by server name (a server that fails to connect drops out — a real change). Memory is **not** in
it (§5.3). The tool definitions carry no time either (`web_search`'s description once ended with an ISO timestamp,
which made every request a cache miss). Deep Research uses its own boot prompt and no memory.

### 5.2 The earlier runs

**With LCM** (`assembleContext`, `context-management/context-assembler.ts`): the chat's context items — messages
and summaries — grouped into runs by `message.runId`. The fresh tail is the newest `memory.freshTailSize` runs
(default 6), whole; older runs are back-filled whole, newest first, to the token budget, stopping at the first that
does not fit; what compaction folded is a summary (`lcm_summary`), which the model can expand (`lcm_expand`,
`lcm_grep`, `lcm_describe`). A summary-run before the first message-run is fine; a run is never split.
Assistant messages keep `api` / `provider` / `model` / `stopReason`, so pi recognises its own earlier steps and
keeps their thinking and signatures. A chat whose context is not tracked yet is bootstrapped from its rows.

**With LCM off:** the history read in §4.2 step 6, filtered the same way.

Both leave out the runs a regenerate group keeps from the model (`excludedRuns`, `packages/shared/src/utils/attempts.ts`):
`folded` and `hidden` attempts, and — for a Regenerate — every other run of its group, so the new answer sees neither
the answer it stands beside nor the question twice.

Every assistant message gets a `usage` (`storedUsage`): pi reads it off every assistant message of a request, and a
missing one failed every follow-up for a week.

### 5.3 Memory, per run

The read filter chooses memories for **this** message (`loadRelevantMemories`, logged in `memory_usage_log` with the
run's id). The block it chose is put **before this run's question**, not into the system prompt — chosen afresh for
every message, it used to change the system prompt, and with it the whole cached prefix, on every turn. Each earlier
run's question is preceded by the block its own run chose, rendered from `memory_usage_log` with the entries as they
read **now**, sorted by section (profile, topic, person) then key (`ai/memory/run-memory.ts`):

```
<user_memory>
The user's saved memory, as chosen for this message:

## Classical Music (topic)
Listens mostly to …
- …
</user_memory>
```

So a past run's block is the same bytes on every request; an entry edited since changes the runs that used it, once;
a deleted entry drops out of every run — the model is never told what the user deleted. The row saved, the history
in `done` and the clients' copy are the question alone.

### 5.4 Tool output ages

A tool's output is for the step that called it. Afterwards it is in the answer (search results), drawn for the user
(a map, the weather) or kept where it can be read again (a file) — yet it was resent in full for six more runs. So
the runs before this one carry a **digest** of each tool's output past the age its policy sets (a run's age: how
many runs came after it; the run in progress is never aged). `ai/context-management/aging.ts`:

| Tool                                                     | Whole through age | Digest after that                                                     | Way back                             |
| -------------------------------------------------------- | ----------------- | --------------------------------------------------------------------- | ------------------------------------ |
| `web_search`, `web_fetch`                                | 1 (the next run)  | per source: `[N] title — host — snippet (≤ 160)`                      | `recall({ source: N })`              |
| `read_file`                                              | 0                 | `read <path> (<lines> lines, <chars> characters)`                     | read it again, or `recall({ call })` |
| `terminal`                                               | 0                 | `$ <command>` and the last 10 lines                                   | `recall({ call })`                   |
| `grep`, `find_files`, `list_directory`, `list_mcp_tools` | 0                 | the first 10 lines and the count                                      | run it again, or `recall({ call })`  |
| `weather`                                                | 0                 | "weather for <place>, as it was then — stale now; call weather again" | not recalled: asked again            |
| `image_generation`, `update_memory`                      | always            | —                                                                     | —                                    |
| every other tool (MCP included)                          | 0                 | the first 1 000 characters and the length                             | `recall({ call })`                   |

- A failed call is never digested (the model should know why it failed); a result under 600 characters is left as it
  is; a digest is used only when it is shorter.
- A past call's string **arguments** over 300 characters (a file's content, an artifact's code) become
  `[N characters — recall({ call: "<id>" }) returns them]`; the call's id and name stay.
- Every digest is marked with its way back: `[digest of call <id> — recall({ call: "<id>" }) returns the full result]`.
- **Nothing is deleted.** `recall` (`calling-tools/recall.ts`) returns the stored text byte for byte: a source's
  full text (`chat_source.content`), or an earlier call's arguments and its stored result (images included). It
  reads this chat only, costs nothing and touches no network.
- Aging happens only while `recall` is bound — it can be switched off in Settings → Built-in Tools, and then the
  earlier runs are sent whole. A new built-in needs a `TOOL_POLICIES` row (the type requires one).
- Changing a digest's text re-writes every chat's cache once: bump `DIGEST_VERSION`.
- LCM's compaction summarises the same digests (`digestAll`), so a search dump is not paid for twice and a summary
  cites sources by number.

### 5.5 The question

The new user message, preceded by this run's memory block, its images as bare base64 (`withBareImages`).

### 5.6 Measuring it

Settings → Developer → Chat Audit → **Prompt cache by run**: per run, its first model call's
`cacheRead / (cacheRead + cacheWrite + input)` and the input-side cost in units (input 1, write 1.25, read 0.1).
The bar: the first call of a run sent within the cache's lifetime reads ≥ 90 % of its prefix.

## 6. Regenerate groups

Regenerate asks the last question again as a **new run** (new id) with `alternateOf` naming the group (the last
run, or its group). The server (`chat/attempts.ts`, the only writer of `alternateOf` / `attempt`):

- **Regenerate:** saves the new user row; it and the group's newest other visible run become `comparing`; older
  attempts `hidden`.
- **Any other message** first settles an open comparison: the newest answer that neither failed nor stopped is
  `chosen` (else the older), the other `folded`.
- **`POST /api/v1/chat/:chatId/choose`** `{ runId }` → `{ attempts: { [runId]: Attempt } }`: keeps one answer
  (`chosen`; the other `folded`), or swaps a folded one in. `404 RUN_NOT_FOUND` for a run not in a group of the
  chat; `409 ATTEMPT_LOCKED` once a later run exists (repeating the current choice always answers). Not behind the
  presence gate: it only picks which of the user's own answers the model sees next.

`attempts` in `done` and in `choose` are the stored states; a client applies them, and until the server answers it
applies the same rules locally (`attemptsAfterRegenerate`, `attemptsAfterChoice`, `attemptsAfterSettling`). What
the model sees of a group: §5.2.

## 7. Sources and citations

- **Numbering.** `web_search` and `web_fetch` share one rank registry per request, starting after the highest
  `rank` the chat's `chat_source` holds (`highestSourceRank`). So `【3-source】` names one source in the whole chat.
- **Markers.** The model cites `【N-source】`, several as `【1-source】【4-source】`. Clients draw a chip per place cited;
  Copy writes `[n]` with a References list.
- **Resolution.** A turn may cite any source found **before or in its own run**; when a number repeats (chats
  numbered before 2026-09-29, when every run counted from 1), the newest such source is the one meant. Each answer of
  a regenerate group cites what came before the group and its own sources, never its sibling's.
- **Unloaded runs.** A page carries every source of the chat (§8); a client starts each turn's sources from those of
  the runs it has not loaded (`buildCitationSources(…, olderSources)` on the desktop, `RunGrouper.group(…, base:)`
  on iOS), so a citation of a source found ten pages up still resolves.

## 8. History

### 8.1 `GET /api/v1/chat/:id/page`

Query: `runs` (1–50, default 10), `before` (a run id: the page ends just before its group), `through` (a run id: the
page reaches back at least to its group). Answer (`ChatPage`, `packages/shared/src/types/chat-page.ts`):

```jsonc
{
  "messages": [ /* rows, §3.1 shape, compacted */ ],
  "sources": [ { "rank": 1, "link": "…", "title": "…", "runId": "…", "siteName"?, "hostname"?, "favicon"?, "snippet"?, "thumbnail"?, "age"? } ],
  "questions": [ { "runId": "…", "text": "≤ 200 characters", "createdAt": 1727740800000 } ],
  "hasOlder": true,
  "olderCursor": "…"   // pass as `before` for the next older page; null when there is none
}
```

- **Whole runs, whole groups.** A page is the newest `runs` runs before the cursor; a regenerate group is never
  split — the boundary moves to take it whole.
- **`sources`:** every source of the chat, without its text. **`questions`:** every question of the chat, one per
  group, for an outline.
- **Compacted:** not sent — no client reads them (audit 2026-10-01): `searchText`, `chatId`; a successful tool
  result's `content` when its `details` carry the payload (computer use keeps it: iOS draws the final screenshot
  from it); a search result's `content` extract; an artifact call's `code`. Every error text, image, thinking block
  and memory change is sent.
- **Large rows:** a row still over 64 KB has each long string cut to its first 8 KB and `truncated: true`;
  `GET /api/v1/chat/:id/messages/:messageId` answers the row whole, and a client replaces the cut row with it as
  soon as it sees it.
- `404 RUN_NOT_FOUND` for a cursor that is not a run of the chat; `400` for a malformed one.

### 8.2 `GET /api/v1/chat/:id`

Every row of the chat, whole, as stored — the contract before pages, kept for tools and for anything that needs the
full record. Clients open chats with pages.

### 8.3 Clients

- **Open** a chat on its newest page and land at the end. While it loads, a transcript skeleton — only after
  300 ms, so nothing flashes on the LAN.
- **Scroll up** within 600 px of the top (or a first page shorter than the window) to load the page before. It goes
  in above what is read, and the scroll position moves down by what was added, so the reader stays where they were
  (the desktop container is `overflow-anchor: none`; iOS scrolls back to the run that was first, or stays at the end
  when it was there). A spinner shows at the top only after 300 ms.
- **Only runs sent during the visit animate in**; a loaded page is history.
- **The outline** (desktop) lists the unloaded questions first; picking one loads back `through` it, then scrolls
  there.
- **Memory usage** (`GET /api/v1/memory/usage?chatId=`) is read for the whole chat, loaded or not.
- **⌘F** finds what is loaded; searching the whole chat is `GET /api/v1/chat/search?query=` (⌘⇧F).
- A pull-to-refresh (iOS) starts over from the newest page.

## 9. Approvals

A tool call that would read a secret outside Actovia — `~/.ssh`, cloud credentials, browser profiles, `.env*` /
`*.pem` outside the chat workspace, a `terminal` command that prints a token, an MCP call whose arguments name any
of these — is **paused** (`kernel/approval.ts`). The stream sends `approval_required` with a `summary` (the path or
command, never contents; bidi and control characters made visible; cut from the end at 8 000 characters, with
`truncated` / `hiddenChars`) and `expiresAt` (ten minutes). A client shows it in full — wrapped, never truncated by
CSS — at the run's foot, with Allow once / Deny.

The answer is `POST /api/v1/chat/approval` `{ runId, toolCallId, decision: "allow" | "deny" }` → `{ outcome }`:
idempotent (the first answer stands), `404 APPROVAL_NOT_FOUND` once nothing waits, behind the presence gate on
loopback (the model can reach loopback through `terminal`, and must not approve its own call). Any client may
answer — the window or a paired phone. The stream then sends `approval_resolved`; anything but `allowed` gives the
model "The user declined access to <summary>." Allow is per call, never remembered. Actovia's own data
(`~/.actovia/lock.dat`, `tls/`, the database, backups, analytics) and its API ports are refused outright, never asked.

## 10. Other chat routes

| Route                                    | Answer                                                                                   |
| ---------------------------------------- | ---------------------------------------------------------------------------------------- |
| `GET /api/v1/chat/search?query=`         | one row per chat whose title or messages hold every word (PGlite)                        |
| `PUT /api/v1/chat` `{ id, …fields }`     | updates a chat (title, project, `useProjectInstructions`)                                |
| `DELETE /api/v1/chat/:id`                | deletes the chat, its rows, sources, summaries and media                                 |
| `GET /api/v1/history[?limit=&before=]`   | the chat list, whole or a page at a time (below)                                         |
| `GET /api/v1/lcm/:chatId/status`         | SSE of compaction: `init`, then `start` / `complete` / `error`                           |
| `GET /api/v1/memory/usage?chatId=`       | which memories each run used, by `runId`                                                 |
| `POST /api/v1/memory/undo` `{ changes }` | reverses an `update_memory` run's changes, newest first, each only while unchanged since |
| `GET /api/v1/media/:chatId/:file`        | a generated image                                                                        |

**The chat list.** Without `limit`, `GET /api/v1/history` answers every chat as a bare array, newest first — the
desktop renderer's contract, unchanged. With `limit` (1–100) it answers a page (`ChatHistoryPage`,
`packages/shared/src/types/chat-history.ts`): `{ "chats": […], "olderCursor": "2026-10-06T12:00:00.000Z|<id>" | null,
"favorites": […] }`. `chats` are the `limit` newest chats strictly older than `before`, ordered by `createdAt` (to the
millisecond) then `id`, both descending, favourites included; `olderCursor` is `"<createdAt ISO>|<id>"` of the last
one, passed back as `before`, and `null` on the last page (`utils/chat-history-cursor.ts`; the iOS app builds the same
string). `favorites` — every favourite, newest first — is on the first page only. A bad `limit` or cursor is `400
VALIDATION_FAILED`.

## 11. Compatibility

| Client sends                    | Server answers                                       |
| ------------------------------- | ---------------------------------------------------- |
| `message` + `protocol: 2`       | `done` = the run + `attempts` (merge)                |
| `message` without `protocol`    | `done` = the whole conversation (read from the rows) |
| `messages` (whole conversation) | only the last message is used; `done` as above       |

`GET /api/v1/chat/:id` is unchanged. Both clients shipped protocol 2 and pages together with the server; the
compatibility paths stay until a release has passed with both clients on it. A change that cannot keep an old
client working is an `/api/v2` route beside v1.

## 12. Invariants and the tests that hold them

| Invariant                                                             | Test                                                                                                             |
| --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| A request starts with a user message; every result follows its call   | `kernel/invariant.test.ts`, `context-assembler.property.test.ts` (40 seeds, real PGlite), `aging.test.ts`        |
| The tools and system prompt are the same on every request             | `web-search.test.ts` ("is the same on every request"), `skills-manager.test.ts`, `mcp-toolbox.test.ts`           |
| A past run's memory block is stable; a deleted memory drops out       | `memory/run-memory.test.ts`                                                                                      |
| Aging is pure, versioned, has a policy per tool, never removes a call | `context-management/aging.test.ts`                                                                               |
| `recall` returns stored data byte for byte, this chat's only          | `calling-tools/recall.test.ts`                                                                                   |
| Compaction summarises digests                                         | `compaction.digests.test.ts`                                                                                     |
| The server reads history, keeps every field; the user row is stamped  | `chat/history.test.ts`, `routes/chat.faux.test.ts`                                                               |
| `done` v2 and the merge                                               | `routes/chat.faux.test.ts`, `shared/utils/run-merge.test.ts`, `stream-manager.done.test.ts`, iOS `RunMergeTests` |
| Regenerate transitions and what the model sees of a group             | `chat/attempts.test.ts`, `routes/chat-attempts*.test.ts`                                                         |
| Sources: numbering, back-fill, repeated ranks                         | `chat/sources.test.ts`                                                                                           |
| Pages: whole runs and groups, cursors, compaction, large rows         | `chat/page.test.ts`, `routes/chat-attempts.test.ts`                                                              |
| Clients page and resolve unloaded sources                             | `hooks/use-older-pages.test.ts`, `messages-rerender.test.ts`, iOS `ChatDetailOlderPagesTests`                    |
| Persistence however a run ends                                        | `kernel/record.test.ts`, `routes/chat-error-logging.test.ts`                                                     |
| Approvals                                                             | `kernel/approval*.test.ts`, `routes/chat-approval.test.ts`                                                       |
| LAN compression                                                       | `middlewares/compress.test.ts`, `lan/lan.integration.test.ts`                                                    |

## 13. Performance budget

Measured on one real chat (31 messages, 7 searches; the design spec's §0) before this contract: `GET /:id` 2.36 MB,
every send uploading the same 2.4 MB, a plain follow-up ~280 k tokens of context, and `cacheRead = 0` on the first
call of every run. What the contract holds instead:

- A send uploads the new message only.
- Opening a chat reads one page — ten runs, compacted, brotli over the LAN — not the whole chat.
- An earlier search is one line per source from the run after next; tool output is whole only in the run that made
  it; the fresh tail is six runs.
- The past is the same bytes on every request, so a run's first call reads its prefix from cache when sent within the
  cache's lifetime — each provider's default. Actovia sets no cache lifetime of its own (no `cacheRetention`): providers
  cache differently, and leveling that out is not worth it (owner, 2026-10-01).

Re-measure against these numbers with Chat Audit and a page's size after any change to §5 or §8.

## 14. Changing the chat API — checklist

1. The route, its schema, and the shared wire type, together.
2. **Both clients**: the desktop (`lib/stream-manager.ts`, `hooks/use-chat.ts`, `hooks/use-older-pages.ts`,
   `components/chat/messages.tsx`) and the iOS app (`ChatStreamManager`, `ChatSseEvent`, `ChatDetailViewModel`,
   `RunGrouper`), with the same test vectors where both implement a rule (`mergeRun` / `RunMerge`).
3. A new built-in tool: `TOOL_NAMES`, a `TOOL_POLICIES` row, the system prompt line, Built-in Tools, and iOS's
   `ToolNames` / `BuiltinTools` / `desktop-tools.json`.
4. Anything sent for the past must stay a pure function of stored data (§5); a digest change bumps `DIGEST_VERSION`.
5. A new field a client reads: keep it out of `compactRow`'s drop list, or the page will not carry it.
6. This document, CLAUDE.md, and the design spec it came from.

## 15. Entity summaries: `GET /api/v1/entity/:title`

For the panel a reply's `[name](entity:Title)` link opens (rich blocks phase 2). `title` is a Wikipedia article
title (1–200 units of letters, digits, `_ ( ) . , ' - :`, percent-encoded in the path); `lang` a two- or
three-letter Wikipedia language, default `en`. The computer reads `https://<lang>.wikipedia.org/api/rest_v1/page/summary/<title>`
through the safe fetch (https, public addresses only), then English when that is a 404, and keeps the answer a day:

```jsonc
{ "title": "Marie Curie", "extract": "…", "description": "…",
  "thumbnail": { "source": "https://upload.wikimedia.org/…", "width": 330, "height": 448 } | null,
  "url": "https://en.wikipedia.org/wiki/Marie_Curie" | null, "lang": "en" }
```

An article neither language has is a `200` with `extract: null` and `url: null`. `400 VALIDATION_FAILED` for a title or
`lang` outside the rule; `503 SERVICE_UNAVAILABLE` when Wikipedia could not be reached.
