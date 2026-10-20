# Knowledge Base via LightRAG — Design

## Context

Actovia has a stub knowledge base today: a `knowledge_doc` table (title,
content, teamId) and `searchKnowledgeDocs()` — a naive case-insensitive
substring match — surfaced only inside Philharmonic Groups via
`createSearchKnowledgeBaseTool(allowedTeamIds)`. Retrieval is scoped to the
teams of the employees in the conversation (`computeAllowedTeamIds`), plus
"General" docs (`teamId IS NULL`). The main chat has no knowledge base at all.
`src/main/lib/ai/prompts.ts` documents a `rag` tool that has never existed.

Background research on LightRAG (a self-hosted graph-augmented RAG server,
HKUDS) is in `docs/lightrag-research.md`. Summary of what matters here:

- LightRAG runs as a **separate service the user operates** (Docker image
  `ghcr.io/HKUDS/LightRAG:latest`, default port `9621`). Actovia is a pure
  client — same posture as the optional Elasticsearch integration
  (`docs/elasticsearch-setup.md`, "Actovia is consumer-only").
- Auth: `X-API-Key` header.
- Ingestion is **asynchronous**: `POST /documents/text` returns a `track_id`;
  progress is polled via `GET /documents/track_status/{track_id}`. Processing a
  document costs LLM tokens on the user's LightRAG key (entity extraction).
- LightRAG documents are **immutable after ingestion** — no update endpoint.
  Editing = `DELETE /documents/{doc_id}` then re-insert.
- `GET /documents` returns **metadata + an auto-summary only**, never the
  original text.
- Retrieval: `POST /query` with `only_need_context: true, include_references:
  true` → `{ response: "<assembled context>", references: [...] }`. Query modes
  `naive | local | global | hybrid | mix`; `mix` is the default and best.
- Multi-tenancy is **per-instance** (`WORKSPACE` env, set at server start), not
  per-request. There is no reliable per-request scope filter.

This design integrates LightRAG as Actovia's single knowledge base, used by both
the main chat and Philharmonic, retiring the substring stub.

## Decisions (from brainstorming, 2026-09-04)

1. **Unify into one LightRAG-backed KB.** Retire `searchKnowledgeDocs`. Both the
   main chat and Philharmonic Groups retrieve from the same KB via the same tool.
2. **`knowledge_doc` stays the editable source-of-truth.** Users author docs in
   Actovia; Actovia syncs them into LightRAG (the derived index) and tracks index
   status. LightRAG never holds content Actovia can't reproduce.
3. **No team scoping.** One shared KB. Every retrieval — main chat and every
   Group — sees the whole KB. `knowledge_doc.teamId` and `computeAllowedTeamIds`
   are removed.
4. **Retrieval-only.** LightRAG retrieves; Actovia's configured chat model writes
   the answer, exactly as `searchKnowledgeBase` works today.
5. **Management UI lives in Settings → Knowledge Base.** The Philharmonic
   "Knowledge Base" nav page is removed; its editor logic ports to Settings.
6. **Sync is orchestrated through pgmq** (`kb-sync` queue), not synchronously in
   the route handler.

## Goals

- A configured LightRAG URL + API key makes a `searchKnowledgeBase` tool
  available in the main chat and in Philharmonic; the model decides when to call
  it; results come from LightRAG and are answered by Actovia's model.
- Users add / edit / delete knowledge documents in Settings → Knowledge Base and
  see a per-document index status (Pending / Indexing / Indexed / Failed /
  Stale).
- Document edits and deletes propagate to LightRAG durably and retryably; a slow
  or unreachable LightRAG never blocks or fails a document save, and never
  breaks a chat turn.
- Zero behavior change when no URL is configured (feature is dark by default).

## Non-Goals

- Running, upgrading, health-monitoring, or backing up LightRAG; configuring its
  LLM / embedding / rerank models or its storage backend. All the user's job.
