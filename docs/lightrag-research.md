# GraphRAG via LightRAG — Integration Research

_Date: 2026-09-04 · Status: superseded by the design spec + plan below_

> Design spec: [`docs/superpowers/specs/2026-09-04-knowledge-base-lightrag-design.md`](superpowers/specs/2026-09-04-knowledge-base-lightrag-design.md)
> Implementation plan: [`docs/superpowers/plans/2026-09-04-knowledge-base-lightrag.md`](superpowers/plans/2026-09-04-knowledge-base-lightrag.md)

## 0. TL;DR

- **LightRAG stays a separate service the user runs themselves** (Docker, port
  `9621`). Actovia is a **pure client**: it holds a base URL + API key, pushes
  documents, and asks for retrieved context. It never runs LightRAG, never owns
  its storage, never creates its schema — exactly the posture we already took
  with Elasticsearch (`docs/elasticsearch-setup.md`, "Actovia is consumer-only").
- **Recommended retrieval mode:** call `POST /query/data` (or `/query` with
  `only_need_context=true`) so **LightRAG does retrieval only** and _Actovia's_
  configured chat model writes the final answer. This keeps answer quality,
  streaming, cost accounting, and personality consistent with the rest of
  Actovia, and means the user does not have to configure LightRAG's own LLM well.
- **When the AI hits the KB:** tool-call driven. Bind a `searchKnowledgeBase`
  tool (we already have one for Philharmonic — `kb-tools.ts`) whenever a KB is
  configured; the model decides when to call it. Optionally add an
  "always-inject top-K" mode later.
- **Biggest open question:** LightRAG's multi-tenancy is per-_instance_
  (`WORKSPACE` = separate working dir / `.env`), not per-_request_. Our
  Philharmonic "General vs per-Team docs" scoping does not map cleanly onto one
  LightRAG instance. See §7.

---

## 1. What LightRAG is (and isn't)

