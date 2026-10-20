# Chat history transport and model context — design

Status: **approved 2026-10-01** ("开始吧"; the open decisions in §G taken as proposed). Shipped on `maintenance` the
same day: **§A** (A1–A5; A6 declined, A7 waits for evidence), **§C1–C2** with the four LCM fixes
(both clients send `{ message, protocol: 2 }` and merge `done`), the LAN compression middleware (§C6), and **§B**
(`chat_source` filled in lazily from the messages rather than by a migration backfill — the same code then covers a
chat restored by an import; `recall`; aging; digest-fed compaction), **§C3–C4** and **§D** on both clients. Departures:
the outline's jump is `through=<runId>` (everything back to that run, in one request) instead of `around`; a row over
64 KB is cut per string to 8 KB and the client reads the whole row at once rather than when a card is expanded; the iOS app
has no outline, so it does not read `questions`. Open: A7.

Origin: the phone will reach the computer over Tailscale, where a chat's history is seconds on a slow link; and the
owner's question — "我们现在给 ai 的 context 是否太过冗余 … 不合理的 context 花的可真是真金白银". The rule the owner
set: **optimise without losing information** — everything stays in the database and stays reachable, by the UI and by
the model.

## 0. What was measured

One real chat (`83dddde7…`, 31 messages, 7 web searches, Claude Opus over 4 days):

|                                              |                                                                                                      |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `GET /api/v1/chat/:id`                       | **2.36 MB**, 94% of it tool results                                                                  |
| Every send (`POST /api/v1/chat`)             | uploads the same **2.4 MB**: the client posts the whole conversation                                 |
| What the model sees, per category (≈ tokens) | web_search results **243 k**, assistant text 9.6 k, image 8 k, tool-call args 3.6 k, user text 0.9 k |
| Context of a plain follow-up (no tools)      | **~280 k tokens** per request — almost all of it old search results                                  |
| Prompt cache, first call of every run        | **`cacheRead = 0`**, even 4 minutes after the previous run — the whole prefix re-written at 1.25×    |
| Input-side cost of the chat (input = 1 unit) | **2.14 M units**; with a stable prefix ~0.24 M — about **9×** over                                   |

The searches in this chat predate `SEARCH_LIMITS` (44–62 sources each); a search now brings ~10 sources / 8 k tokens.
The cache misses do not: the prefix changes on every request (§A).

Two code audits (2026-10-01) back the rest: which fields each client reads (desktop renderer and the iOS app, per tool),
and everything the server derives from the posted history.

## Principles

1. **Nothing is deleted.** The database keeps every message, argument and result as it is today. What changes is what
   is _sent_ — to the model and to the clients — and every reduced form names how to get the full one back.
2. **Stable bytes.** Whatever is sent for a past run is a pure function of stored data, so two requests send the same
   bytes for it and the provider's prompt cache reads it at 0.1× instead of re-writing it at 1.25×.
3. **The server owns history.** Clients send what is new; the server reads the rest from the database.
4. **Both clients, one contract.** The desktop and the iOS app move together; old clients keep working through the
   compatibility paths below until both have shipped.

---

## A. Prompt cache: a stable prefix

The providers cache by prefix: tools → system → messages (Anthropic: explicit breakpoints, which pi puts on the last
tool, the system prompt and the last user message; OpenAI and Gemini: automatic prefix caching). A change anywhere
invalidates everything after it.

**A1. Tool definitions are deterministic.** `web_search`'s description ends `Today is ${new Date().toISOString()}` —
millisecond precision, rebuilt on every request (`calling-tools/web-search.ts:45`), so the tools block — and with it the
whole cache — changes every time. Remove it; the system prompt already carries the date at day granularity. The binding
order (`tool-binding-util.ts`) is already fixed. Test: two `bindCallingTools` calls with the same settings serialise to
identical JSON.

**A2. The system prompt is stable within a chat.** Its last part, `<user_memory>`, is chosen per message by the read
filter (`loadRelevantMemories`) — selection and order both change, so the system prompt, and every message after it,
misses the cache on every turn. Move the memory block out of the system prompt and into **the run it was chosen for**:
when context is assembled, each run's user message is preceded by that run's memory block. The block is rendered from
`memory_usage_log` (which already records, per run, the ids the filter chose) with the entries' **current** values, in a
fixed order (section, then key):