- No in-Actovia knowledge-graph visualization (LightRAG's `/webui` has one).
- No per-team / per-project / per-Group scoping of retrieval (decision 3). May
  be revisited if the product moves past single-user desktop.
- No automatic per-turn context injection ("always retrieve") — tool-call-driven
  only. Possible later addition, out of scope here.
- No file upload (`POST /documents/upload`) in this pass — documents are
  title + text authored in Actovia. Upload can be added later against the same
  sync machinery.
- No preservation of the existing `knowledge_doc` rows across the migration —
  a DB wipe is already required by prior in-flight work; `Reindex all` covers
  re-population.

## Architecture

### 1. Schema changes

**`knowledge_doc`** (`src/main/lib/db/schema.ts`):

- **Drop** `teamId` (and its FK to `team`). Documents become a flat global list.
- **Add:**

  | column            | type                          | note                                                                                                                                                                                     |
  | ----------------- | ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | `lightragDocId`   | `text`                        | LightRAG's `doc_id`, set once indexed; `null` until then                                                                                                                                 |
  | `lightragTrackId` | `text`                        | last submitted ingest track id, for status polling                                                                                                                                       |
  | `indexStatus`     | `knowledge_index_status` enum | `pending` \| `processing` \| `processed` \| `failed` \| `stale`; default `pending`                                                                                                       |
  | `indexError`      | `text`                        | last failure message, `null` on success                                                                                                                                                  |
  | `syncedHash`      | `text`                        | sha256 of the `# {title}\n\n{content}` last **submitted** to LightRAG; `null` until first sync. Paired with `indexStatus` — a `failed`/`stale` row re-submits even when the hash matches |

New enum `knowledgeIndexStatusEnum = pgEnum('knowledge_index_status', ['pending','processing','processed','failed','stale'])`.

`indexStatus` semantics:

- `pending` — never synced, or content changed and a sync job is queued.
- `processing` — an ingest was submitted to LightRAG; `track_id` outstanding.
- `processed` — LightRAG reports the doc indexed.
- `failed` — submit or processing failed; `indexError` explains.
- `stale` — `sha256(current) != syncedHash` but no sync job is currently
  queued/running (e.g. after a failed retry that exhausted attempts). A
  reconcile / `Reindex all` moves it back to `pending`.

**`settings`** (`src/main/lib/db/schema.ts`): add
`knowledgeBase: jsonb('knowledgeBase').$type<z.infer<typeof KnowledgeBaseSchema>>()`.
Nothing dropped.

Migration: regenerate `0000` from scratch (the established workflow in this
repo — delete the SQL + `meta/0000_snapshot.json`, reset `_journal.json`,
`pnpm db:generate`). DB wipe required (already the case).

### 2. Settings schema

`src/shared/schemas/settings-schema.ts`:

```ts
export const KnowledgeBaseSchema = z.object({
  url: optionalHttpUrl, // http://localhost:9621
  apiKey: z.string().nullish(), // → X-API-Key
  queryMode: z.enum(['naive', 'local', 'global', 'hybrid', 'mix']).nullish(), // default 'mix'
  topK: formNumber(z.number().gte(1).lte(200)).nullish(), // default 60
  chunkTopK: formNumber(z.number().gte(1).lte(100)).nullish() // default 10
})
```

`SettingsSchema` gains `knowledgeBase: KnowledgeBaseSchema.nullish()`.
`src/main/lib/db/schema.ts` imports `KnowledgeBaseSchema`.

`apiKey` is a secret — persisted through the same `safeStorage` path as other
settings secrets (no special handling beyond what settings already do for
`s3.secretAccessKey`, `providers.*`, etc.).

### 3. Settings menu rename

`src/renderer/components/settings/settings-menu.ts`:
`SettingsLabel.GraphRag = 'GraphRAG'` → `KnowledgeBase = 'Knowledge Base'`.
Menu item stays in the **Integrations** group, keep `NetworkIcon` (or switch to
`BookOpenIcon` / `LibraryBigIcon` — cosmetic, pick during implementation).
`settings-form.tsx`: `GraphRAG` import/dispatch → `KnowledgeBase`.
Delete `settings-form/graph-rag.tsx`.

### 4. LightRAG client

`src/main/lib/knowledge-base/lightrag-client.ts` — a thin `fetch` wrapper. All
endpoint path strings live here and nowhere else. Tolerant of unknown response
fields (LightRAG's API moves ~monthly).

```ts
export interface LightRagHealth {
  status: string
  llmModel?: string
  embeddingModel?: string
  embeddingDim?: number
  documentCount?: number
}
export interface RetrievedContext {
  context: string // assembled context text
  references: { id: string; source: string }[] // source = file_path
}

export class LightRagClient {
  constructor(
    private baseUrl: string,
    private apiKey?: string
  ) {}

  health(): Promise<LightRagHealth> // GET /health
  insertText(text: string, fileSource: string): Promise<{ trackId: string }> // POST /documents/text
  deleteDoc(lightragDocId: string): Promise<void> // DELETE /documents/{id}
  trackStatus(trackId: string): Promise<{
    status: 'pending' | 'processing' | 'processed' | 'failed'
    docId?: string
    error?: string
  }> // GET /documents/track_status/{id}
  retrieve(
    query: string,
    opts: {
      mode: string
      topK: number
      chunkTopK: number
    }
  ): Promise<RetrievedContext> // POST /query (only_need_context:true)
}
```

`retrieve` request body:
`{ query, mode, top_k, chunk_top_k, only_need_context: true, include_references: true, max_total_tokens: 8000 }`.
Response `{ response, references }` → `{ context: response, references: references.map(r => ({ id: r.reference_id, source: r.file_path })) }`.

All methods throw `LightRagError` (wrapping status + body) on non-2xx or network
failure. Callers decide how to degrade.

### 5. Provider resolver

`src/main/lib/knowledge-base/resolve-knowledge-base.ts`:

```ts
export function resolveKnowledgeBase(settings: Settings): LightRagClient | null
```

Mirrors `resolveSearchProvider()` exactly:

- Returns `null` when `settings.knowledgeBase?.url` is empty/absent.
- Caches one `LightRagClient` keyed by `url + apiKey`; rebuilds on config change.
- **Never throws** — a malformed URL is logged (`logger` scope
  `'knowledge-base'`) and treated as "not configured". It is called from the
  hot chat path (`bindCallingTools`, Philharmonic loops); a throw there would
  take down tool binding.

### 6. `kb-sync` job queue

`src/main/lib/jobs/types.ts`: add `'kb-sync'` to `QueueName` and `QUEUE_NAMES`.

Payloads (`src/main/lib/jobs/types.ts`):

```ts
export type KbSyncPayload =
  | { op: 'upsert'; docId: string }
  | { op: 'delete'; lightragDocId: string }
```

`src/main/lib/jobs/handlers.ts` — `'kb-sync'` handler. First step for both ops:
`const kb = resolveKnowledgeBase(await getSettings()); if (!kb) return;` — a
job queued before the URL was cleared no-ops, exactly like `index-message` when
Elasticsearch is unconfigured.

- **`upsert`**: load `knowledge_doc` by `docId` (gone → return).
  1. `text = "# " + title + "\n\n" + content`; `hash = sha256(text)`.
  2. If `hash === syncedHash` and `indexStatus === 'processed'` → no-op, return.
  3. If `lightragDocId` is set → `kb.deleteDoc(lightragDocId)` (ignore 404).
  4. `{ trackId } = kb.insertText(text, docId)`.
  5. `setIndexStatus(docId, { lightragTrackId: trackId, syncedHash: hash,
     indexStatus: 'processing', indexError: null, lightragDocId: null })`.
  6. Return. Status settlement is the reconciler's job (below) — the handler
     does not poll inline, so it stays fast and a process restart mid-wait
     loses nothing.
- **`delete`**: `kb.deleteDoc(lightragDocId)` (ignore 404). No row to update —
  the `knowledge_doc` row is already gone (see §7). An orphaned LightRAG doc is
  harmless; on error, **log and swallow** (do not throw — nothing to retry
  toward, and `Reindex all` never recreates it).
- **`upsert` error handling:** on any error from step 3–4, `setIndexStatus(docId,
  { indexStatus: 'failed', indexError: String(err) })` **and re-throw**. The
  status write commits before the throw (separate statement), so the UI shows
  "Failed" immediately; the throw lets pgmq redeliver (visibility timeout 300s,
  `MAX_READ_COUNT` 5 ≈ 25 min of retries) so a transient LightRAG outage
  self-heals — a later successful attempt overwrites `failed` → `processed`.
  After give-up the row stays `failed` for the user to `Reindex all`.

**Periodic reconcile.** New `reconcileKnowledgeIndexStatus()` in
`src/main/lib/knowledge-base/`. Wired into the existing jobs cron
(`initJobQueue()` in `worker.ts`) on a slower cadence (e.g. every 30s). It:

- selects `knowledge_doc WHERE indexStatus = 'processing' AND lightragTrackId
  IS NOT NULL`;
- for each, `kb.trackStatus(trackId)` → `processed` (also stores the returned
  `lightragDocId`) / `failed` (+ `indexError`);
- if a row has been `processing` longer than ~10 min with no terminal status,
  sets `stale` (something is wrong on the LightRAG side; user can `Reindex
  all`).
  This is the only status-settlement path — it covers the normal case (badge
  flips within one cron interval), the bounded-wait-would-have-timed-out case,
  and the process-restart-mid-ingest case with one mechanism.

### 7. Routes

New router `src/main/lib/server/routes/knowledge-base.ts`, mounted at
`/api/knowledge-base` in `src/main/lib/server/app.ts`.

| Method + path                 | Behavior                                                                                                                                                                                                       |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /test-connection`       | `resolveKnowledgeBase(settings)` → `client.health()`. 400 if not configured. Returns the `LightRagHealth` payload so the UI can show the embedding model/dim.                                                  |
| `GET /documents`              | `getAllKnowledgeDocs()` — full rows (id, title, content, updatedAt, indexStatus, indexError). The dataset is small (hand-authored docs); returning `content` lets the edit dialog open without a second fetch. |
| `POST /documents`             | validate `{ title, content }`; `createKnowledgeDoc` (indexStatus `pending`); enqueue `kb-sync {op:'upsert', docId}`; 201 with the row.                                                                         |
| `PUT /documents/:id`          | validate `{ title?, content? }`; `updateKnowledgeDoc`; if title or content changed, set `indexStatus: 'pending'` and enqueue `kb-sync {op:'upsert'}`.                                                          |
| `DELETE /documents/:id`       | read the row; `deleteKnowledgeDoc(id)`; if it had a `lightragDocId`, enqueue `kb-sync {op:'delete', lightragDocId}`. 200.                                                                                      |
| `POST /documents/reindex-all` | for every `knowledge_doc`: set `indexStatus: 'pending'`, enqueue `kb-sync {op:'upsert'}`. Returns `{ count }`.                                                                                                 |

The `/knowledge` routes in `philharmonic-conversations.ts` are **removed**.
Retrieval is never exposed as a route — it happens in-process inside the agent
loop.

### 8. Retrieval tool

`src/main/lib/ai/philharmonic/kb-tools.ts` → move to
`src/main/lib/ai/calling-tools/search-knowledge-base.ts` (it's now a general
tool, not Philharmonic-specific) and export from `calling-tools/index.ts`.

```ts
export function searchKnowledgeBase(
  client: LightRagClient,
  cfg: z.infer<typeof KnowledgeBaseSchema> | null | undefined
): AgentTool
```

- name `searchKnowledgeBase`, one param `query: string`.
- description: "Search the user's knowledge base for relevant documents. Use
  before answering questions that may be covered by the user's own notes,
  documents, or company facts."
- execute: `client.retrieve(query, { mode: cfg?.queryMode ?? 'mix', topK:
  cfg?.topK ?? 60, chunkTopK: cfg?.chunkTopK ?? 10 })`.
  - success → `content: [{ type: 'text', text: context }]`, `details: { query,
    references }`.
  - empty context → `"No knowledge base documents matched \"<query>\"."`.
  - `LightRagError` → `"The knowledge base is currently unavailable."` (logged
    at `warn`, `knowledge-base` scope). Never throws out of `execute`.

### 9. Tool binding

**`bindCallingTools`** (`src/main/lib/ai/utils/tool-binding-util.ts`) — the
single binding point:

```ts
const kb = resolveKnowledgeBase(setting)
if (kb && enabled('searchKnowledgeBase')) {
  tools.push(searchKnowledgeBase(kb, setting.knowledgeBase))
}
```

`bindCallingTools` is called by **both** the main chat (`chat.ts`) **and**
Philharmonic delegated-employee tasks (`employee-loop.ts:72`, which already does
`getSettings()` + `bindCallingTools`). So this one change covers the main chat
and every employee loop automatically.

**`pm-coordinator.ts`** builds its own tool array (PM-only tools: delegate,
recruit, report, escalate) and has `setting` in scope (~line 129). Replace
`createSearchKnowledgeBaseTool(allowedTeamIds)` (~line 338) with a conditional
spread:

```ts
const kb = resolveKnowledgeBase(setting)   // near line 152, replacing the allowedTeamIds line
...
...(kb ? [searchKnowledgeBase(kb, setting.knowledgeBase)] : []),
```

**`execution-engine.ts`** — just **delete** the
`extraTools: [createSearchKnowledgeBaseTool(allowedTeamIds)]` and the
`computeAllowedTeamIds` import/call (lines 13, 15, 62, 70). No replacement — the
employee loop's own `bindCallingTools` now provides `searchKnowledgeBase`.

**`src/shared/constants/tools.ts`** — add to `TOOL_REGISTRY`:

```ts
{ key: 'searchKnowledgeBase', label: 'Knowledge Base',
  description: 'Retrieve context from your knowledge base (requires a configured LightRAG URL)',
  group: 'AI & Data' }
```

So it appears with a switch in Built-in Tools. The switch only gates binding;
an enabled switch with no URL configured still binds nothing.

**`src/main/lib/ai/prompts.ts`** — the stale `- **rag**:` bullet (~line 96)
becomes `- **searchKnowledgeBase**: retrieve relevant context from the user's
knowledge base before answering questions it might cover.`

### 10. Settings UI

`src/renderer/components/settings/settings-form/knowledge-base.tsx` (replaces
`graph-rag.tsx`). `src/renderer/services/knowledge-base.ts` for the API calls
(replaces the KB functions in `services/philharmonic-chat.ts`).

Layout — two `SettingsSection`s:

**Connection**

- `SettingsRow` (vertical): URL — `Input`, placeholder `http://localhost:9621`,
  description "Your self-hosted LightRAG server. Leave empty to disable the
  knowledge base."
- API Key — `Input type="password"`.
- Query Mode — `Select` (`naive`/`local`/`global`/`hybrid`/`mix`), default
  `mix`, description one line on what mix does.
- Advanced (`Collapsible`, collapsed): Top K, Chunk Top K — numeric `Input`s.
- Connection row: "Test Connection" `Button` (`data-testid`
  `TEST_IDS.knowledgeBase.testConnectionButton`). On success `sileo.success`
  showing `LLM: <model> · Embedding: <model> (<dim>d) · <n> docs`, plus a
  persistent muted caption: "Changing the embedding model in LightRAG requires
  re-ingesting every document."

**Documents**

- Header row: title + "Add document" `Button` + "Reindex all" `Button`
  (`data-testid`s `knowledgeBase.addButton`, `knowledgeBase.reindexButton`).
- List: each row = title · relative updatedAt · status `Badge`
  (`pending`→"Pending" secondary, `processing`→"Indexing…" secondary,
  `processed`→"Indexed" default, `failed`→"Failed" destructive +
  `indexError` in a tooltip, `stale`→"Needs reindex" outline). Row click opens
  the edit dialog. Trailing `Trash2` icon → `AlertDialog` confirm → delete.
- Empty state: `PhilharmonicEmptyState`-equivalent / `Empty` primitive with
  "No documents yet."
- Add/Edit dialog (`Dialog`): title `Input`, content `Textarea` (min ~8 rows),
  Cancel / Save. Save disabled until title and content non-empty. This is the
  existing `knowledge-base-page.tsx` dialog minus the team `Select`.

State handling:

- No URL configured → render only the Connection section, plus a muted note
  that documents appear once a server is set.
- URL set but `test-connection` failed / never run → Documents section still
  fully usable; a muted inline note "Server unreachable — edits will sync when
  it's back."
- Poll `GET /documents` on an interval (e.g. 5s) while any row is
  `pending`/`processing`, to animate the status badges; stop when all settled.

`data-testid`s added to `src/shared/constants/test-ids.ts` under a new
`knowledgeBase` group.

### 11. Philharmonic cleanup

- Delete `src/main/lib/ai/philharmonic/team-scope.ts` (only consumer was KB
  scoping) and its imports in `pm-coordinator.ts` / `execution-engine.ts`.
- Delete `src/main/lib/ai/philharmonic/kb-tools.ts` (moved to `calling-tools/`).
- Delete `src/renderer/components/philharmonic/knowledge/knowledge-base-page.tsx`.
- `src/renderer/components/philharmonic/chat/conversation-list.tsx`: remove the
  `{ page: 'knowledge', ... }` entry from `CONFIG_NAV`; drop `'knowledge'` from
  `ConfigPage`.
- `src/renderer/layouts/philharmonic-layout/index.tsx`: drop `'knowledge'` from
  `PhilharmonicPage`.
- `src/renderer/containers/philharmonic.tsx`: remove the `KnowledgeBasePage`
  import and the `activePage === 'knowledge'` branch.
- `src/renderer/services/philharmonic-chat.ts`: remove `getKnowledgeDocs`,
  `createKnowledgeDoc`, `updateKnowledgeDoc`, `deleteKnowledgeDoc`.
- `src/main/lib/server/routes/philharmonic-conversations.ts`: remove the four
  `/knowledge*` routes and the now-unused imports from `knowledge-queries`.
- `src/main/lib/db/knowledge-queries.ts`: delete `searchKnowledgeDocs`. Keep
  `getAllKnowledgeDocs`, `createKnowledgeDoc`, `updateKnowledgeDoc`,
  `deleteKnowledgeDoc`; add `getKnowledgeDocById(id)`,
  `setIndexStatus(id, Partial<{indexStatus, indexError, lightragDocId,
  lightragTrackId, syncedHash}>)`, and `getProcessingDocs()` (for the
  reconciler).
- `KnowledgeDocData` type: move from `src/renderer/stores/philharmonic` to
  `src/shared/types/` (shared between the new service and any store), renamed
  fields to match the new columns.

### 12. Documentation

- New `docs/lightrag-setup.md` — end-user guide: minimal `docker-compose.yml`,
  the `.env` keys that matter (`LIGHTRAG_API_KEY`, `LLM_BINDING*`,
  `EMBEDDING_BINDING*` + **the embedding-dimension lock warning**), pin the
  image tag, then "In Actovia, open Settings → Knowledge Base and enter
  `http://localhost:9621` + your API key."
- `CLAUDE.md`: rewrite the "Knowledge Base (RAG stub)" note; add
  `src/main/lib/knowledge-base/` to the `src/main/lib/` map; add `kb-sync` to
  the jobs list; note the `searchKnowledgeBase` tool.
- `docs/lightrag-research.md`: add a one-line pointer to this spec at the top.

## Error handling summary

| Failure                             | Behavior                                                                                                                                                                                    |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| No URL configured                   | Tool not bound. Settings shows connection form only. Zero behavior change.                                                                                                                  |
| URL malformed                       | `resolveKnowledgeBase` logs + returns `null`. Same as "not configured".                                                                                                                     |
| LightRAG down during chat           | `searchKnowledgeBase` execute catches, returns "knowledge base is currently unavailable", turn continues.                                                                                   |
| LightRAG down during doc save       | Save succeeds (row written, `pending`). `kb-sync` handler throws → row `failed` (badge visible), pgmq retries ~25 min → self-heals to `processed` if LightRAG returns, else stays `failed`. |
| `insertText` fails in job           | `indexStatus: 'failed'`, `indexError` set. Red "Failed" badge + tooltip. Auto-retried; `Reindex all` or re-save forces a retry after give-up.                                               |
| `deleteDoc` 404                     | Ignored — desired end state reached.                                                                                                                                                        |
| Process restart mid-ingest          | Row left `processing`; `reconcileKnowledgeIndexStatus` on the jobs cron settles it via `track_status`, or marks it `stale` after ~10 min.                                                   |
| Embedding model changed in LightRAG | Not detectable by Actovia. Mitigated by the persistent Settings warning + `test-connection` showing the current model/dim.                                                                  |

## Testing

**Unit** (`tests/unit/main/lib/`):

- `knowledge-base/lightrag-client.test.ts` — mocked `fetch`: `insertText` posts
  the right body and maps `track_id`; `retrieve` sends `only_need_context:true`
  and maps `{response,references}`; non-2xx → `LightRagError`.
- `knowledge-base/resolve-knowledge-base.test.ts` — `null` on empty/malformed
  url; caches by `url+apiKey`; new instance on config change; never throws.
- `jobs/handlers.test.ts` — `kb-sync` `upsert`: no-ops when `kb` unresolved;
  no-op when hash matches + `processed`; delete-then-insert when `lightragDocId`
  set and hash changed; sets `processing` + `lightragTrackId` + `syncedHash`;
  on `insertText` throw → `failed` + `indexError` written **and** re-throws.
  `delete`: calls `deleteDoc`, swallows 404 and errors (no throw).
- `knowledge-base/reconcile.test.ts` — `processing` row with terminal
  `trackStatus` → `processed` (+ `lightragDocId`) / `failed`; row `processing`
  > 10 min with non-terminal status → `stale`; rows not `processing` untouched.
- `ai/calling-tools/search-knowledge-base.test.ts` — formats context + refs;
  "unavailable" on `LightRagError`; "no match" on empty context.
- `jobs/worker.test.ts` / `queries.integration.test.ts` — handler mock map
  gains `'kb-sync'`.

**API** (`tests/api/`):

- `knowledge-base.spec.ts` — CRUD against `/api/knowledge-base/documents`
  (create → row is `pending`; update flips to `pending`; delete removes row).
  `test-connection` and any real-LightRAG assertions guarded by
  `test.skip(!process.env.LIGHTRAG_URL, ...)`, mirroring the ES specs.

**E2E** (`tests/e2e/`):

- `settings-knowledge-base.spec.ts` — open Settings → Knowledge Base, the
  connection form renders, "Add document" opens the dialog, saving adds a row
  with a Pending badge. (No LightRAG needed — the row is `pending` regardless.)

**Existing tests to update:** anything referencing the Philharmonic `/knowledge`
routes, `searchKnowledgeDocs`, `computeAllowedTeamIds`, or the
`ConfigPage`/`PhilharmonicPage` `'knowledge'` value. `tests/e2e/sidebar.spec.ts`
Philharmonic nav assertions if they name "Knowledge Base".

## Rollout

Feature is dark by default (no URL → nothing binds). No runtime migration of
existing `knowledge_doc` rows — the DB wipe already required by in-flight work
resets the table; users re-add documents (or, if any survive, hit "Reindex
all"). Ship in one PR; the spec's sections are the natural commit boundaries.

## Open items deferred

- File upload (`POST /documents/upload`) for PDFs / large files.
- Automatic per-turn context injection (an `autoInject` setting, à la
  `memory.useInChat`).
- Structured retrieval via `POST /query/data` (entities + relations + chunks)
  instead of the assembled-context string, if the model would benefit.
- Passing recent conversation turns as `conversation_history` to `/query` for
  better keyword extraction.
- Re-introducing scoping (per-project or per-Group) if/when the product needs
  it — would require the workspace-per-scope approach from the research doc.
