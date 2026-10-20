# Job Queue Decoupling (pgmq) — Design

## Context

`src/main/lib/server/routes/chat.ts`'s `POST /` handler does four separate
things after a chat turn completes, none of them on the critical path for
the user seeing their response: index the new messages into Elasticsearch
(when configured), track the new messages in LCM and compact if needed,
run the memory-write judge, and save a session summary. All four are
implemented as ad hoc fire-and-forget blocks — `Promise.resolve().then(...)`
or a bare async call — each wrapped in its own `.catch(err =>
logger.error(...))`. None of this is durable: if the process crashes or
restarts between the chat response being sent and one of these blocks
finishing, that work is silently lost forever, with no record it was ever
supposed to happen and no retry.

While researching this, the user found that PGlite (Actovia's embedded
Postgres) ships **pgmq** as a supported extension
(`@electric-sql/pglite-pgmq`) — a real SQL-native message queue ("like AWS
SQS and RSMQ but on Postgres"), requiring no background worker, pure SQL
functions and tables. It provides visibility-timeout-based reads (an
unprocessed message automatically becomes available again after a timeout,
rather than needing a hand-rolled claim/compare-and-swap column) and a
built-in `read_ct` per message for retry-attempt counting. This spec adopts
pgmq as the durability layer instead of a custom `job` table.

## Goals

- Move the four post-turn side effects off the "fire and forget inside the
  request" pattern onto a durable, retryable queue.
- Survive a process restart mid-flight — a queued job not yet processed
  resumes on next startup instead of vanishing.
- Isolate failures per job: one handler throwing must never affect another
  job type, another job in the same queue, or a future chat turn.
- Preserve the exact existing behavior of each of the four jobs — this is
  a relocation of _when/how_ they run, not a rewrite of _what_ they do.

## Non-Goals

- No new settings tab, no job-monitoring UI. This is invisible
  infrastructure, exactly as invisible as today's fire-and-forget blocks.
- No changes to Philharmonic's existing scheduler/task system
  (`src/main/lib/ai/philharmonic/scheduler.ts`) — a separate subsystem,
  no shared code. (Its claim-pattern was the original inspiration for this
  design before pgmq was found; pgmq now supersedes needing that pattern
  here.)
- No changes to the internal logic of LCM compaction, the memory-write
  judge, session summaries, or Elasticsearch indexing — only where/how
  they're invoked.
- No batching/prioritization/rate-limiting between queues — four simple,
  independent FIFO queues, polled on a fixed interval.

## Architecture

### 1. Extension registration

Follows the exact pattern already used for `pgvector` in this codebase:

- `src/main/lib/db/db.ts` — import `pgmq` from `@electric-sql/pglite-pgmq`
  and add it to the existing `extensions: { vector }` object → `{ vector,
  pgmq }`.
- `src/main/lib/db/migrate.ts` — add
  `await pglite.exec('CREATE EXTENSION IF NOT EXISTS pgmq;')` immediately
  after the existing `vector` extension line, before `migrate(db, {...})`
  runs.
- New dependency: `pnpm add @electric-sql/pglite-pgmq`.

### 2. Four named queues, not a shared job table

`lcm-post-turn`, `memory-write-judge`, `session-summary`, `index-message`.

Created once via `pgmq.create(queue_name)` calls, run at the same point in
`migrate.ts` as the extension registration (exact idempotency behavior of
calling `create` on an already-existing queue needs confirming against the
package during implementation — wrap in error-tolerant handling if it
isn't itself a no-op on repeat calls).

Separate queues (rather than one queue with a `type` field in the payload)
because each job type has a different failure/latency profile — the two
LLM-backed jobs (memory-write judge, session summary) behave differently
under load than the two DB-only jobs (LCM tracking, search indexing) — and
because each consumer then just knows what it is, no payload-level dispatch
required.

### 3. Payloads are plain JSON — no live object references

This is the architectural constraint the current code violates and must
stop violating: today's post-chat block reuses the _same in-process_
`LcmManager` instance created before the chat turn started. A queued job
may run in a later tick, or after a restart, so its handler must be able to
reconstruct everything it needs from serializable data alone.

- `index-message`: `{ id, chatId, role, content, createdAt }` — everything
  `elasticsearch.indexMessage()` needs. Settings are re-fetched fresh
  inside the handler via `resolveSearchProvider(settings)`, not carried in
  the payload, since Elasticsearch configuration can change between
  enqueue and process time.
- `lcm-post-turn`: `{ chatId, chatModel, apiKey, memoryConfig, newMessages:
  [{ id, content }] }`. Handler constructs `new LcmManager(chatId,
  chatModel, apiKey, memoryConfig)` fresh, then runs the same
  `trackNewMessages(...)` → `compactAfterTurn()` sequence used today, in
  the same order.
- `memory-write-judge`: `{ messages: [{ role, content }], chatModel,
  apiKey }`.
- `session-summary`: `{ chatId, messages: [{ role, content }], chatModel,
  apiKey }`.

(`apiKey` traveling in the payload is not a new exposure — it already
flows in-memory through this exact call chain today; PGlite is local-only,
same trust boundary as before.)

### 4. Handlers — same logic, new entry point

New `src/main/lib/jobs/handlers.ts`: one function per queue, each a thin
wrapper around the existing, otherwise-unmodified function:

```ts
type QueueName =
  | 'index-message'
  | 'lcm-post-turn'
  | 'memory-write-judge'
  | 'session-summary'

export const handlers: Record<QueueName, (payload: unknown) => Promise<void>> =
  {
    'index-message': async (payload) => {
      /* resolveSearchProvider(settings) + elasticsearch.indexMessage(...) */
    },
    'lcm-post-turn': async (payload) => {
      /* new LcmManager(...).trackNewMessages(...) then .compactAfterTurn() */
    },
    'memory-write-judge': async (payload) => {
      /* runMemoryWriteJudge(...) */
    },
    'session-summary': async (payload) => {
      /* saveSessionSummary(...) */
    }
  }
```

### 5. Worker loop

New `src/main/lib/jobs/worker.ts`:

- `processQueue(queueName)`: reads a batch via pgmq's `read(queueName, vt,
  qty)` (visibility timeout ~30s, batch size ~5). For each message, runs
  `handlers[queueName](msg.message)`. On success, `archive`s the message
  (not `delete` — archiving keeps a durable record in pgmq's own archive
  table, useful for debugging what the LLM-backed jobs actually did). On
  failure: log the error and leave the message alone — the visibility
  timeout naturally makes it available for retry on the next tick. Check
  `msg.read_ct`; if it exceeds a small cap (e.g. 5), archive it anyway with
  a "giving up" log, so a permanently-broken payload doesn't retry forever.
- `initJobQueue()`: a `node-cron` tick every 15 seconds calls
  `processQueue` for each of the four queues, with errors isolated per
  queue — one queue failing to process never blocks or delays the other
  three, matching the error-isolation already established in
  `runDueOneOffTasks`.
- Wired into `src/main/lib/server/app.ts`, called alongside the existing
  `initScheduler(emitToAll)` call.

### 6. `chat.ts` changes

The four inline blocks — the `indexMessagesInBackground` calls at both
`saveMessages` call sites, and the `Promise.resolve().then(...)` post-chat
block containing LCM tracking/compaction, the memory-write judge, and the
session summary — are replaced with `pgmq.send(queueName, payload)` calls.
Each is a fast, synchronous DB write (not a network call, not an LLM call),
so it cannot meaningfully slow down the chat response.

## Error Handling

- **Per-job isolation**: a thrown error inside one handler is caught
  within `processQueue`'s loop; it's logged and does not stop the rest of
  the batch or affect other queues.
- **Retry**: automatic via pgmq's visibility timeout — no custom backoff
  logic needed. Capped by `read_ct` to prevent an unfixably-broken payload
  from retrying forever.
- **Nothing silently disappears**: archiving (never deleting) on both
  success and give-up means pgmq's archive tables become an inspectable
  record of everything the app has tried to do in the background — a
  concrete debugging improvement over today's log-line-only visibility.

## Testing

- Unit tests for each handler in `handlers.ts` — mock the wrapped function
  (e.g. `saveSessionSummary`) and assert the handler calls it with the
  right arguments derived from a given payload shape.
- Unit test for `processQueue`'s retry/give-up logic — mock the pgmq
  read/archive calls at whatever boundary they're invoked through (likely
  `db.execute(sql\`...\`)`via Drizzle, following this codebase's existing
  raw-SQL-via-Drizzle convention — confirm the exact call shape during
  implementation) and assert: a handler throwing leaves the message
  un-archived (available for retry), and a message whose`read_ct` exceeds
  the cap gets archived with a "giving up" log regardless of handler
  outcome.
- Integration test: enqueue via `pgmq.send`, run `processQueue` once
  against a real (test) PGlite instance with the extension registered, and
  assert the handler's real effect happened and the message was archived.
  This needs a real embedded PGlite in the test, not the `vi.mock('@main/lib/db/db', ...)`
  pattern used elsewhere in this repo's unit tests — check for existing
  precedent of tests instantiating a real PGlite instance (e.g. anything
  under `context-management`'s tests, which already exercise real
  PGlite/pgvector queries) and follow that setup.

## Migration from Current Behavior

No user-facing change, no settings, no UI change. Pure internal plumbing.
The only externally observable difference: a process killed or restarted
mid-chat-turn no longer silently drops the memory-write judge, session
summary, LCM compaction, or search indexing for that turn — it resumes
within 15 seconds of the next process start, instead of never.

## Open Items Deferred

- `pg_textsearch` (BM25 ranking) and `fuzzystrmatch` (fuzzy matching) —
  found during the same research pass that surfaced pgmq, but unrelated to
  this decoupling work. Noted as potential future enhancements to the
  PGlite "lite" search tier from
  [[pluggable-search-provider]] — out of scope here.