[LightRAG](https://github.com/HKUDS/LightRAG) (HKUDS) is a graph-augmented RAG
engine. On ingestion it uses an LLM to extract **entities + relationships** into
a knowledge graph _and_ chunk-embeds the text into a vector store. On query it
blends **graph traversal** (entities/relations) with **vector similarity**
(chunks) — that blend is the `mix` mode and is the whole point vs. plain vector
RAG. It is the lighter-weight cousin of Microsoft GraphRAG.

It ships as:

| Form                                             | What it is                                                                                              | Relevant to us?                           |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| Python library (`from lightrag import LightRAG`) | embed in a Python process                                                                               | No — we're Electron/TS                    |
| **LightRAG Server**                              | FastAPI app: REST API + Swagger at `/docs` + a built-in Web UI at `/webui` + Ollama-compatible chat API | **Yes — this is our integration surface** |
| Docker image `ghcr.io/HKUDS/LightRAG:latest`     | the server, containerised                                                                               | Yes — what we tell users to run           |

**It is not** something we bundle or spawn. It needs its own LLM key + embedding
model + (optionally) a database. That's the user's infrastructure.

---

## 2. How LightRAG is used

### 2.1 Deployment (the user's job)

Minimal `docker-compose.yml`:

```yaml
services:
  lightrag:
    image: ghcr.io/HKUDS/LightRAG:latest
    ports: ['9621:9621']
    volumes:
      - ./data/rag_storage:/app/data/rag_storage # graph + vectors + KV
      - ./data/inputs:/app/data/inputs # uploaded source files
    env_file: .env
```

Key `.env` settings:

```bash
PORT=9621
LIGHTRAG_API_KEY=some-long-secret          # -> Actovia sends as X-API-Key
SUMMARY_LANGUAGE=Chinese                   # entity/relation summaries

# LLM used for entity extraction + (if we let it) answer generation
LLM_BINDING=openai                         # openai | ollama | azure | lollms
LLM_MODEL=gpt-4o-mini
LLM_BINDING_HOST=https://api.openai.com/v1
LLM_BINDING_API_KEY=sk-...

# Embedding model — LOCKED once you ingest anything (dimension can't change)
EMBEDDING_BINDING=openai                   # openai | ollama | lollms | vllm
EMBEDDING_MODEL=text-embedding-3-large
EMBEDDING_DIM=3072
```

**Storage backends** (env-selected; file-based is the default and fine for
personal use):

| Backend                          | When                                                   |
| -------------------------------- | ------------------------------------------------------ |
| File-based (default)             | single user, < ~100k chunks; zero extra infra          |
| PostgreSQL + pgvector + AGE      | shared / larger; one image `gzdaniel/postgres-for-rag` |
| Neo4j / Milvus / MongoDB / Redis | swappable per-store for scale                          |

### 2.2 Ingestion pipeline

Ingestion is **asynchronous**. You submit content, get a `track_id`, and poll:

```
POST /documents/text        {"text": "...", "file_source": "handbook.md"}   -> {track_id}
POST /documents/texts       {"texts": [...]}                                 -> {track_id}
POST /documents/upload      multipart file                                   -> {track_id}
GET  /documents/track_status/{track_id}   -> {status: pending|processing|processed|failed, ...}
GET  /documents/pipeline_status           -> global pipeline / recovery state
DELETE /documents/{doc_id}
POST /documents/clear                     -> wipe the workspace
```

Processing a document = LLM entity extraction + graph merge + embedding. It is
**slow and costs LLM tokens** (on the user's LightRAG LLM key), seconds to
minutes per document. The UI must treat "added" and "indexed" as distinct
states.

### 2.3 Query API

```
POST /query          -> synchronous; {response, references[], response_time, llm_generated}
POST /query/stream    -> NDJSON stream: {"references":[...]}\n {"response":"chunk"}\n ...
POST /query/data      -> retrieval only, NO LLM generation   <-- our primary call
GET  /health          -> liveness + (authed) config/queue diagnostics
```

`QueryRequest` fields we care about:

| Field                  | Default | Note                                                            |
| ---------------------- | ------- | --------------------------------------------------------------- |
| `query`                | —       | required                                                        |
| `mode`                 | `mix`   | `local` \| `global` \| `hybrid` \| `naive` \| `mix` \| `bypass` |
| `only_need_context`    | `false` | **true = skip generation, return context**                      |
| `top_k`                | 60      | KG entities (local) / relations (global)                        |
| `chunk_top_k`          | 20      | text chunks kept after rerank                                   |
| `max_total_tokens`     | 30000   | total context budget                                            |
| `conversation_history` | —       | sent to LLM for context, **not** used for retrieval             |
| `user_prompt`          | —       | extra answer-format instructions                                |
| `enable_rerank`        | true    | needs a rerank model configured or it warns                     |
| `include_references`   | true    | source citations                                                |

**Query modes:**

| Mode     | Retrieval                        | Use for                                    |
| -------- | -------------------------------- | ------------------------------------------ |
| `naive`  | vector chunks only               | fast, plain RAG; no graph benefit          |
| `local`  | entity-centric subgraph + chunks | "what does X do", specific facts           |
| `global` | relation-centric + chunks        | themes, cross-document reasoning           |
| `hybrid` | local + global                   | both                                       |
| `mix`    | hybrid + vector                  | **default; best quality, slightly slower** |
| `bypass` | nothing                          | passthrough to LLM                         |

### 2.4 Other surfaces (nice to know, not required)

- **Web UI** at `/webui` — the user can manage documents and inspect the graph
  without any Actovia UI. Lowers how much we must build.
- **Ollama-compatible** `POST /api/chat` with model `lightrag:latest` and inline
  mode prefixes (`"/hybrid What is X?"`, `"/mix[bullet points] ..."`). Lets
  LightRAG appear as a "model" in an Ollama client. We _could_ surface it as a
  pseudo-provider, but that fights our "Actovia generates the answer" stance.
- **Auth:** `X-API-Key: <key>` header, or JWT via `POST /login`. API key is all
  we need; store it with `safeStorage` like other secrets.
- **`WORKSPACE` env** logically isolates data between instances (separate dir /
  namespace prefix / `workspace` column depending on backend). It is set at
  server start, **not per request**.

---

## 3. How Actovia connects

Mirror the Elasticsearch integration shape.

### 3.1 Settings schema

`src/shared/schemas/settings-schema.ts`:

```ts
export const LightRagSchema = z.object({
  url: optionalHttpUrl,              // http://localhost:9621
  apiKey: z.string().nullish(),      // -> X-API-Key
  queryMode: z
    .enum(['naive', 'local', 'global', 'hybrid', 'mix'])
    .nullish(),                      // default 'mix'
  topK: formNumber(z.number().gte(1).lte(200)).nullish(),
  chunkTopK: formNumber(z.number().gte(1).lte(100)).nullish()
})

// SettingsSchema:
graphRag: LightRagSchema.nullish(),   // or rename the page — see §6.4
```

`settings.graphRag` jsonb column on the `settings` table (same pattern as
`fullTextSearch`, `s3`). Regenerate the migration.

### 3.2 Service / client layer

`src/main/lib/knowledge-base/lightrag-client.ts` — a thin `fetch` wrapper:

```ts
class LightRagClient {
  constructor(
    private baseUrl: string,
    private apiKey?: string
  ) {}
  private headers() {
    return this.apiKey ? { 'X-API-Key': this.apiKey } : {}
  }

  health(): Promise<LightRagHealth>
  insertText(text: string, source: string): Promise<{ track_id: string }>
  uploadFile(file: Buffer, name: string): Promise<{ track_id: string }>
  trackStatus(id: string): Promise<TrackStatus>
  deleteDoc(docId: string): Promise<void>
  retrieve(query: string, opts): Promise<{ context: string; references: Ref[] }>
  // -> POST /query/data  (or /query with only_need_context=true)
}
```

Plus `resolveLightRag(settings): LightRagClient | null` — the same
"never throws, treat bad config as not-configured" helper as
`resolveSearchProvider()`, because it will be called from the hot chat path.

### 3.3 Proxy routes (renderer → main → LightRAG)

The renderer can't reach `localhost:9621` directly through our CSP/model, and we
want the API key to stay in main. Add to the settings/KB router:

```
POST   /api/knowledge-base/test-connection   -> client.health()
POST   /api/knowledge-base/documents         -> client.insertText / uploadFile
GET    /api/knowledge-base/documents/:trackId/status
DELETE /api/knowledge-base/documents/:docId
GET    /api/knowledge-base/documents         -> list (from LightRAG or our mirror)
```

(Retrieval is _not_ exposed to the renderer — it happens inside the agent loop
in main.)

---

## 4. What Actovia needs to build

| #   | Work item                                                                                                                 | Size         | Notes                                                                                                                                                                                             |
| --- | ------------------------------------------------------------------------------------------------------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `LightRagSchema` + `settings.graphRag` column + migration                                                                 | S            | copy `fullTextSearch`                                                                                                                                                                             |
| 2   | `lightrag-client.ts` + `resolveLightRag()`                                                                                | M            | fetch wrapper, error-swallowing resolver                                                                                                                                                          |
| 3   | `/api/knowledge-base/*` proxy routes                                                                                      | M            | test-connection, doc CRUD, status poll                                                                                                                                                            |
| 4   | Settings page (replace `graph-rag.tsx` `<UnderConstruction/>`)                                                            | M            | URL / key / mode / topK + "Test Connection"; reuse `SettingsRow`                                                                                                                                  |
| 5   | Knowledge-base management UI                                                                                              | L            | list docs, add text / upload file, per-doc **index status** (pending/processing/processed/failed), delete. The Philharmonic "Knowledge Base" page (`knowledge-base-page.tsx`) is the natural host |
| 6   | `searchKnowledgeBase` tool → point at LightRAG                                                                            | S–M          | `kb-tools.ts` already exists; swap `searchKnowledgeDocs()` for `client.retrieve()`, keep the tool contract                                                                                        |
| 7   | Bind the tool in **main chat** too                                                                                        | S            | `tool-binding-util.ts`: `if (resolveLightRag(setting)) tools.push(searchKnowledgeBase(...))`                                                                                                      |
| 8   | Decide fate of `knowledge_doc` table + existing Philharmonic KB                                                           | M            | see §6.3                                                                                                                                                                                          |
| 9   | Team/scope story                                                                                                          | L / deferred | see §7.1                                                                                                                                                                                          |
| 10  | `docs/lightrag-setup.md` end-user guide                                                                                   | S            | sibling of `elasticsearch-setup.md`; docker-compose + `.env` + embedding-dim warning                                                                                                              |
| 11  | Failure/telemetry: KB unreachable → tool returns "unavailable", chat continues; log under a `knowledge-base` logger scope | S            | mirror ES fallback                                                                                                                                                                                |

**Explicitly NOT our job:** running/upgrading LightRAG, its LLM/embedding keys,
its database, its graph schema, rerank model config, backups of `rag_storage`.

### Suggested phasing

1. **Phase 1 — connect + retrieve.** Items 1–3, 6, 7, 11 + a minimal settings
   page (item 4). No management UI: user adds documents via LightRAG's own
   `/webui`. Actovia can already answer from the KB. Ship this first.
2. **Phase 2 — manage from Actovia.** Item 5 (+ finish item 4). Add/upload/delete
   docs and see indexing status without leaving Actovia.
3. **Phase 3 — scoping + polish.** Items 8, 9. Reconcile with Philharmonic teams,
   retire or repurpose `knowledge_doc`.

---

## 5. When the AI retrieves from the KB

### 5.1 Mechanism: tool call, model-decided

Retrieval is a **built-in tool**, not an automatic pre-fetch. The agent loop
(`agentLoop` in `chat.ts`) exposes `searchKnowledgeBase`; the model calls it
when the question looks like it needs project/company knowledge, reads the
returned context, then answers. This is how the Philharmonic KB tool already
works (`createSearchKnowledgeBaseTool`, bound in `pm-coordinator.ts` and
`execution-engine.ts`).

```
user turn
  └─ bindCallingTools() adds `searchKnowledgeBase` when resolveLightRag(setting) != null
       └─ model emits tool_call { query: "..." }
            └─ main calls LightRAG POST /query/data  (retrieval only)
                 └─ tool result = formatted chunks + references
                      └─ model writes the answer with Actovia's chat model
```

### 5.2 Retrieval-only, not answer-generation

Call `POST /query/data` (or `only_need_context=true`). We take LightRAG's
**retrieved context + references** and feed them to our own model. Rationale:

- Answer style, streaming, cost tracking, personality, and tool-chaining stay
  in Actovia's loop.
- The user doesn't need a well-configured `QUERY_LLM_MODEL` on LightRAG — only a
  cheap extraction model for ingestion.
- We can cite `references[].file_path` in our UI consistently with other tools.

Trade-off: we lose LightRAG's own answer-shaping prompt. Acceptable — that's the
"Actovia uses the data" principle the user stated.

### 5.3 Which surfaces get the tool

| Surface                            | Bind when                                                                  | Scope                                              |
| ---------------------------------- | -------------------------------------------------------------------------- | -------------------------------------------------- |
| Main chat (`tool-binding-util.ts`) | `resolveLightRag(setting)` non-null **and** not disabled in Built-in Tools | whole KB (single user)                             |
| Project chats                      | same, unless a project opts out                                            | could pin a `file_source` prefix per project later |
| Philharmonic Groups                | already bound; switch backend to LightRAG                                  | team scoping — see §7.1                            |
| Deep Research                      | probably not — it has its own web-first engine                             | —                                                  |

### 5.4 Optional later: always-inject mode

A `graphRag.autoInject` setting that, like `memory.useInChat`, runs one
`mode=naive` retrieval on the raw user message every turn and prepends the top
few chunks to the system prompt (same slot as `memoriesSection` in `chat.ts`).
Cheaper cognitively for the model, more expensive per turn. Ship tool-only
first; add this only if users ask.

---

## 6. Interaction with what we already have

### 6.1 The `rag` tool mention in `prompts.ts`

`src/main/lib/ai/prompts.ts:96` documents a `rag` tool ("retrieve relevant
context from the user's knowledge base") that **does not exist** in
`calling-tools/`. It's aspirational. This integration is what makes that line
real — implement it as `searchKnowledgeBase` and update the prompt.

### 6.2 `vector` extension is already enabled

`migrate.ts` runs `CREATE EXTENSION IF NOT EXISTS vector` but nothing uses it —
there is no embedding column or embedding generation anywhere in Actovia. With
LightRAG owning all vectors/graph, **we still don't need local pgvector**. Leave
the extension (harmless) or drop it; not part of this work.

### 6.3 The `knowledge_doc` table + Philharmonic KB

Today: `knowledge_doc` (title, content, teamId) + `searchKnowledgeDocs()` naive
substring match, surfaced only in Philharmonic. Options:

- **A. LightRAG owns documents.** Drop `knowledge_doc`. The management UI talks
  to LightRAG directly (`/documents/*`). Simplest; matches "Actovia only
  connects". Loses our rich-text editing / team column / offline listing.
- **B. `knowledge_doc` stays as source-of-truth; LightRAG is the index.** User
  edits docs in Actovia; on save we `POST /documents/text` with
  `file_source = knowledge_doc.id` and store the returned `doc_id`/`track_id`.
  Delete → `DELETE /documents/{doc_id}`. Keeps our editor + team column; costs a
  sync layer and re-index on every edit.
- **C. Hybrid:** `knowledge_doc` becomes a thin mirror (id, title, source,
  lightragDocId, indexStatus) for listing + status, no `content`.

**Recommendation:** **B** for now — it preserves the Philharmonic team-scoping
column and the in-app editor, and the sync is one call per save. Revisit if the
corpus grows past hand-authored docs (then **A** + `/documents/upload`).

### 6.4 Settings page naming

`SettingsLabel.GraphRag = 'GraphRAG'` today. Once this is real, consider
renaming the page to **"Knowledge Base"** (user-facing; "GraphRAG" is jargon)
with body copy explaining it's powered by a self-hosted LightRAG — same way
"Full Text Search" doesn't say "Elasticsearch" in the label. Backend key can
stay `graphRag` or become `knowledgeBase`. Decide during design.

---

## 7. Open questions & risks

### 7.1 Multi-tenancy vs. Philharmonic team scoping ⚠️ biggest one

Philharmonic has "General" docs (`teamId = null`, visible to all Groups) and
per-Team docs. LightRAG isolation is **per instance/workspace**, set at start.
Within one instance there is no reliable per-request "only these teams" filter
(`file_path` is a weak tag; no metadata WHERE clause on retrieval).

Possible answers, roughly in order of effort:

1. **One workspace, no scoping** — every Group sees the whole KB. Fine for a
   single-user desktop app; the "teams" distinction is mostly organisational.
   _Recommended default._
2. **Post-filter references** by `file_path` prefix after retrieval — leaks into
   the graph/entity context even if chunks are filtered. Fragile.
3. **Workspace per scope** — Actovia manages N LightRAG workspaces (needs the
   server run with a backend that supports runtime workspace selection, or N
   containers). Heavy; probably over-engineering for desktop.

Lead with (1); document the limitation.

### 7.2 Embedding dimension lock-in

`EMBEDDING_DIM` cannot change after the first ingest without wiping
`rag_storage`. If the user later switches embedding models they re-index
everything. Our setup doc must warn loudly. Actovia should surface
`/health`'s embedding info on the settings page so the user can see what they're
committed to.

### 7.3 Async indexing UX

"I added a doc but the answer doesn't know about it yet" is confusing. The
management UI needs visible per-doc status and ideally a global "pipeline
busy" indicator (`GET /documents/pipeline_status`). Retrieval before indexing
completes just returns less.

### 7.4 Cost & latency

- Ingestion burns LLM tokens on the user's LightRAG key (entity extraction).
  A big import can be expensive/slow. Warn before bulk upload.
- `mix` query adds ~1 graph round-trip + rerank over `naive`. For chat-tool use
  this is usually fine; expose `queryMode` so power users can pick `naive`.

### 7.5 Offline / not-configured

Default state is "no URL" → tool not bound → zero behaviour change. KB
configured but unreachable → `resolveLightRag` returns null on connect failure
inside the resolver, or the tool call catches and returns "knowledge base
unavailable"; **chat never breaks.** Same contract as Elasticsearch.

### 7.6 Version skew

LightRAG's API is still moving (releases ~monthly: v1.4.8 → v1.4.10 as of this
writing). Pin the image tag in our setup doc, keep the client tolerant of extra
JSON fields, and centralise all endpoint strings in `lightrag-client.ts`.

---

## 8. Appendix — concrete calls

### Test connection

```
GET http://localhost:9621/health
X-API-Key: <key>
→ 200 {"status":"healthy","configuration":{"llm_model":"...","embedding_dim":3072,...}}
```

### Add a document

```
POST http://localhost:9621/documents/text
X-API-Key: <key>
{"text": "<full doc content>", "file_source": "<knowledge_doc.id>"}
→ 200 {"status":"success","track_id":"txt_a1b2..."}

GET http://localhost:9621/documents/track_status/txt_a1b2...
→ {"track_id":"...","documents":[{"id":"doc-...","status":"processed"}]}
```

### Retrieve context for the agent tool

```
POST http://localhost:9621/query/data
X-API-Key: <key>
{"query": "<model's query>", "mode": "mix", "top_k": 60, "chunk_top_k": 20}
→ {"entities":[...], "relationships":[...], "chunks":[{"content":"...","file_path":"..."}]}
```

or, if we prefer the generation endpoint in context-only form:

```
POST http://localhost:9621/query
{"query":"...","mode":"mix","only_need_context":true,"include_references":true}
→ {"response":"<assembled context text>","references":[{"reference_id":"1","file_path":"handbook.md"}]}
```

Actovia then hands `response`/`chunks` + `references` to its own chat model as
the tool result.

### Delete

```
DELETE http://localhost:9621/documents/<doc_id>
X-API-Key: <key>
```