- a past run's block is the same bytes on every request, so it caches;
- an entry edited since changes that run's block (one cache miss, then stable again) — the model never sees stale
  memory;
- a deleted entry drops out of every run's block — deleting a memory still removes it from what the model is told.

Cost: the same ~200–500 tokens per run as today, now read from cache. Deep Research is unchanged (no memory block).

**A3. The other parts in a fixed order.** The skills index sorts by slug, the MCP directory by server name (both by
insertion order today). An MCP server that fails to connect still drops out — a real change the model has to see.

**A4. Tell OpenAI which chat this is.** pi sends `sessionId` as OpenAI's `prompt_cache_key`, which routes a
conversation's requests to the same cache; the kernel passes none. Pass the chat id.

**A5. Measure it.** A Chat Audit preset: per run, `cacheRead / (cacheRead + cacheWrite + input)` of its first model
call, and the input-side cost in units — the baseline above, kept as a regression check.

**A6. Cache lifetime — declined (owner, 2026-10-01).** Anthropic's cache lives 5 minutes by default, and pi could
ask for 1 hour (`cacheRetention: 'long'`, writes at 2×). Not done: each provider caches differently (Anthropic's
breakpoints, OpenAI's and Gemini's automatic prefixes, different lifetimes and prices) and supports a longer lifetime
differently or not at all, so a per-provider cache setting is one more thing the provider layer would have to level
out. Actovia uses each provider's default lifetime; what it controls is a stable prefix (A1–A5).

**A7. Follow-up: the start of the context.** When LCM back-fills older runs to a token budget, where the context begins
can move from one request to the next, which also shifts the prefix. Pin it: the earliest included run changes only when
compaction runs. Measured first (A5), done only if it shows.

## B. Tool output in the model's context: lossless aging

A tool's output is for the step that called it. Afterwards most of it is either already distilled into the answer
(search results), drawn for the user (maps, weather, diagrams) or stored where it can be read again (files, artifacts) —
yet today it is resent in full for the next six runs (the LCM fresh tail), and its arguments too.

**B1. Ages.** For each run being assembled, its age is how many runs came after it. Age 0 is the run in progress.

**B2. Per-tool policy.** Full form at age 0 for every tool. After that, a **digest** — a pure function of the stored row
(principle 2), versioned (`DIGEST_VERSION`; a change re-writes the cache once):

| Tool                                                                 | Full form kept until                                               | Digest after that                                                   | Recoverable by                                   |
| -------------------------------------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------- | ------------------------------------------------ |
| `web_search`                                                         | age 1 (follow-ups dig into the same results)                       | per source: `[N] title — host — snippet (≤160 chars)`               | `recall({ source: N })`                          |
| `web_fetch`                                                          | age 1                                                              | `[N] title — host — first 160 chars`                                | `recall({ source: N })`                          |
| `read_file`                                                          | age 0                                                              | `read <path> (<lines> lines, <size>)`                               | read the file again, or `recall({ call })`       |
| `write_file` / `edit_file` (args: content, old/new strings)          | age 0                                                              | `wrote <path> (<bytes> bytes)` / `edited <path> (<n> replacements)` | the file itself, or `recall({ call })`           |
| `terminal`                                                           | age 0                                                              | `$ <command> → exit <code>, last 10 lines`                          | `recall({ call })`                               |
| `grep` / `find_files` / `list_directory`                             | age 0                                                              | `<n> matches in <root>`                                             | run it again, or `recall({ call })`              |
| `map_itinerary` (args: the itinerary; result: Places enrichment)     | age 0                                                              | `map: <title> — day 1: A, B; day 2: …` (names only)                 | `recall({ call })` — to edit the itinerary       |
| `create_artifact` (args: the code)                                   | age 0                                                              | `artifact "<title>" (<id>, <path>)`                                 | the file in the workspace, or `recall({ call })` |
| `weather`                                                            | age 0                                                              | `weather card for <place> at <time> — stale; call weather again`    | not recalled: re-query (free, and current)       |
| `image_generation`                                                   | — (already small)                                                  | `<n> image(s): <revised prompt>`                                    | —                                                |
| `deep_research`                                                      | —                                                                  | `report <id>: <title>`                                              | `recall({ call })`                               |
| `computer_use`                                                       | age 0                                                              | the summary text, no screenshot                                     | `recall({ call })` (text)                        |
| `update_memory`                                                      | — (small)                                                          | unchanged                                                           | —                                                |
| `lcm_expand` / `lcm_grep` / `lcm_describe` / `search_knowledge_base` | age 0                                                              | `<tool>: <n> items`                                                 | run it again, or `recall({ call })`              |
| `call_mcp_tool`                                                      | age 0                                                              | first 1 000 chars + `… (<n> chars)`                                 | `recall({ call })`                               |
| `list_mcp_tools`                                                     | age 0                                                              | `listed <n> tools`                                                  | run it again                                     |
| a failed call (`isError`)                                            | always full (it is short, and the model should know why it failed) | —                                                                   | —                                                |

A digest is marked so the model knows what it is reading, e.g.
`[digest of call c_123 — recall({ call: "c_123" }) for the full result]`.

**B3. `recall` (one new built-in).** `recall({ source?: number, call?: string })` — the full stored result of an earlier
call of this chat (with its arguments), or the full text of a numbered source — straight from the database: no network,
no search cost, byte-identical to what the tool returned. One tool instead of two (`read_source` + `recall_call`) keeps
the tools block small. In `TOOL_NAMES`, the prompt (one line under "Memory of conversations"), Built-in Tools.

**B4. Sources table.** `chat_source(chatId, rank, link, title, siteName, hostname, favicon, snippet, thumbnail, age,
content, runId, toolCallId, createdAt)`, unique `(chatId, rank)`, written when a `web_search` / `web_fetch` result is
persisted, back-filled by a migration from `message.details`. It serves `recall({ source })`, the clients' citation map
(§C3) and `highestSourceRank` (one indexed query instead of scanning the posted history).

**B5. Compaction reads digests too.** LCM's leaf compaction (`compaction.ts`) feeds tool results to the summariser
verbatim — paying for 50 k-token search dumps a second time. It reads the digests instead; summaries cite sources by
number, which `recall` resolves.

**B6. Unchanged:** user text and images, assistant text, the current run in full, failed calls, thinking (pi passes what
the provider accepts; Anthropic ignores thinking of earlier turns).

## C. Transport: the server owns history; the clients get pages

**C1. A send carries only what is new.** `POST /api/v1/chat` takes `{ id, message, advancedTools, reasoningEffort?,
projectId? }`; the server reads the conversation from the database. `messages` stays accepted (its last element is the
new message) for old clients. Everything that read the posted history moves to the database:

| Use today (`routes/chat.ts`)                                        | Becomes                                                                                                                |
| ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| LCM-off context, `runsForContext(history…)`                         | the same over rows read from the DB, through a row → message mapper that **keeps api / provider / model / stopReason** |
| `highestSourceRank(history)`                                        | `max(rank)` from `chat_source`                                                                                         |
| memory-consolidate job payload (the whole conversation, every turn) | `{ chatId, runId }`; the handler reads the rows — and no conversation sits in the job queue any more                   |
| `done` echoes `[...history, ...run]`                                | see C2                                                                                                                 |

Fixed on the way (found by the audit):

- **The user row's `createdAt` comes from the client's clock**, and everything orders by it; a skewed phone clock can
  sort a new question before earlier answers. The server stamps it.
- **LCM drops provider metadata.** `dbMessageToLlmMessage` omits api/provider/model/stopReason, so pi sees "a different
  model" and turns earlier thinking into plain text and drops its signatures. Keep them.
- **LCM can skip its bootstrap.** A chat started with LCM off, then switched on, gets only the new message (the new item
  is tracked before `assembleContext` checks for an empty context). Bootstrap whenever the context items do not cover
  the chat's runs.
- **The previous run may be missing from the next request.** Its rows enter the context items through the async
  `lcm-post-turn` job, which a quick follow-up does not wait for. `RunRecorder.persist()` tracks them synchronously
  (cheap inserts); only compaction stays async.

**C2. `done` v2.** A client that sends `protocol: 2` gets `done: { messages: <this run's messages>, attempts:
{ [runId]: state } }` and merges: replace the run, apply the attempt states. Without it, the server echoes the whole
history as today (read from the DB), so an old client still works.

**C3. History pages.** `GET /api/v1/chat/:id` (a bare array) stays as it is. New:

`GET /api/v1/chat/:id/page?runs=10&before=<runId>` (or `&around=<runId>`) →
`{ messages, sources, questions, hasOlder, olderCursor }`

- **Runs, not messages.** A page is whole runs, and a regenerate group is never split (the boundary moves to include the
  whole group).
- **`sources`:** the chat's whole `chat_source` table, compact (rank, link, title, siteName, hostname, favicon, snippet,
  thumbnail, age) — ~300 bytes each. Citations, the Sources sheet, Copy's references and the source favicons resolve
  through it, so a `【3-source】` found ten pages up still works.
- **`questions`:** every question of the chat, `{ runId, text (≤200 chars), createdAt }`, for the table of contents.
- **`messages`, compact.** Dropped (no client reads them; audit 2026-10-01): `searchText`, `chatId`; a successful tool
  result's `content` when its `details` is set (often `JSON.stringify(details)`); `web_search` `details[].content`;
  `web_fetch` page text; `create_artifact` `arguments.code` (the card reads `details.code`). Kept — read by a client:
  every failed result's `content` (the error text), thinking, user images, terminal stdout/stderr, read_file content
  (iOS), write/edit_file arguments (iOS), artifact `details.code`, the computer-use final screenshot (iOS), memory
  changes (undo needs the full snapshots).
- **Very large kept fields** (> 64 KB: a long terminal output, a big file, artifact code) are cut with
  `truncated: { field, bytes }`; `GET /api/v1/chat/:id/messages/:messageId` returns the full row, which the card fetches
  when expanded.

**C4. Clients.**

- Open a chat → the newest page, landing at the end (the "jump, don't glide" rule of 2026-10-01).
- Scrolling to the top loads the next older page, keeping the reading position.
- Citations, the Sources sheet and Copy read `sources`; the TOC reads `questions` (a question not loaded yet loads its
  page when picked).
- Only runs sent during the visit animate in (older pages are not "fresh").
- iOS stops pruning memory usage to the loaded runs.
- ⌘F finds only what is loaded (it searches the page); searching the whole chat is ⌘⇧F, unchanged.

**C5. Upload.** With C1 a send is a few KB instead of the whole chat — on a phone's uplink, the larger win.

**C6. Compression (shipped 2026-10-01).** `compressLan`: LAN listener only, brotli q5 / gzip, ≥ 1 KB, never an event
stream. 2.36 MB → ~360 KB brotli.

## D. Loading, over a slow link

- **Opening a chat** shows a transcript skeleton (a few question/answer shapes) until the first page arrives — both
  clients (iOS shows a blank screen today).
- **Older pages:** a small spinner at the top while one loads.
- **Shown only when slow:** an indicator appears after ~300 ms, so on the LAN nothing flashes.
- Settings pages without a loading state (iOS colour tone and others) get one; images already load through
  `LazyLoadImage` on the desktop.

## E. Order of work

Each phase ships on its own and is measured against §0.

1. **Cache (A1–A5).** Small change, the largest saving. Done when the first call of a run within 5 minutes reads ≥ 90 %
   of its prefix from cache.
2. **Server-owned history (C1, C2) and the four LCM fixes.** A send uploads KB; contexts are built from the database on
   both paths.
3. **`chat_source`, `recall`, aging, digest-fed compaction (B).** The follow-up in §0's chat drops from ~280 k tokens
   to the order of 20 k.
4. **Pages and loading (C3, C4, D)** on both clients.

## F. Not losing information — the checks

- A golden render test: fixtures drawn from the full rows and from the compact page render the same on both clients.
- `recall` returns byte-identical stored data (arguments and result); every digest names its recovery path, and a test
  holds that each tool in `TOOL_NAMES` has a policy row.
- A provider request is still valid after aging (`dropBrokenRuns` sees pairs intact: digests replace content, never
  remove a call or its result).
- Deleting a memory removes it from every run's block (A2).

## G. Owner decisions

1. Cache lifetime (A6): **declined** — each provider's default; no per-provider cache setting.
2. How long search results stay in full: through the next run (proposed), none, or two.
3. Page size: 10 runs (proposed).
4. Weather is re-queried rather than recalled (B2) — agree?
