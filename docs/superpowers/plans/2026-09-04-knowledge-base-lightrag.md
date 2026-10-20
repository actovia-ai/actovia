# Knowledge Base via LightRAG Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrate a self-hosted LightRAG server as Actovia's single knowledge base — `knowledge_doc` rows are the editable source-of-truth, synced into LightRAG via a durable queue, and retrieved by a model-decided `searchKnowledgeBase` tool in both the main chat and Philharmonic.

**Architecture:** Actovia is a pure LightRAG client (URL + API key in settings), mirroring the optional-Elasticsearch posture. Document CRUD writes `knowledge_doc` and enqueues a `kb-sync` pgmq job; the job pushes to LightRAG (`POST /documents/text`, delete+reinsert on edit) and a periodic reconciler settles per-doc `indexStatus` via `GET /documents/track_status`. Retrieval calls `POST /query` with `only_need_context:true` so Actovia's own chat model writes the answer. The existing Philharmonic substring-stub KB and its team-scoping are removed.

**Tech Stack:** Electron main (Node), Hono routes, Drizzle ORM + PGlite, pgmq job queue, Zod settings schemas, React 19 + RHF + Tailwind v4 renderer, Vitest + Playwright tests, `@mariozechner/pi-agent-core` `AgentTool`.

**Spec:** `docs/superpowers/specs/2026-09-04-knowledge-base-lightrag-design.md`

## Global Constraints

- **Never break a chat turn or a document save.** LightRAG unreachable →
  `searchKnowledgeBase` returns "The knowledge base is currently unavailable."
  and the turn continues; `kb-sync` failures land on the doc's `indexStatus`,
  never on the save response.
- **`resolveKnowledgeBase` never throws** — it runs on the hot chat path
  (`bindCallingTools`). A malformed URL is logged and treated as "not
  configured".
- **Dark by default:** no `settings.knowledgeBase.url` → the tool is never
  bound, zero behavior change.
- **Retrieval-only:** always call LightRAG with `only_need_context: true`.
  Actovia's configured model generates every answer. Never surface LightRAG's
  own generated text.
- **Endpoint strings live only in `lightrag-client.ts`.** No LightRAG paths
  anywhere else.
- **No data migration.** The repo keeps exactly one squashed Drizzle migration
  (`0000_*`); it is regenerated from scratch on schema change and a DB wipe is
  assumed. Do not write an incremental migration.
- **Logger surface for all KB code:** `'knowledge-base'`.
- **Copy:** the settings page is titled **"Knowledge Base"** (not "GraphRAG",
  not "LightRAG"). The end-user setup doc may name LightRAG freely.
- Run `pnpm format && pnpm lint && npm run typecheck && pnpm test` before every
  commit; all must pass. `npx electron-vite build` before the final commit.

---

## Task 1: Settings schema, DB schema, migration

**Files:**

- Modify: `src/shared/schemas/settings-schema.ts` (add `KnowledgeBaseSchema`, add `knowledgeBase` to `SettingsSchema`)
- Modify: `src/main/lib/db/schema.ts` (import `KnowledgeBaseSchema`; `knowledgeDoc` columns; new enum; `settings.knowledgeBase`)
- Modify: `resources/drizzle/*` (regenerate)
- Test: `tests/unit/main/lib/db/schema-knowledge-base.test.ts` (create)

**Interfaces:**

- Produces:
  - `KnowledgeBaseSchema` — Zod object `{ url?, apiKey?, queryMode?: 'naive'|'local'|'global'|'hybrid'|'mix', topK?: number, chunkTopK?: number }` (all nullish).
  - `settings.knowledgeBase` jsonb column, typed `z.infer<typeof KnowledgeBaseSchema>`.
  - `knowledgeDoc` new columns: `lightragDocId: text|null`, `lightragTrackId: text|null`, `indexStatus: 'pending'|'processing'|'processed'|'failed'|'stale'` (default `'pending'`), `indexError: text|null`, `syncedHash: text|null`. `teamId` **removed**.
  - `knowledgeIndexStatusEnum` pgEnum `knowledge_index_status`.
  - `KnowledgeDoc` type (from `InferSelectModel`) reflects the above.

- [ ] **Step 1: Add `KnowledgeBaseSchema` to `settings-schema.ts`**

Insert after `FullTextSearchSchema` (near line 96):

```ts
export const KnowledgeBaseSchema = z.object({
  url: optionalHttpUrl, // self-hosted LightRAG server, e.g. http://localhost:9621
  apiKey: z.string().nullish(), // sent as the X-API-Key header
  queryMode: z.enum(['naive', 'local', 'global', 'hybrid', 'mix']).nullish(), // default 'mix'
  topK: formNumber(z.number().gte(1).lte(200)).nullish(), // default 60
  chunkTopK: formNumber(z.number().gte(1).lte(100)).nullish() // default 10
})
```

In `SettingsSchema` (near the `fullTextSearch` line ~203) add:

```ts
  knowledgeBase: KnowledgeBaseSchema.nullish(),
```

- [ ] **Step 2: Update `db/schema.ts` imports and the `settings` table**

In the `@shared/schemas/settings-schema` import block (near line 3-16) add
`KnowledgeBaseSchema,` (keep alphabetical-ish with the others).

In the `settings` pgTable (after the `fullTextSearch` column ~line 150):

```ts
  knowledgeBase:
    jsonb('knowledgeBase').$type<z.infer<typeof KnowledgeBaseSchema>>(),
```

- [ ] **Step 3: Rewrite the `knowledge_doc` table**

Replace the current `knowledgeDoc` definition (the `// ─── Knowledge Base (RAG
stub) ───` block, ~line 522) with:

```ts
// ─── Knowledge Base ──────────────────────────────────────────────────────────

export const knowledgeIndexStatusEnum = pgEnum('knowledge_index_status', [
  'pending', // never synced, or content changed and a kb-sync job is queued
  'processing', // submitted to LightRAG; track_id outstanding
  'processed', // LightRAG reports the doc indexed
  'failed', // submit or processing failed; see indexError
  'stale' // hash != syncedHash but no sync running (needs Reindex all)
])

export const knowledgeDoc = pgTable('knowledge_doc', {
  id: uuid('id').primaryKey().notNull().defaultRandom(),
  title: text('title').notNull(),
  content: text('content').notNull(),
  lightragDocId: text('lightragDocId'),
  lightragTrackId: text('lightragTrackId'),
  indexStatus: knowledgeIndexStatusEnum('indexStatus')
    .notNull()
    .default('pending'),
  indexError: text('indexError'),
  syncedHash: text('syncedHash'),
  createdAt: timestamp('createdAt').defaultNow().notNull(),
  updatedAt: timestamp('updatedAt').defaultNow().notNull()
})

export type KnowledgeDoc = InferSelectModel<typeof knowledgeDoc>
```

(The `team` import may now be unused by this block — leave other usages intact;
`grep 'team\.' schema.ts` before removing the import.)

- [ ] **Step 4: Write the schema test**

`tests/unit/main/lib/db/schema-knowledge-base.test.ts`:

```ts
import { knowledgeDoc, settings } from '@main/lib/db/schema'
import { describe, expect, it } from 'vitest'

describe('knowledge base schema', () => {
  it('knowledge_doc has the sync-tracking columns and no teamId', () => {
    const cols = Object.keys(knowledgeDoc)
    expect(cols).toEqual(
      expect.arrayContaining([
        'lightragDocId',
        'lightragTrackId',
        'indexStatus',
        'indexError',
        'syncedHash'
      ])
    )
    expect(cols).not.toContain('teamId')
  })

  it('settings has a knowledgeBase column', () => {
    expect(Object.keys(settings)).toContain('knowledgeBase')
  })
})
```

- [ ] **Step 5: Run the test — expect PASS**

Run: `pnpm test schema-knowledge-base`
Expected: PASS (schema objects expose their columns as keys).

- [ ] **Step 6: Regenerate the migration**

The repo keeps one squashed migration. Delete it, reset the journal, regenerate:

```bash
rm resources/drizzle/0000_*.sql resources/drizzle/meta/0000_snapshot.json
printf '{\n  "version": "7",\n  "dialect": "postgresql",\n  "entries": []\n}' \
  > resources/drizzle/meta/_journal.json
pnpm db:generate
```

- [ ] **Step 7: Verify the generated SQL**

Run: `grep -E '"knowledgeBase"|knowledge_index_status|"teamId"' resources/drizzle/0000_*.sql`
Expected: `"knowledgeBase" jsonb` present; `CREATE TYPE ... "knowledge_index_status"` present; **no** `"teamId"` on `knowledge_doc` (grep the `CREATE TABLE "knowledge_doc"` block specifically).

- [ ] **Step 8: Typecheck**

Run: `npm run typecheck`
Expected: PASS. (Consumers of `knowledgeDoc.teamId` / `KnowledgeDoc.teamId` will
now fail — those are fixed in Tasks 2, 11, 12. If typecheck fails **only** in
`knowledge-queries.ts`, `philharmonic-conversations.ts`, `kb-tools.ts`,
`knowledge-base-page.tsx`, `stores/philharmonic.ts`, that is expected at this
point — proceed. Any other file failing is a real problem.)

- [ ] **Step 9: Commit**

```bash
git add src/shared/schemas/settings-schema.ts src/main/lib/db/schema.ts \
  resources/drizzle tests/unit/main/lib/db/schema-knowledge-base.test.ts
git commit -m "feat(kb): settings + knowledge_doc schema for LightRAG sync"
```

---

## Task 2: `knowledge-queries.ts` helpers

**Files:**

- Modify: `src/main/lib/db/knowledge-queries.ts`
- Modify: `tests/unit/main/lib/db/knowledge-queries.test.ts`

**Interfaces:**

- Consumes: `knowledgeDoc`, `KnowledgeDoc` (Task 1).
- Produces:
  - `getAllKnowledgeDocs(): Promise<KnowledgeDoc[]>` (unchanged).
  - `getKnowledgeDocById(id: string): Promise<KnowledgeDoc | undefined>`
  - `createKnowledgeDoc(data: { title: string; content: string }): Promise<KnowledgeDoc>` (no `teamId`).
  - `updateKnowledgeDoc(id: string, data: Partial<{ title: string; content: string }>): Promise<KnowledgeDoc>`
  - `deleteKnowledgeDoc(id: string): Promise<void>`
  - `setIndexStatus(id: string, patch: Partial<Pick<KnowledgeDoc, 'indexStatus' | 'indexError' | 'lightragDocId' | 'lightragTrackId' | 'syncedHash'>>): Promise<void>`
  - `getProcessingDocs(): Promise<KnowledgeDoc[]>` — rows where `indexStatus = 'processing'` and `lightragTrackId IS NOT NULL`.
  - **Removed:** `searchKnowledgeDocs`.

- [ ] **Step 1: Rewrite the failing test**

Replace `tests/unit/main/lib/db/knowledge-queries.test.ts` entirely:

```ts
import { describe, expect, it, vi } from 'vitest'

const calls: Record<string, unknown[]> = { set: [], where: [] }

vi.mock('@main/lib/db/db', () => ({
  db: {
    select: () => ({
      from: () => ({
        where: (w: unknown) => {
          calls.where.push(w)
          return {
            orderBy: async () => [{ id: 'p1', indexStatus: 'processing' }]
          }
        },
        orderBy: async () => [{ id: 'd1' }]
      })
    }),
    update: () => ({
      set: (s: unknown) => {
        calls.set.push(s)
        return { where: async () => undefined }
      }
    })
  }
}))

const q = await import('@main/lib/db/knowledge-queries')

describe('knowledge-queries', () => {
  it('does not export the substring stub anymore', () => {
    expect('searchKnowledgeDocs' in q).toBe(false)
  })

  it('setIndexStatus writes the patch', async () => {
    calls.set.length = 0
    await q.setIndexStatus('d1', { indexStatus: 'failed', indexError: 'boom' })
    expect(calls.set[0]).toMatchObject({
      indexStatus: 'failed',
      indexError: 'boom'
    })
  })

  it('getProcessingDocs filters by indexStatus', async () => {
    const rows = await q.getProcessingDocs()
    expect(rows[0].indexStatus).toBe('processing')
  })
})
```

- [ ] **Step 2: Run — expect FAIL**

Run: `pnpm test knowledge-queries`
Expected: FAIL (`searchKnowledgeDocs` still exported; `setIndexStatus` /
`getProcessingDocs` undefined).

- [ ] **Step 3: Rewrite `knowledge-queries.ts`**

```ts
// src/main/lib/db/knowledge-queries.ts
import { and, desc, eq, isNotNull } from 'drizzle-orm'

import { db } from './db'
import { knowledgeDoc, type KnowledgeDoc } from './schema'

export async function getAllKnowledgeDocs(): Promise<KnowledgeDoc[]> {
  return db.select().from(knowledgeDoc).orderBy(desc(knowledgeDoc.updatedAt))
}

export async function getKnowledgeDocById(
  id: string
): Promise<KnowledgeDoc | undefined> {
  const [row] = await db
    .select()
    .from(knowledgeDoc)
    .where(eq(knowledgeDoc.id, id))
  return row
}

export async function createKnowledgeDoc(data: {
  title: string
  content: string
}): Promise<KnowledgeDoc> {
  const [row] = await db.insert(knowledgeDoc).values(data).returning()
  return row
}

export async function updateKnowledgeDoc(
  id: string,
  data: Partial<{ title: string; content: string }>
): Promise<KnowledgeDoc> {
  const [row] = await db
    .update(knowledgeDoc)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(knowledgeDoc.id, id))
    .returning()
  return row
}

export async function deleteKnowledgeDoc(id: string): Promise<void> {
  await db.delete(knowledgeDoc).where(eq(knowledgeDoc.id, id))
}

type IndexStatusPatch = Partial<
  Pick<
    KnowledgeDoc,
    | 'indexStatus'
    | 'indexError'
    | 'lightragDocId'
    | 'lightragTrackId'
    | 'syncedHash'
  >
>

export async function setIndexStatus(
  id: string,
  patch: IndexStatusPatch
): Promise<void> {
  await db.update(knowledgeDoc).set(patch).where(eq(knowledgeDoc.id, id))
}

export async function getProcessingDocs(): Promise<KnowledgeDoc[]> {
  return db
    .select()
    .from(knowledgeDoc)
    .where(
      and(
        eq(knowledgeDoc.indexStatus, 'processing'),
        isNotNull(knowledgeDoc.lightragTrackId)
      )
    )
    .orderBy(desc(knowledgeDoc.updatedAt))
}
```

- [ ] **Step 4: Run — expect PASS**

Run: `pnpm test knowledge-queries`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/lib/db/knowledge-queries.ts tests/unit/main/lib/db/knowledge-queries.test.ts
git commit -m "feat(kb): knowledge-queries sync helpers, drop substring stub"
```

---

## Task 3: LightRAG client + logger surface

**Files:**

- Create: `src/main/lib/knowledge-base/lightrag-client.ts`
- Create: `src/main/lib/knowledge-base/errors.ts`
- Modify: `src/main/lib/logger.ts` (add `'knowledge-base'` to `LogSurface`)
- Test: `tests/unit/main/lib/knowledge-base/lightrag-client.test.ts` (create)

**Interfaces:**

- Produces:
  - `class LightRagError extends Error` — `{ status?: number; body?: string }`.
  - `class LightRagClient` with:
    - `constructor(baseUrl: string, apiKey?: string)`
    - `health(): Promise<LightRagHealth>` → `{ status: string; llmModel?: string; embeddingModel?: string; embeddingDim?: number; documentCount?: number }`
    - `insertText(text: string, fileSource: string): Promise<{ trackId: string }>`
    - `deleteDoc(lightragDocId: string): Promise<void>` (swallows 404)
    - `trackStatus(trackId: string): Promise<{ status: 'pending'|'processing'|'processed'|'failed'; docId?: string; error?: string }>`
    - `retrieve(query: string, opts: { mode: string; topK: number; chunkTopK: number }): Promise<{ context: string; references: { id: string; source: string }[] }>`

- [ ] **Step 1: Add the logger surface**

`src/main/lib/logger.ts`, in the `LogSurface` union, add `| 'knowledge-base'`
after `| 'search'`.

- [ ] **Step 2: Write `errors.ts`**

```ts
// src/main/lib/knowledge-base/errors.ts
export class LightRagError extends Error {
  status?: number
  body?: string
  constructor(message: string, opts?: { status?: number; body?: string }) {
    super(message)
    this.name = 'LightRagError'
    this.status = opts?.status
    this.body = opts?.body
  }
}
```

- [ ] **Step 3: Write the failing test**

`tests/unit/main/lib/knowledge-base/lightrag-client.test.ts`:

```ts
import { LightRagError } from '@main/lib/knowledge-base/errors'
import { LightRagClient } from '@main/lib/knowledge-base/lightrag-client'
import { afterEach, describe, expect, it, vi } from 'vitest'

const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)
afterEach(() => fetchMock.mockReset())

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body)
  } as Response
}

describe('LightRagClient', () => {
  it('insertText posts to /documents/text with the file_source and maps track_id', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ track_id: 'txt_1' }))
    const c = new LightRagClient('http://localhost:9621', 'k')
    const res = await c.insertText('# T\n\nbody', 'doc-42')

    expect(res).toEqual({ trackId: 'txt_1' })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('http://localhost:9621/documents/text')
    expect(init.method).toBe('POST')
    expect(init.headers['X-API-Key']).toBe('k')
    expect(JSON.parse(init.body)).toEqual({
      text: '# T\n\nbody',
      file_source: 'doc-42'
    })
  })

  it('retrieve sends only_need_context and maps response+references', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        response: 'assembled context',
        references: [{ reference_id: '1', file_path: 'doc-42' }]
      })
    )
    const c = new LightRagClient('http://localhost:9621')
    const res = await c.retrieve('what is x', {
      mode: 'mix',
      topK: 60,
      chunkTopK: 10
    })

    expect(res.context).toBe('assembled context')
    expect(res.references).toEqual([{ id: '1', source: 'doc-42' }])
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body).toMatchObject({
      query: 'what is x',
      mode: 'mix',
      top_k: 60,
      chunk_top_k: 10,
      only_need_context: true,
      include_references: true
    })
  })

  it('deleteDoc swallows a 404', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ detail: 'not found' }, 404))
    const c = new LightRagClient('http://localhost:9621')
    await expect(c.deleteDoc('gone')).resolves.toBeUndefined()
  })

  it('throws LightRagError on a 500', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ detail: 'kaboom' }, 500))
    const c = new LightRagClient('http://localhost:9621')
    await expect(c.health()).rejects.toBeInstanceOf(LightRagError)
  })

  it('normalizes a trailing slash in the base URL', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ status: 'healthy' }))
    const c = new LightRagClient('http://localhost:9621/')
    await c.health()
    expect(fetchMock.mock.calls[0][0]).toBe('http://localhost:9621/health')
  })
})
```

- [ ] **Step 4: Run — expect FAIL**

Run: `pnpm test lightrag-client`
Expected: FAIL (module not found).

- [ ] **Step 5: Write `lightrag-client.ts`**

```ts
// src/main/lib/knowledge-base/lightrag-client.ts
import { LightRagError } from './errors'

export interface LightRagHealth {
  status: string
  llmModel?: string
  embeddingModel?: string
  embeddingDim?: number
  documentCount?: number
}

export interface RetrievedContext {
  context: string
  references: { id: string; source: string }[]
}

export interface TrackStatus {
  status: 'pending' | 'processing' | 'processed' | 'failed'
  docId?: string
  error?: string
}

export class LightRagClient {
  private readonly baseUrl: string

  constructor(
    baseUrl: string,
    private readonly apiKey?: string
  ) {
    this.baseUrl = baseUrl.replace(/\/+$/, '')
  }

  private async call<T>(
    path: string,
    init?: RequestInit & { okStatuses?: number[] }
  ): Promise<{ status: number; body: T }> {
    const headers: Record<string, string> = {
      accept: 'application/json',
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...(this.apiKey ? { 'X-API-Key': this.apiKey } : {})
    }
    let res: Response
    try {
      res = await fetch(`${this.baseUrl}${path}`, { ...init, headers })
    } catch (err) {
      throw new LightRagError(
        `LightRAG request failed: ${err instanceof Error ? err.message : String(err)}`
      )
    }
    const ok = res.ok || (init?.okStatuses ?? []).includes(res.status)
    if (!ok) {
      const body = await res.text().catch(() => '')
      throw new LightRagError(`LightRAG ${path} → ${res.status}`, {
        status: res.status,
        body
      })
    }
    const body = (await res.json().catch(() => ({}))) as T
    return { status: res.status, body }
  }

  async health(): Promise<LightRagHealth> {
    const { body } = await this.call<Record<string, unknown>>('/health')
    const cfg = (body.configuration ?? {}) as Record<string, unknown>
    return {
      status: String(body.status ?? 'unknown'),
      llmModel: (cfg.llm_model ?? body.llm_model) as string | undefined,
      embeddingModel: (cfg.embedding_model ?? body.embedding_model) as
        | string
        | undefined,
      embeddingDim:
        Number(cfg.embedding_dim ?? body.embedding_dim) || undefined,
      documentCount:
        Number(
          (body.document_count as number) ??
            (body.documents as Record<string, unknown>)?.processed
        ) || undefined
    }
  }

  async insertText(
    text: string,
    fileSource: string
  ): Promise<{ trackId: string }> {
    const { body } = await this.call<{ track_id?: string }>('/documents/text', {
      method: 'POST',
      body: JSON.stringify({ text, file_source: fileSource })
    })
    if (!body.track_id) throw new LightRagError('LightRAG returned no track_id')
    return { trackId: body.track_id }
  }

  async deleteDoc(lightragDocId: string): Promise<void> {
    await this.call(`/documents/${encodeURIComponent(lightragDocId)}`, {
      method: 'DELETE',
      okStatuses: [404]
    })
  }

  async trackStatus(trackId: string): Promise<TrackStatus> {
    const { body } = await this.call<Record<string, unknown>>(
      `/documents/track_status/${encodeURIComponent(trackId)}`
    )
    const docs = (body.documents ?? []) as Array<Record<string, unknown>>
    const first = docs[0] ?? {}
    const raw = String(first.status ?? body.status ?? 'processing')
    const status: TrackStatus['status'] =
      raw === 'processed' || raw === 'failed' || raw === 'pending'
        ? raw
        : 'processing'
    return {
      status,
      docId: (first.id ?? first.doc_id) as string | undefined,
      error: (first.error_msg ?? first.error) as string | undefined
    }
  }

  async retrieve(
    query: string,
    opts: { mode: string; topK: number; chunkTopK: number }
  ): Promise<RetrievedContext> {
    const { body } = await this.call<{
      response?: string
      references?: Array<{ reference_id?: string; file_path?: string }>
    }>('/query', {
      method: 'POST',
      body: JSON.stringify({
        query,
        mode: opts.mode,
        top_k: opts.topK,
        chunk_top_k: opts.chunkTopK,
        only_need_context: true,
        include_references: true,
        max_total_tokens: 8000
      })
    })
    return {
      context: body.response ?? '',
      references: (body.references ?? []).map((r) => ({
        id: r.reference_id ?? '',
        source: r.file_path ?? ''
      }))
    }
  }
}
```

- [ ] **Step 6: Run — expect PASS**

Run: `pnpm test lightrag-client`
Expected: PASS (all 5).

- [ ] **Step 7: Commit**

```bash
git add src/main/lib/knowledge-base/ src/main/lib/logger.ts \
  tests/unit/main/lib/knowledge-base/lightrag-client.test.ts
git commit -m "feat(kb): LightRAG HTTP client"
```

---

## Task 4: `resolveKnowledgeBase` resolver

**Files:**

- Create: `src/main/lib/knowledge-base/resolve-knowledge-base.ts`
- Test: `tests/unit/main/lib/knowledge-base/resolve-knowledge-base.test.ts` (create)

**Interfaces:**

- Consumes: `LightRagClient` (Task 3), `Settings` (from `@main/lib/db/schema`).
- Produces: `resolveKnowledgeBase(settings: Settings): LightRagClient | null` —
  cached by `url + apiKey`; `null` for empty/malformed url; never throws.

- [ ] **Step 1: Write the failing test**

`tests/unit/main/lib/knowledge-base/resolve-knowledge-base.test.ts` (mirrors
`resolve-search-provider.test.ts`):

```ts
import type { Settings } from '@main/lib/db/schema'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@main/lib/db/db', () => ({ pglite: {}, db: {} }))
vi.mock('electron', () => ({ app: { getPath: () => '/tmp' } }))
vi.mock('@electron-toolkit/utils', () => ({ is: { dev: true } }))

const { resolveKnowledgeBase } =
  await import('@main/lib/knowledge-base/resolve-knowledge-base')

const base = { id: 'global' } as Settings
const withUrl = (url: string, apiKey?: string) =>
  ({ ...base, knowledgeBase: { url, apiKey } }) as Settings

describe('resolveKnowledgeBase', () => {
  it('returns null when unconfigured', () => {
    expect(resolveKnowledgeBase(base)).toBeNull()
  })

  it('returns null when url is empty', () => {
    expect(resolveKnowledgeBase(withUrl(''))).toBeNull()
  })

  it('returns null (not throw) on a malformed url', () => {
    expect(resolveKnowledgeBase(withUrl('localhost:9621'))).toBeNull()
  })

  it('returns a client when url is set', () => {
    expect(
      resolveKnowledgeBase(withUrl('http://localhost:9621'))
    ).not.toBeNull()
  })

  it('caches by url+apiKey', () => {
    const a = resolveKnowledgeBase(withUrl('http://h:9621', 'k1'))
    const b = resolveKnowledgeBase(withUrl('http://h:9621', 'k1'))
    const c = resolveKnowledgeBase(withUrl('http://h:9621', 'k2'))
    expect(a).toBe(b)
    expect(a).not.toBe(c)
  })
})
```

- [ ] **Step 2: Run — expect FAIL**

Run: `pnpm test resolve-knowledge-base`
Expected: FAIL (module not found).

- [ ] **Step 3: Write `resolve-knowledge-base.ts`**

```ts
// src/main/lib/knowledge-base/resolve-knowledge-base.ts
import type { Settings } from '../db/schema'
import { logger } from '../logger'
import { LightRagClient } from './lightrag-client'

let cachedKey: string | null = null
let cachedClient: LightRagClient | null = null

/**
 * Never throws — runs on the hot chat path (bindCallingTools, Philharmonic
 * loops). Empty or malformed URL is treated exactly as "not configured".
 */
export function resolveKnowledgeBase(
  settings: Settings
): LightRagClient | null {
  const cfg = settings.knowledgeBase
  const url = cfg?.url?.trim()
  if (!url) return null
  if (!/^https?:\/\//.test(url)) {
    logger.warn('knowledge-base', 'Ignoring malformed knowledge base URL', {
      url
    })
    return null
  }
  const key = JSON.stringify([url, cfg?.apiKey ?? ''])
  if (cachedClient && cachedKey === key) return cachedClient
  try {
    cachedClient = new LightRagClient(url, cfg?.apiKey ?? undefined)
    cachedKey = key
    return cachedClient
  } catch (error) {
    logger.warn('knowledge-base', 'Failed to build LightRAG client', {
      error: String(error)
    })
    return null
  }
}
```

- [ ] **Step 4: Run — expect PASS**

Run: `pnpm test resolve-knowledge-base`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/lib/knowledge-base/resolve-knowledge-base.ts \
  tests/unit/main/lib/knowledge-base/resolve-knowledge-base.test.ts
git commit -m "feat(kb): resolveKnowledgeBase (cached, never-throws)"
```

---

## Task 5: `kb-sync` queue, handler, reconciler

**Files:**

- Modify: `src/main/lib/jobs/types.ts` (add `'kb-sync'` + `KbSyncPayload`)
- Modify: `src/main/lib/jobs/handlers.ts` (add the `'kb-sync'` handler)
- Create: `src/main/lib/knowledge-base/reconcile.ts`
- Modify: `src/main/lib/jobs/worker.ts` (call the reconciler from the cron)
- Modify: `tests/unit/main/lib/jobs/handlers.test.ts`
- Modify: `tests/unit/main/lib/jobs/worker.test.ts` and `tests/unit/main/lib/jobs/queries.integration.test.ts` (handler mock map gains `'kb-sync'`)
- Create: `tests/unit/main/lib/knowledge-base/reconcile.test.ts`

**Interfaces:**

- Consumes: `resolveKnowledgeBase` (Task 4), `getKnowledgeDocById`,
  `setIndexStatus`, `getProcessingDocs` (Task 2), `LightRagClient` (Task 3).
- Produces:
  - `QueueName` includes `'kb-sync'`; `QUEUE_NAMES` includes it.
  - `KbSyncPayload = { op: 'upsert'; docId: string } | { op: 'delete'; lightragDocId: string }`
  - `handlers['kb-sync']` — see logic below.
  - `reconcileKnowledgeIndexStatus(): Promise<void>` in `knowledge-base/reconcile.ts`.
  - `contentHash(title: string, content: string): string` exported from `knowledge-base/reconcile.ts` — `sha256` of `# ${title}\n\n${content}`. (Shared by the handler and any caller that needs the hash.)

- [ ] **Step 1: Extend `jobs/types.ts`**

```ts
export type QueueName =
  | 'index-message'
  | 'lcm-post-turn'
  | 'memory-consolidate'
  | 'kb-sync'

export const QUEUE_NAMES: QueueName[] = [
  'index-message',
  'lcm-post-turn',
  'memory-consolidate',
  'kb-sync'
]

// ...existing JobMessage interface unchanged...

export type KbSyncPayload =
  | { op: 'upsert'; docId: string }
  | { op: 'delete'; lightragDocId: string }
```

- [ ] **Step 2: Write `reconcile.ts` (with `contentHash`)**

```ts
// src/main/lib/knowledge-base/reconcile.ts
import { createHash } from 'crypto'

import { getProcessingDocs, setIndexStatus } from '../db/knowledge-queries'
import { getSettings } from '../db/queries'
import { logger } from '../logger'
import { resolveKnowledgeBase } from './resolve-knowledge-base'

export function contentHash(title: string, content: string): string {
  return createHash('sha256').update(`# ${title}\n\n${content}`).digest('hex')
}

const STALE_AFTER_MS = 10 * 60 * 1000

/**
 * Settles knowledge_doc rows stuck in `processing` by polling LightRAG's
 * track_status. The only status-settlement path — covers the normal case
 * (badge flips within one cron tick), a process restart mid-ingest, and a
 * LightRAG that silently drops the job (→ `stale` after 10 min).
 */
export async function reconcileKnowledgeIndexStatus(): Promise<void> {
  const settings = await getSettings()
  const kb = resolveKnowledgeBase(settings)
  if (!kb) return

  const rows = await getProcessingDocs()
  for (const row of rows) {
    if (!row.lightragTrackId) continue
    try {
      const st = await kb.trackStatus(row.lightragTrackId)
      if (st.status === 'processed') {
        await setIndexStatus(row.id, {
          indexStatus: 'processed',
          indexError: null,
          lightragDocId: st.docId ?? row.lightragDocId ?? null
        })
      } else if (st.status === 'failed') {
        await setIndexStatus(row.id, {
          indexStatus: 'failed',
          indexError: st.error ?? 'LightRAG reported a processing failure'
        })
      } else if (Date.now() - row.updatedAt.getTime() > STALE_AFTER_MS) {
        await setIndexStatus(row.id, { indexStatus: 'stale' })
      }
    } catch (error) {
      logger.warn('knowledge-base', 'reconcile: track_status failed', {
        docId: row.id,
        error: String(error)
      })
    }
  }
}
```

- [ ] **Step 3: Write the failing reconcile test**

`tests/unit/main/lib/knowledge-base/reconcile.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getPath: () => '/tmp' } }))
vi.mock('@electron-toolkit/utils', () => ({ is: { dev: true } }))
vi.mock('@main/lib/db/db', () => ({ db: {}, pglite: {} }))

const mockGetSettings = vi.fn()
vi.mock('@main/lib/db/queries', () => ({ getSettings: mockGetSettings }))

const mockGetProcessingDocs = vi.fn()
const mockSetIndexStatus = vi.fn()
vi.mock('@main/lib/db/knowledge-queries', () => ({
  getProcessingDocs: mockGetProcessingDocs,
  setIndexStatus: mockSetIndexStatus
}))

const mockTrackStatus = vi.fn()
vi.mock('@main/lib/knowledge-base/resolve-knowledge-base', () => ({
  resolveKnowledgeBase: () => ({ trackStatus: mockTrackStatus })
}))

const { reconcileKnowledgeIndexStatus } =
  await import('@main/lib/knowledge-base/reconcile')

const row = (over: Record<string, unknown> = {}) => ({
  id: 'd1',
  lightragTrackId: 'txt_1',
  lightragDocId: null,
  updatedAt: new Date(),
  ...over
})

describe('reconcileKnowledgeIndexStatus', () => {
  it('marks processed rows processed and stores the doc id', async () => {
    mockGetSettings.mockResolvedValue({ id: 'global' })
    mockGetProcessingDocs.mockResolvedValue([row()])
    mockTrackStatus.mockResolvedValue({ status: 'processed', docId: 'ldoc-9' })

    await reconcileKnowledgeIndexStatus()

    expect(mockSetIndexStatus).toHaveBeenCalledWith('d1', {
      indexStatus: 'processed',
      indexError: null,
      lightragDocId: 'ldoc-9'
    })
  })

  it('marks failed rows failed', async () => {
    mockGetSettings.mockResolvedValue({ id: 'global' })
    mockGetProcessingDocs.mockResolvedValue([row()])
    mockTrackStatus.mockResolvedValue({ status: 'failed', error: 'bad pdf' })

    await reconcileKnowledgeIndexStatus()

    expect(mockSetIndexStatus).toHaveBeenCalledWith('d1', {
      indexStatus: 'failed',
      indexError: 'bad pdf'
    })
  })

  it('marks long-stuck rows stale', async () => {
    mockGetSettings.mockResolvedValue({ id: 'global' })
    mockGetProcessingDocs.mockResolvedValue([
      row({ updatedAt: new Date(Date.now() - 20 * 60 * 1000) })
    ])
    mockTrackStatus.mockResolvedValue({ status: 'processing' })

    await reconcileKnowledgeIndexStatus()

    expect(mockSetIndexStatus).toHaveBeenCalledWith('d1', {
      indexStatus: 'stale'
    })
  })
})
```

- [ ] **Step 4: Run — expect PASS** (reconcile.ts already written in Step 2)

Run: `pnpm test reconcile`
Expected: PASS (3).

- [ ] **Step 5: Add the `kb-sync` handler**

In `src/main/lib/jobs/handlers.ts`, add imports:

```ts
import { getKnowledgeDocById, setIndexStatus } from '../db/knowledge-queries'
import { contentHash } from '../knowledge-base/reconcile'
import { resolveKnowledgeBase } from '../knowledge-base/resolve-knowledge-base'
import type { KbSyncPayload } from './types'
```

Add the handler entry to the `handlers` record:

```ts
    'kb-sync': async (payload) => {
      const p = payload as KbSyncPayload
      const kb = resolveKnowledgeBase(await getSettings())
      if (!kb) return

      if (p.op === 'delete') {
        try {
          await kb.deleteDoc(p.lightragDocId)
        } catch {
          // The doc is already gone from Actovia; an orphan in LightRAG is
          // harmless and Reindex all never recreates it. Nothing to retry.
        }
        return
      }

      const doc = await getKnowledgeDocById(p.docId)
      if (!doc) return
      const hash = contentHash(doc.title, doc.content)
      if (hash === doc.syncedHash && doc.indexStatus === 'processed') return

      try {
        if (doc.lightragDocId) await kb.deleteDoc(doc.lightragDocId)
        const { trackId } = await kb.insertText(
          `# ${doc.title}\n\n${doc.content}`,
          doc.id
        )
        await setIndexStatus(doc.id, {
          lightragTrackId: trackId,
          syncedHash: hash,
          indexStatus: 'processing',
          indexError: null,
          lightragDocId: null
        })
      } catch (error) {
        await setIndexStatus(doc.id, {
          indexStatus: 'failed',
          indexError: String(error)
        })
        throw error // let pgmq retry the transient case
      }
    }
```

- [ ] **Step 6: Add `kb-sync` handler tests**

Append to `tests/unit/main/lib/jobs/handlers.test.ts`. Add mocks near the top
(after the existing `vi.mock` calls):

```ts
const mockGetKnowledgeDocById = vi.fn()
const mockSetIndexStatus = vi.fn()
vi.mock('@main/lib/db/knowledge-queries', () => ({
  getKnowledgeDocById: mockGetKnowledgeDocById,
  setIndexStatus: mockSetIndexStatus
}))

const mockKbInsertText = vi.fn()
const mockKbDeleteDoc = vi.fn()
vi.mock('@main/lib/knowledge-base/resolve-knowledge-base', () => ({
  resolveKnowledgeBase: () => ({
    insertText: mockKbInsertText,
    deleteDoc: mockKbDeleteDoc
  })
}))
// contentHash is pure — use the real module.
```

Then a describe block:

```ts
describe('handlers.kb-sync', () => {
  it('inserts a new doc and marks it processing', async () => {
    mockGetSettings.mockResolvedValue({ id: 'global' })
    mockGetKnowledgeDocById.mockResolvedValue({
      id: 'd1',
      title: 'T',
      content: 'body',
      syncedHash: null,
      indexStatus: 'pending',
      lightragDocId: null
    })
    mockKbInsertText.mockResolvedValue({ trackId: 'txt_9' })

    await handlers['kb-sync']({ op: 'upsert', docId: 'd1' })

    expect(mockKbInsertText).toHaveBeenCalledWith('# T\n\nbody', 'd1')
    expect(mockSetIndexStatus).toHaveBeenCalledWith(
      'd1',
      expect.objectContaining({
        indexStatus: 'processing',
        lightragTrackId: 'txt_9'
      })
    )
  })

  it('deletes the old LightRAG doc before reinserting on content change', async () => {
    mockGetSettings.mockResolvedValue({ id: 'global' })
    mockGetKnowledgeDocById.mockResolvedValue({
      id: 'd1',
      title: 'T',
      content: 'new body',
      syncedHash: 'old-hash',
      indexStatus: 'processed',
      lightragDocId: 'ldoc-1'
    })
    mockKbInsertText.mockResolvedValue({ trackId: 'txt_10' })

    await handlers['kb-sync']({ op: 'upsert', docId: 'd1' })

    expect(mockKbDeleteDoc).toHaveBeenCalledWith('ldoc-1')
    expect(mockKbInsertText).toHaveBeenCalled()
  })

  it('is a no-op when the hash is unchanged and already processed', async () => {
    const { contentHash } = await import('@main/lib/knowledge-base/reconcile')
    mockGetSettings.mockResolvedValue({ id: 'global' })
    mockGetKnowledgeDocById.mockResolvedValue({
      id: 'd1',
      title: 'T',
      content: 'body',
      syncedHash: contentHash('T', 'body'),
      indexStatus: 'processed',
      lightragDocId: 'ldoc-1'
    })

    await handlers['kb-sync']({ op: 'upsert', docId: 'd1' })
    expect(mockKbInsertText).not.toHaveBeenCalled()
  })

  it('marks failed and rethrows when insertText throws', async () => {
    mockGetSettings.mockResolvedValue({ id: 'global' })
    mockGetKnowledgeDocById.mockResolvedValue({
      id: 'd1',
      title: 'T',
      content: 'body',
      syncedHash: null,
      indexStatus: 'pending',
      lightragDocId: null
    })
    mockKbInsertText.mockRejectedValue(new Error('down'))

    await expect(
      handlers['kb-sync']({ op: 'upsert', docId: 'd1' })
    ).rejects.toThrow('down')
    expect(mockSetIndexStatus).toHaveBeenCalledWith(
      'd1',
      expect.objectContaining({ indexStatus: 'failed' })
    )
  })

  it('delete op calls deleteDoc and swallows errors', async () => {
    mockGetSettings.mockResolvedValue({ id: 'global' })
    mockKbDeleteDoc.mockRejectedValue(new Error('404'))
    await expect(
      handlers['kb-sync']({ op: 'delete', lightragDocId: 'ldoc-x' })
    ).resolves.toBeUndefined()
  })
})
```

Note: existing `handlers.test.ts` mocks `@main/lib/db/queries` for
`getSettings` — reuse that `mockGetSettings`.

- [ ] **Step 7: Update the other jobs tests' handler mock maps**

In `tests/unit/main/lib/jobs/worker.test.ts` and
`tests/unit/main/lib/jobs/queries.integration.test.ts`, wherever the handlers
record is mocked, add `'kb-sync': vi.fn()` to the map so `QUEUE_NAMES`
iteration stays consistent. (Grep each file for `memory-consolidate` to find
the spot.)

- [ ] **Step 8: Wire the reconciler into the cron**

In `src/main/lib/jobs/worker.ts`, `initJobQueue()`:

```ts
import { reconcileKnowledgeIndexStatus } from '../knowledge-base/reconcile'

// inside initJobQueue(), after the existing cron.schedule block:
cron.schedule('*/30 * * * * *', () => {
  reconcileKnowledgeIndexStatus().catch((error) => {
    logger.error('knowledge-base', 'index-status reconcile sweep failed', {
      error: String(error)
    })
  })
})
```

- [ ] **Step 9: Run the full jobs + kb test set — expect PASS**

Run: `pnpm test jobs knowledge-base`
Expected: PASS.

- [ ] **Step 10: Typecheck + commit**

Run: `npm run typecheck` (expect PASS)

```bash
git add src/main/lib/jobs src/main/lib/knowledge-base/reconcile.ts \
  tests/unit/main/lib/jobs tests/unit/main/lib/knowledge-base/reconcile.test.ts
git commit -m "feat(kb): kb-sync queue + handler + index-status reconciler"
```

---

## Task 6: `/api/knowledge-base` router

**Files:**

- Create: `src/main/lib/server/routes/knowledge-base.ts`
- Modify: `src/main/lib/server/app.ts` (import + mount)
- Modify: `src/main/lib/server/routes/philharmonic-conversations.ts` (remove `/knowledge*` routes + now-unused imports)
- Modify: `tests/unit/main/lib/server/routes/philharmonic-conversations.test.ts` (drop any `/knowledge` cases; keep the `knowledge-queries` mock if still referenced, else remove)
- Create: `tests/api/knowledge-base.spec.ts`

**Interfaces:**

- Consumes: `getAllKnowledgeDocs`, `getKnowledgeDocById`, `createKnowledgeDoc`,
  `updateKnowledgeDoc`, `deleteKnowledgeDoc` (Task 2); `enqueueAndProcess`,
  `logEnqueueFailure` (`@main/lib/jobs/worker`); `resolveKnowledgeBase` (Task 4);
  `handleDatabaseOperation`, `successResponse`, `getRequiredParam` (`../utils`).
- Produces: routes under `/api/knowledge-base`:
  - `POST /test-connection` → `{ status, llmModel?, embeddingModel?, embeddingDim?, documentCount? }`, 400 `KNOWLEDGE_BASE_NOT_CONFIGURED` when unresolved.
  - `GET /documents` → `KnowledgeDoc[]`
  - `POST /documents` `{ title, content }` → `KnowledgeDoc` (201)
  - `PUT /documents/:id` `{ title?, content? }` → `KnowledgeDoc`
  - `DELETE /documents/:id` → `{ ok: true }`
  - `POST /documents/reindex-all` → `{ count }`

- [ ] **Step 1: Add an error code**

`src/shared/constants/error-codes.ts` — add
`KNOWLEDGE_BASE_NOT_CONFIGURED = 'KNOWLEDGE_BASE_NOT_CONFIGURED'` near the other
validation codes. (Grep the file for `VALIDATION_FAILED` to match style.)

- [ ] **Step 2: Write the router**

```ts
// src/main/lib/server/routes/knowledge-base.ts
import { ErrorCode } from '@shared/constants/error-codes'
import { ValidationError } from '@shared/errors/app-error'
import { Variables } from '@shared/types/server'
import { Hono } from 'hono'
import { z } from 'zod'

import {
  createKnowledgeDoc,
  deleteKnowledgeDoc,
  getAllKnowledgeDocs,
  getKnowledgeDocById,
  setIndexStatus,
  updateKnowledgeDoc
} from '../../db/knowledge-queries'
import { enqueueAndProcess, logEnqueueFailure } from '../../jobs/worker'
import { resolveKnowledgeBase } from '../../knowledge-base/resolve-knowledge-base'
import {
  getRequiredParam,
  handleDatabaseOperation,
  successResponse,
  validateSchema
} from '../utils'

const router = new Hono<{ Variables: Variables }>()

const enqueueUpsert = (docId: string) =>
  enqueueAndProcess('kb-sync', { op: 'upsert', docId }).catch((e) =>
    logEnqueueFailure('kb-sync', e)
  )

router.post('/test-connection', async (c) => {
  const kb = resolveKnowledgeBase(c.get('settings'))
  if (!kb) {
    throw new ValidationError(
      ErrorCode.KNOWLEDGE_BASE_NOT_CONFIGURED,
      'Knowledge base is not configured'
    )
  }
  try {
    const health = await kb.health()
    return successResponse(c, health)
  } catch (error) {
    throw new ValidationError(
      ErrorCode.VALIDATION_FAILED,
      error instanceof Error
        ? `Failed to connect to the knowledge base: ${error.message}`
        : 'Failed to connect to the knowledge base'
    )
  }
})

router.get('/documents', async (c) =>
  successResponse(
    c,
    await handleDatabaseOperation(
      () => getAllKnowledgeDocs(),
      'Failed to load knowledge documents'
    )
  )
)

router.post('/documents', async (c) => {
  const data = validateSchema(
    z.object({ title: z.string().min(1), content: z.string().min(1) }),
    await c.req.json(),
    'Invalid knowledge document'
  )
  const row = await handleDatabaseOperation(
    () => createKnowledgeDoc(data),
    'Failed to create knowledge document'
  )
  await enqueueUpsert(row.id)
  return successResponse(c, row, 201)
})

router.put('/documents/:id', async (c) => {
  const id = getRequiredParam(c, 'id')
  const data = validateSchema(
    z.object({
      title: z.string().min(1).optional(),
      content: z.string().min(1).optional()
    }),
    await c.req.json(),
    'Invalid knowledge document'
  )
  const row = await handleDatabaseOperation(
    () => updateKnowledgeDoc(id, data),
    'Failed to update knowledge document'
  )
  if (data.title !== undefined || data.content !== undefined) {
    await setIndexStatus(id, { indexStatus: 'pending' })
    await enqueueUpsert(id)
  }
  return successResponse(c, row)
})

router.delete('/documents/:id', async (c) => {
  const id = getRequiredParam(c, 'id')
  const row = await getKnowledgeDocById(id)
  await handleDatabaseOperation(
    () => deleteKnowledgeDoc(id),
    'Failed to delete knowledge document'
  )
  if (row?.lightragDocId) {
    await enqueueAndProcess('kb-sync', {
      op: 'delete',
      lightragDocId: row.lightragDocId
    }).catch((e) => logEnqueueFailure('kb-sync', e))
  }
  return successResponse(c, { ok: true })
})

router.post('/documents/reindex-all', async (c) => {
  const docs = await handleDatabaseOperation(
    () => getAllKnowledgeDocs(),
    'Failed to load knowledge documents'
  )
  for (const d of docs) {
    await setIndexStatus(d.id, { indexStatus: 'pending' })
    await enqueueUpsert(d.id)
  }
  return successResponse(c, { count: docs.length })
})

export default router
```

- [ ] **Step 3: Mount it**

`src/main/lib/server/app.ts`: `import knowledgeBaseRouter from './routes/knowledge-base'`
(alphabetical with the other imports) and
`app.route('/api/knowledge-base', knowledgeBaseRouter)` next to the other routes.

- [ ] **Step 4: Remove the Philharmonic `/knowledge` routes**

In `src/main/lib/server/routes/philharmonic-conversations.ts`: delete the
`router.get('/knowledge'...)`, `router.post('/knowledge'...)`,
`router.put('/knowledge/:id'...)`, `router.delete('/knowledge/:id'...)` blocks
and the imports from `../../db/knowledge-queries` that only they used.

In `tests/unit/main/lib/server/routes/philharmonic-conversations.test.ts`:
remove any test hitting `/knowledge`; if the `vi.mock('@main/lib/db/knowledge-queries', () => ({}))`
line is now unused, remove it, otherwise keep it.

- [ ] **Step 5: Write the API test**

`tests/api/knowledge-base.spec.ts`:

```ts
import { apiTest as test, expect } from '../fixtures/api-client'

test.describe('Knowledge Base API', () => {
  test('documents CRUD sets index status to pending', async ({ api }) => {
    const created = await api.post('/api/knowledge-base/documents', {
      title: 'Handbook',
      content: 'The office opens at 9.'
    })
    expect(created.status).toBe(201)
    const id = (created.data as { id: string; indexStatus: string }).id
    expect((created.data as { indexStatus: string }).indexStatus).toBe(
      'pending'
    )

    const updated = await api.put(`/api/knowledge-base/documents/${id}`, {
      content: 'The office opens at 8.'
    })
    expect(updated.status).toBe(200)

    const list = await api.get('/api/knowledge-base/documents')
    expect(
      (list.data as unknown[]).some((d) => (d as { id: string }).id === id)
    ).toBe(true)

    const del = await api.delete(`/api/knowledge-base/documents/${id}`)
    expect(del.status).toBe(200)
  })

  test('test-connection 400s when unconfigured', async ({ api }) => {
    await api.updateSettings({ knowledgeBase: { url: '' } })
    const res = await api.post('/api/knowledge-base/test-connection')
    expect(res.status).toBe(400)
  })
})
```

`tests/fixtures/api-client.ts` already has `get`, `post(path, body?)`,
`put(path, body)`, `delete(path)`. `successResponse(c, data)` returns the
payload **unwrapped**, so `created.data` is the row itself (no `.data.data`).

- [ ] **Step 6: Run — expect PASS**

Run: `pnpm test knowledge` then the api suite per `CLAUDE.md`'s test commands
(`tests/api` runs under Playwright — follow the repo's `pnpm test:api` or
equivalent; if unavailable in this environment, run unit + typecheck and note
the api spec is written).

- [ ] **Step 7: Typecheck + commit**

```bash
git add src/main/lib/server src/shared/constants/error-codes.ts \
  tests/unit/main/lib/server/routes/philharmonic-conversations.test.ts \
  tests/api/knowledge-base.spec.ts
git commit -m "feat(kb): /api/knowledge-base router, drop philharmonic /knowledge routes"
```

---

## Task 7: shared `KnowledgeDocData` type + renderer service

**Files:**

- Create: `src/shared/types/knowledge-base.ts`
- Modify: `src/renderer/stores/philharmonic.ts` (remove local `KnowledgeDocData`)
- Create: `src/renderer/services/knowledge-base.ts`
- Modify: `src/renderer/services/philharmonic-chat.ts` (remove KB functions)

**Interfaces:**

- Produces:
  - `src/shared/types/knowledge-base.ts`:
    ```ts
    export type KnowledgeIndexStatus =
      | 'pending'
      | 'processing'
      | 'processed'
      | 'failed'
      | 'stale'
    export interface KnowledgeDocData {
      id: string
      title: string
      content: string
      indexStatus: KnowledgeIndexStatus
      indexError: string | null
      createdAt: string
      updatedAt: string
    }
    ```
  - `src/renderer/services/knowledge-base.ts`:
    - `getKnowledgeDocs(): Promise<KnowledgeDocData[]>`
    - `createKnowledgeDoc(d: { title: string; content: string }): Promise<KnowledgeDocData>`
    - `updateKnowledgeDoc(id: string, d: Partial<{ title: string; content: string }>): Promise<KnowledgeDocData>`
    - `deleteKnowledgeDoc(id: string): Promise<void>`
    - `reindexAll(): Promise<{ count: number }>`
    - `testKnowledgeBaseConnection(): Promise<LightRagHealthDto>` where
      `LightRagHealthDto = { status: string; llmModel?: string; embeddingModel?: string; embeddingDim?: number; documentCount?: number }`

- [ ] **Step 1: Create the shared type**

Write `src/shared/types/knowledge-base.ts` with the block above plus:

```ts
export interface LightRagHealthDto {
  status: string
  llmModel?: string
  embeddingModel?: string
  embeddingDim?: number
  documentCount?: number
}
```

- [ ] **Step 2: Point the store at the shared type**

`src/renderer/stores/philharmonic.ts`: delete the local
`export interface KnowledgeDocData { ... }` block. If anything in that file
still references it, `import type { KnowledgeDocData } from '@shared/types/knowledge-base'`.

- [ ] **Step 3: Write the renderer service**

```ts
// src/renderer/services/knowledge-base.ts
import type {
  KnowledgeDocData,
  LightRagHealthDto
} from '@shared/types/knowledge-base'
import { fetcher } from '@shared/utils/http'

const BASE = '/api/knowledge-base'

export const getKnowledgeDocs = () =>
  fetcher<KnowledgeDocData[]>(`${BASE}/documents`)

export const createKnowledgeDoc = (d: { title: string; content: string }) =>
  fetcher<KnowledgeDocData>(`${BASE}/documents`, { method: 'POST', body: d })

export const updateKnowledgeDoc = (
  id: string,
  d: Partial<{ title: string; content: string }>
) =>
  fetcher<KnowledgeDocData>(`${BASE}/documents/${id}`, {
    method: 'PUT',
    body: d
  })

export const deleteKnowledgeDoc = (id: string) =>
  fetcher<void>(`${BASE}/documents/${id}`, {
    method: 'DELETE',
    responseType: 'text'
  })

export const reindexAll = () =>
  fetcher<{ count: number }>(`${BASE}/documents/reindex-all`, {
    method: 'POST'
  })

export const testKnowledgeBaseConnection = () =>
  fetcher<LightRagHealthDto>(`${BASE}/test-connection`, { method: 'POST' })
```

(Match the exact `fetcher` option names by copying from
`src/renderer/services/memory.ts` / `philharmonic-chat.ts`.)

- [ ] **Step 4: Strip KB functions from `philharmonic-chat.ts`**

Delete `getKnowledgeDocs`, `createKnowledgeDoc`, `updateKnowledgeDoc`,
`deleteKnowledgeDoc` and the now-unused `KnowledgeDocData` import there.

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: failures now only in `knowledge-base-page.tsx`, `conversation-list.tsx`,
`philharmonic.tsx` (fixed in Tasks 8 & 12) and any settings-form ref to
`graph-rag` (Task 10). Anything else = real problem.

- [ ] **Step 6: Commit**

```bash
git add src/shared/types/knowledge-base.ts src/renderer/services/knowledge-base.ts \
  src/renderer/services/philharmonic-chat.ts src/renderer/stores/philharmonic.ts
git commit -m "feat(kb): shared KnowledgeDocData type + renderer service"
```

---

## Task 8: `searchKnowledgeBase` tool + registry + prompt

**Files:**

- Create: `src/main/lib/ai/calling-tools/search-knowledge-base.ts`
- Modify: `src/main/lib/ai/calling-tools/index.ts` (export it)
- Modify: `src/shared/constants/tools.ts` (`TOOL_REGISTRY` entry)
- Modify: `src/main/lib/ai/prompts.ts` (replace the `rag` bullet)
- Create: `tests/unit/main/lib/ai/calling-tools/search-knowledge-base.test.ts`

**Interfaces:**

- Consumes: `LightRagClient` (Task 3); `KnowledgeBaseSchema` infer type (Task 1).
- Produces:
  - `searchKnowledgeBase(client: LightRagClient, cfg: { queryMode?: ...; topK?: number; chunkTopK?: number } | null | undefined): AgentTool` —
    tool `name: 'searchKnowledgeBase'`, param `query: string`.

- [ ] **Step 1: Write the failing test**

`tests/unit/main/lib/ai/calling-tools/search-knowledge-base.test.ts`:

```ts
import { searchKnowledgeBase } from '@main/lib/ai/calling-tools/search-knowledge-base'
import { LightRagError } from '@main/lib/knowledge-base/errors'
import { describe, expect, it, vi } from 'vitest'

const client = (retrieve: unknown) => ({ retrieve }) as never

describe('searchKnowledgeBase tool', () => {
  it('returns the assembled context and uses config defaults', async () => {
    const retrieve = vi.fn().mockResolvedValue({
      context: 'Doc says the office opens at 9.',
      references: [{ id: '1', source: 'doc-1' }]
    })
    const tool = searchKnowledgeBase(client(retrieve), null)
    const res = await tool.execute('id', { query: 'office hours' })

    expect(retrieve).toHaveBeenCalledWith('office hours', {
      mode: 'mix',
      topK: 60,
      chunkTopK: 10
    })
    expect(JSON.stringify(res)).toContain('office opens at 9')
  })

  it('passes configured query options through', async () => {
    const retrieve = vi.fn().mockResolvedValue({ context: 'x', references: [] })
    const tool = searchKnowledgeBase(client(retrieve), {
      queryMode: 'local',
      topK: 20,
      chunkTopK: 5
    })
    await tool.execute('id', { query: 'q' })
    expect(retrieve).toHaveBeenCalledWith('q', {
      mode: 'local',
      topK: 20,
      chunkTopK: 5
    })
  })

  it('says "no match" on empty context', async () => {
    const tool = searchKnowledgeBase(
      client(vi.fn().mockResolvedValue({ context: '', references: [] })),
      null
    )
    const res = await tool.execute('id', { query: 'absent' })
    expect(JSON.stringify(res).toLowerCase()).toContain('no ')
  })

  it('returns "unavailable" (never throws) on LightRagError', async () => {
    const tool = searchKnowledgeBase(
      client(vi.fn().mockRejectedValue(new LightRagError('down'))),
      null
    )
    const res = await tool.execute('id', { query: 'q' })
    expect(JSON.stringify(res).toLowerCase()).toContain('unavailable')
  })
})
```

- [ ] **Step 2: Run — expect FAIL**

Run: `pnpm test search-knowledge-base`
Expected: FAIL (module not found).

- [ ] **Step 3: Write the tool**

```ts
// src/main/lib/ai/calling-tools/search-knowledge-base.ts
import type { AgentTool } from '@mariozechner/pi-agent-core'
import { Type } from '@mariozechner/pi-ai'

import type { LightRagClient } from '../../knowledge-base/lightrag-client'
import { logger } from '../../logger'

const schema = Type.Object({
  query: Type.String({
    description: 'What to look up in the knowledge base.'
  })
})

interface QueryConfig {
  queryMode?: 'naive' | 'local' | 'global' | 'hybrid' | 'mix' | null
  topK?: number | null
  chunkTopK?: number | null
}

export function searchKnowledgeBase(
  client: LightRagClient,
  cfg: QueryConfig | null | undefined
): AgentTool<typeof schema> {
  return {
    name: 'searchKnowledgeBase',
    label: 'Search Knowledge Base',
    description:
      "Search the user's knowledge base for relevant context. Use before " +
      'answering questions that may be covered by the user’s own notes, ' +
      'documents, or saved company facts.',
    parameters: schema,
    execute: async (_id, { query }) => {
      try {
        const { context, references } = await client.retrieve(query, {
          mode: cfg?.queryMode ?? 'mix',
          topK: cfg?.topK ?? 60,
          chunkTopK: cfg?.chunkTopK ?? 10
        })
        if (!context.trim()) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `No knowledge base documents matched "${query}".`
              }
            ]
          }
        }
        return {
          content: [{ type: 'text' as const, text: context }],
          details: { query, references }
        }
      } catch (error) {
        logger.warn('knowledge-base', 'retrieval failed', {
          query,
          error: String(error)
        })
        return {
          content: [
            {
              type: 'text' as const,
              text: 'The knowledge base is currently unavailable.'
            }
          ]
        }
      }
    }
  }
}
```

- [ ] **Step 4: Run — expect PASS**

Run: `pnpm test search-knowledge-base`
Expected: PASS (4).

- [ ] **Step 5: Export + register + prompt**

`src/main/lib/ai/calling-tools/index.ts`: add
`import { searchKnowledgeBase } from './search-knowledge-base'` and add
`searchKnowledgeBase` to the `export { ... }` list.

`src/shared/constants/tools.ts`: add to `TOOL_REGISTRY` (in the `AI & Data`
group, near `imageGeneration`):

```ts
  {
    key: 'searchKnowledgeBase',
    label: 'Knowledge Base',
    description:
      'Retrieve context from your knowledge base (requires a configured LightRAG URL)',
    group: 'AI & Data'
  },
```

`src/main/lib/ai/prompts.ts` (~line 96): replace the `- **rag**: ...` line with

```
- **searchKnowledgeBase**: retrieve relevant context from the user's knowledge base before answering questions it might cover.
```

- [ ] **Step 6: Typecheck + commit**

```bash
git add src/main/lib/ai/calling-tools src/shared/constants/tools.ts \
  src/main/lib/ai/prompts.ts \
  tests/unit/main/lib/ai/calling-tools/search-knowledge-base.test.ts
git commit -m "feat(kb): searchKnowledgeBase retrieval tool"
```

---

## Task 9: Tool binding + delete `kb-tools` / `team-scope`

**Files:**

- Modify: `src/main/lib/ai/utils/tool-binding-util.ts`
- Modify: `src/main/lib/ai/philharmonic/pm-coordinator.ts`
- Modify: `src/main/lib/ai/philharmonic/execution-engine.ts`
- Delete: `src/main/lib/ai/philharmonic/kb-tools.ts`
- Delete: `src/main/lib/ai/philharmonic/team-scope.ts`
- Delete: `tests/unit/main/lib/ai/philharmonic/kb-tools.test.ts`
- Delete: `tests/unit/main/lib/ai/philharmonic/team-scope.test.ts`
- Modify: `tests/unit/main/lib/ai/philharmonic/pm-coordinator.test.ts` (retarget the mocks)
- Modify: `tests/unit/main/lib/ai/utils/*tool-binding*` test if present (grep)

**Interfaces:**

- Consumes: `resolveKnowledgeBase` (Task 4), `searchKnowledgeBase` (Task 8).
- Produces: `bindCallingTools` pushes `searchKnowledgeBase(kb, setting.knowledgeBase)`
  when `resolveKnowledgeBase(setting)` is non-null and `enabled('searchKnowledgeBase')`.

- [ ] **Step 1: Bind in `tool-binding-util.ts`**

Add imports:

```ts
import { resolveKnowledgeBase } from '../../knowledge-base/resolve-knowledge-base'
import { searchKnowledgeBase } from '../calling-tools'
```

(`searchKnowledgeBase` should be added to the existing `from '../calling-tools'`
import list rather than a second import line — match the file's style.)

In `bindCallingTools`, after the `webSearch` push and before the LCM block:

```ts
const kb = resolveKnowledgeBase(setting)
if (kb && enabled('searchKnowledgeBase')) {
  tools.push(searchKnowledgeBase(kb, setting.knowledgeBase))
}
```

- [ ] **Step 2: Update `pm-coordinator.ts`**

- Remove `import { createSearchKnowledgeBaseTool } from './kb-tools'` and
  `import { computeAllowedTeamIds } from './team-scope'`.
- Add `import { searchKnowledgeBase } from '../calling-tools'` and
  `import { resolveKnowledgeBase } from '../../knowledge-base/resolve-knowledge-base'`.
- Replace the `const allowedTeamIds = await computeAllowedTeamIds(conversationId)`
  line (and its comment) with `const kb = resolveKnowledgeBase(setting)`.
- In the `const tools: AgentTool[] = [ ... ]` array, replace
  `createSearchKnowledgeBaseTool(allowedTeamIds),` with:

  ```ts
    ...(kb ? [searchKnowledgeBase(kb, setting.knowledgeBase)] : []),
  ```

- [ ] **Step 3: Update `execution-engine.ts`**

- Remove `import { createSearchKnowledgeBaseTool } from './kb-tools'` and
  `import { computeAllowedTeamIds } from './team-scope'`.
- Delete the `const allowedTeamIds = await computeAllowedTeamIds(conversationId)`
  line and change the `runEmployeeLoop({ ... })` call to drop `extraTools`
  entirely (the comment above it about "KB tool is rebuilt each attempt" goes
  too). The employee loop's own `bindCallingTools` now provides
  `searchKnowledgeBase`.
- If `withRetry`'s callback body is now a one-liner `return runEmployeeLoop({...})`,
  simplify but keep behavior identical.

- [ ] **Step 4: Delete the dead modules + their tests**

```bash
git rm src/main/lib/ai/philharmonic/kb-tools.ts \
  src/main/lib/ai/philharmonic/team-scope.ts \
  tests/unit/main/lib/ai/philharmonic/kb-tools.test.ts \
  tests/unit/main/lib/ai/philharmonic/team-scope.test.ts
```

- [ ] **Step 5: Retarget `pm-coordinator.test.ts` mocks**

Replace the `vi.mock('@main/lib/ai/philharmonic/kb-tools', ...)` and
`vi.mock('@main/lib/ai/philharmonic/team-scope', ...)` blocks with:

```ts
vi.mock('@main/lib/knowledge-base/resolve-knowledge-base', () => ({
  resolveKnowledgeBase: vi.fn(() => null)
}))
```

(Returning `null` keeps the PM tool list KB-free in the existing assertions. If
a test asserts on the tool count/names, update the expected list to exclude
`searchKnowledgeBase`.)

- [ ] **Step 6: Check for a tool-binding-util test**

Run: `ls tests/unit/main/lib/ai/utils/`. If a `tool-binding-util.test.ts`
exists, add a case:

```ts
it('binds searchKnowledgeBase when a knowledge base URL is configured', () => {
  // mock resolveKnowledgeBase to return a truthy client
  const tools = bindCallingTools({
    advancedTools: [],
    setting: { id: 'global', knowledgeBase: { url: 'http://h:9621' } },
    mcpTools: []
  } as never)
  expect(tools.some((t) => t.name === 'searchKnowledgeBase')).toBe(true)
})
```

Mock `@main/lib/knowledge-base/resolve-knowledge-base` at the top of that test
file to return `{ retrieve: vi.fn() }`. If no such test file exists, create
`tests/unit/main/lib/ai/utils/tool-binding-knowledge-base.test.ts` with just
that case + the "not bound when unconfigured" counterpart.

- [ ] **Step 7: Run + typecheck**

Run: `pnpm test philharmonic tool-binding && npm run typecheck`
Expected: PASS. `pm-coordinator.ts` and `execution-engine.ts` no longer import
the deleted modules.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(kb): bind searchKnowledgeBase in chat + philharmonic, drop team-scope"
```

---

## Task 10: Settings menu rename + form dispatch

**Files:**

- Modify: `src/renderer/components/settings/settings-menu.ts`
- Modify: `src/renderer/components/settings/settings-form.tsx`
- Delete: `src/renderer/components/settings/settings-form/graph-rag.tsx`

**Interfaces:**

- Produces: `SettingsLabel.KnowledgeBase = 'Knowledge Base'` (replaces
  `GraphRag = 'GraphRAG'`).

- [ ] **Step 1: Rename the enum member + menu item**

`settings-menu.ts`:

- `GraphRag = 'GraphRAG',` → `KnowledgeBase = 'Knowledge Base',`
- In the Integrations group: `{ title: SettingsLabel.GraphRag, icon: NetworkIcon },`
  → `{ title: SettingsLabel.KnowledgeBase, icon: NetworkIcon },`
  (keep `NetworkIcon`, or swap for `LibraryBigIcon` from lucide — cosmetic).
- Update the group comment that says "search backends, GraphRAG, ..." →
  "search backends, the knowledge base, ...".

- [ ] **Step 2: Swap the form dispatch**

`settings-form.tsx`:

- `import { GraphRAG } from './settings-form/graph-rag'` →
  `import { KnowledgeBase } from './settings-form/knowledge-base'`
  (place it in import order; `knowledge-base` sorts near `keyboard-shortcuts`).
- `{activeTitle === SettingsLabel.GraphRag && <GraphRAG />}` →
  `{activeTitle === SettingsLabel.KnowledgeBase && <KnowledgeBase form={form} />}`

- [ ] **Step 3: Delete the stub**

```bash
git rm src/renderer/components/settings/settings-form/graph-rag.tsx
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: one failure — `./settings-form/knowledge-base` doesn't exist yet
(Task 11). That's the only acceptable failure. Do **not** commit yet; fold this
into Task 11's commit. (Leaving the tree non-compiling between tasks is
acceptable here because Tasks 10 and 11 ship together — a reviewer gates them
as one.)

---

## Task 11: Settings → Knowledge Base UI

**Files:**

- Create: `src/renderer/components/settings/settings-form/knowledge-base.tsx`
- Modify: `src/shared/constants/test-ids.ts` (add `knowledgeBase` group)
- Create: `tests/e2e/settings-knowledge-base.spec.ts`

**Interfaces:**

- Consumes: `services/knowledge-base.ts` (Task 7); `UseFormReturnType`
  (`@shared/schemas/settings-schema`); `SettingsSection`, `SettingsRow`
  (`../settings-row`); `Dialog`, `AlertDialog`, `Button`, `Input`, `Textarea`,
  `Badge`, `Select`, `Collapsible` (`@/components/ui/*`); `sileo`.
- RHF field paths: `knowledgeBase.url`, `knowledgeBase.apiKey`,
  `knowledgeBase.queryMode`, `knowledgeBase.topK`, `knowledgeBase.chunkTopK`.

- [ ] **Step 1: Add test-ids**

`src/shared/constants/test-ids.ts`, add near `fullTextSearch`:

```ts
  knowledgeBase: {
    testConnectionButton: 'knowledge-base.test-connection-button',
    reindexButton: 'knowledge-base.reindex-button',
    addButton: 'knowledge-base.add-button',
    docDialog: 'knowledge-base.doc-dialog',
    docTitleInput: 'knowledge-base.doc-title-input',
    docContentInput: 'knowledge-base.doc-content-input',
    docSaveButton: 'knowledge-base.doc-save-button'
  },
```

- [ ] **Step 2: Write the component**

`src/renderer/components/settings/settings-form/knowledge-base.tsx`. Structure —
adapt the connection half from `full-text-search.tsx` and the document dialog
from the (soon-deleted) `philharmonic/knowledge/knowledge-base-page.tsx` (drop
the team `Select`). Requirements:

- `export function KnowledgeBase({ form }: { form: UseFormReturnType })`.
- **Connection `SettingsSection`:**
  - `Controller name="knowledgeBase.url"` → `SettingsRow` label "Server URL",
    description "Your self-hosted LightRAG server. Leave empty to disable the
    knowledge base.", `Input` placeholder `http://localhost:9621`,
    `value={field.value ?? ''}`, `layout="vertical"`.
  - `knowledgeBase.apiKey` → `Input type="password" autoComplete="off"`.
  - `knowledgeBase.queryMode` → `Select` with items
    `naive | local | global | hybrid | mix`, description "mix blends the
    knowledge graph and vector search — best quality, slightly slower."
  - A `Collapsible` "Advanced" (default collapsed) holding `knowledgeBase.topK`
    and `knowledgeBase.chunkTopK` numeric `Input`s.
  - `SettingsRow` label "Connection": a "Test Connection" `Button`
    (`data-testid={TEST_IDS.knowledgeBase.testConnectionButton}`,
    `disabled={isTesting}`), calling `testKnowledgeBaseConnection()`. On success
    `sileo.success({ title: \`LLM: ${h.llmModel ?? '?'} · Embedding: ${h.embeddingModel ?? '?'}${h.embeddingDim ? \` (${h.embeddingDim}d)\` : ''}${h.documentCount != null ? \` · ${h.documentCount} docs\` : ''}\` })`.
    On error `sileo.error({ title: 'Failed to connect', description: getHttpErrorMessage(err) })`.
  - A persistent muted caption under that row: "Changing the embedding model in
    LightRAG requires re-ingesting every document."
- **Documents `SettingsSection`:** only render when `form.watch('knowledgeBase.url')`
  is non-empty. Header row: title "Documents" + "Add document" `Button`
  (`TEST_IDS.knowledgeBase.addButton`) + "Reindex all" `Button`
  (`TEST_IDS.knowledgeBase.reindexButton`, calls `reindexAll()` then refetches).
  - `useEffect` → `getKnowledgeDocs().then(setDocs)`; poll every 5000ms **while**
    `docs.some(d => d.indexStatus === 'pending' || d.indexStatus === 'processing')`,
    clear the interval otherwise.
  - List: for each doc a row with title, `formatDistanceToNow(new Date(updatedAt))`,
    and a status `Badge`:
    - `pending` → `<Badge variant="secondary">Pending</Badge>`
    - `processing` → `<Badge variant="secondary">Indexing…</Badge>`
    - `processed` → `<Badge>Indexed</Badge>`
    - `failed` → `<Badge variant="destructive" title={doc.indexError ?? ''}>Failed</Badge>`
    - `stale` → `<Badge variant="outline">Needs reindex</Badge>`
  - Row click → open the dialog in edit mode. A trailing `Trash2` icon button →
    `AlertDialog` confirm → `deleteKnowledgeDoc(id)` then drop from state.
  - Empty list → an `Empty`/muted "No documents yet." block.
- **Add/Edit `Dialog`** (`data-testid={TEST_IDS.knowledgeBase.docDialog}`):
  `Input` title (`docTitleInput`), `Textarea` content rows≈10 (`docContentInput`),
  Cancel + Save (`docSaveButton`, disabled until both non-empty). Save calls
  `createKnowledgeDoc` or `updateKnowledgeDoc`, updates local state, closes.
- When `knowledgeBase.url` is empty, below the connection section render a muted
  line: "Add a server URL above to manage documents."

- [ ] **Step 3: Write the e2e test**

`tests/e2e/settings-knowledge-base.spec.ts`:

```ts
import { TEST_IDS } from '../../src/shared/constants/test-ids'
import { electronTest as test, expect } from '../fixtures/electron'

test.describe('Settings — Knowledge Base', () => {
  test('renders the connection form and the add-document dialog', async ({
    mainWindow
  }) => {
    const modKey = process.platform === 'darwin' ? 'Meta' : 'Control'
    await mainWindow.keyboard.press(`${modKey}+,`)
    await mainWindow
      .getByRole('button', { name: 'Knowledge Base', exact: true })
      .click()

    await expect(
      mainWindow.getByPlaceholder('http://localhost:9621')
    ).toBeVisible()

    // Configure a URL so the Documents section appears.
    await mainWindow
      .getByPlaceholder('http://localhost:9621')
      .fill('http://localhost:9621')
    await mainWindow.getByTestId(TEST_IDS.knowledgeBase.addButton).click()
    await expect(
      mainWindow.getByTestId(TEST_IDS.knowledgeBase.docDialog)
    ).toBeVisible()

    await mainWindow
      .getByTestId(TEST_IDS.knowledgeBase.docTitleInput)
      .fill('Handbook')
    await mainWindow
      .getByTestId(TEST_IDS.knowledgeBase.docContentInput)
      .fill('The office opens at 9.')
    await mainWindow.getByTestId(TEST_IDS.knowledgeBase.docSaveButton).click()

    await expect(mainWindow.getByText('Handbook')).toBeVisible()
    await expect(mainWindow.getByText('Pending')).toBeVisible()

    // cleanup: delete the doc via API so reruns are clean
    await mainWindow.evaluate(async () => {
      const r = await fetch(
        'http://localhost:60223/api/knowledge-base/documents'
      )
      const docs = (await r.json()) as { id: string; title: string }[]
      for (const d of docs.filter((x) => x.title === 'Handbook')) {
        await fetch(
          `http://localhost:60223/api/knowledge-base/documents/${d.id}`,
          {
            method: 'DELETE'
          }
        )
      }
      await fetch('http://localhost:60223/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: 'global', knowledgeBase: { url: '' } })
      })
    })
  })
})
```

(Confirm the dev server port — grep other e2e specs for `localhost:` — and the
settings-open shortcut against `settings-full-text-search.spec.ts`.)

- [ ] **Step 4: Run the gate**

```bash
pnpm format && pnpm lint && npm run typecheck && pnpm test
```

Expected: PASS. (e2e runs separately per the repo's Playwright setup.)

- [ ] **Step 5: Commit (Tasks 10 + 11 together)**

```bash
git add -A
git commit -m "feat(kb): Settings -> Knowledge Base page (connection + documents)"
```

---

## Task 12: Philharmonic knowledge-page cleanup

**Files:**

- Delete: `src/renderer/components/philharmonic/knowledge/knowledge-base-page.tsx`
- Modify: `src/renderer/components/philharmonic/chat/conversation-list.tsx` (`CONFIG_NAV`, `ConfigPage`)
- Modify: `src/renderer/layouts/philharmonic-layout/index.tsx` (`PhilharmonicPage`)
- Modify: `src/renderer/containers/philharmonic.tsx` (drop `KnowledgeBasePage` import + branch)
- Modify: any test asserting the Philharmonic "Knowledge Base" nav item (grep `tests/e2e` for `Knowledge Base`)

**Interfaces:**

- Produces: `ConfigPage = 'workforce' | 'dashboard'`;
  `PhilharmonicPage = 'chat' | 'workforce' | 'dashboard'`.

- [ ] **Step 1: Delete the page component**

```bash
git rm src/renderer/components/philharmonic/knowledge/knowledge-base-page.tsx
```

(Also remove the now-empty `philharmonic/knowledge/` dir if git leaves it.)

- [ ] **Step 2: `conversation-list.tsx`**

- `export type ConfigPage = 'workforce' | 'knowledge' | 'dashboard'` →
  `export type ConfigPage = 'workforce' | 'dashboard'`
- Remove `{ page: 'knowledge', label: 'Knowledge Base', icon: BookOpenIcon },`
  from `CONFIG_NAV`.
- Drop the now-unused `BookOpenIcon` import if nothing else uses it.

- [ ] **Step 3: `philharmonic-layout/index.tsx`**

`export type PhilharmonicPage = 'chat' | 'workforce' | 'knowledge' | 'dashboard'`
→ drop `'knowledge'`.

- [ ] **Step 4: `containers/philharmonic.tsx`**

- Remove `import { KnowledgeBasePage } from '@/components/philharmonic/knowledge/knowledge-base-page'`.
- Remove the `if (activePage === 'knowledge') return <KnowledgeBasePage />`
  branch (grep `activePage === 'knowledge'` — around line 137).

- [ ] **Step 5: Fix any e2e nav assertions**

Run: `grep -rn "Knowledge Base" tests/e2e/`. If `sidebar.spec.ts` or a
Philharmonic nav test asserts the old page, update it to expect the item is
gone / the Settings page exists instead.

- [ ] **Step 6: Gate + commit**

```bash
pnpm format && pnpm lint && npm run typecheck && pnpm test
git add -A
git commit -m "feat(kb): remove the Philharmonic Knowledge Base nav page"
```

---

## Task 13: Docs

**Files:**

- Create: `docs/lightrag-setup.md`
- Modify: `CLAUDE.md`
- Modify: `docs/lightrag-research.md` (spec pointer)

- [ ] **Step 1: `docs/lightrag-setup.md`**

End-user guide, sibling of `docs/elasticsearch-setup.md`. Cover:

- What it is: Actovia's optional knowledge base, powered by a self-hosted
  LightRAG server. Actovia is a client only — it never runs LightRAG.
- Minimal `docker-compose.yml`:
  ```yaml
  services:
    lightrag:
      image: ghcr.io/HKUDS/LightRAG:latest # pin a real tag in production
      ports: ['9621:9621']
      volumes:
        - ./data/rag_storage:/app/data/rag_storage
        - ./data/inputs:/app/data/inputs
      env_file: .env
  ```
- The `.env` keys that matter: `LIGHTRAG_API_KEY`, `LLM_BINDING` +
  `LLM_BINDING_HOST` + `LLM_MODEL` + `LLM_BINDING_API_KEY`, `EMBEDDING_BINDING`
  - `EMBEDDING_MODEL` + `EMBEDDING_DIM`, `SUMMARY_LANGUAGE`.
- **Bold warning:** `EMBEDDING_DIM` / the embedding model cannot change after
  the first document is ingested without wiping `./data/rag_storage`.
- "In Actovia: Settings → Knowledge Base → Server URL `http://localhost:9621`,
  API Key = your `LIGHTRAG_API_KEY`. Click Test Connection, then add
  documents. Indexing runs in the background — watch the status badge."
- Note ingestion costs LLM tokens on the LightRAG key (entity extraction).

- [ ] **Step 2: `CLAUDE.md`**

- Replace the "Knowledge Base (RAG stub)" mention / `src/main/lib/search`
  neighbor text: the KB is now LightRAG-backed via `src/main/lib/knowledge-base/`.
- In the `src/main/lib/` map add:
  `- \`src/main/lib/knowledge-base/\` — LightRAG client + resolver + kb-sync reconciler`
- In the jobs list add `kb-sync` alongside `index-message` / `lcm-post-turn` /
  `memory-consolidate`.
- Where built-in tools are listed, add `searchKnowledgeBase`.
- Remove any "team-scoped knowledge base" description for Philharmonic.

- [ ] **Step 3: `docs/lightrag-research.md`**

Add at the very top, under the date line:
`> Design spec: [docs/superpowers/specs/2026-09-04-knowledge-base-lightrag-design.md](superpowers/specs/2026-09-04-knowledge-base-lightrag-design.md)`

- [ ] **Step 4: Final full gate**

```bash
pnpm format && pnpm lint && npm run typecheck && pnpm test && npx electron-vite build
```

Expected: all PASS / build ✓.

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md docs/lightrag-setup.md docs/lightrag-research.md
git commit -m "docs(kb): LightRAG setup guide + CLAUDE.md + spec pointer"
```

---

## Self-Review

**1. Spec coverage**

| Spec section                                                             | Task                                                                                                                |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| §1 schema changes (`knowledge_doc` cols, enum, `settings.knowledgeBase`) | 1                                                                                                                   |
| §2 settings schema (`KnowledgeBaseSchema`)                               | 1                                                                                                                   |
| §3 settings menu rename                                                  | 10                                                                                                                  |
| §4 LightRAG client                                                       | 3                                                                                                                   |
| §5 `resolveKnowledgeBase`                                                | 4                                                                                                                   |
| §6 `kb-sync` queue + handler + reconcile                                 | 5                                                                                                                   |
| §7 routes (`/api/knowledge-base`, remove philharmonic `/knowledge`)      | 6                                                                                                                   |
| §8 retrieval tool                                                        | 8                                                                                                                   |
| §9 tool binding (bindCallingTools + pm-coordinator + execution-engine)   | 9                                                                                                                   |
| §10 Settings UI                                                          | 11                                                                                                                  |
| §11 Philharmonic cleanup (team-scope, kb-tools, nav page, queries)       | 9 (backend) + 12 (nav) + 2 (queries)                                                                                |
| §12 docs                                                                 | 13                                                                                                                  |
| Error-handling table                                                     | 3 (client), 5 (handler/reconcile), 8 (tool)                                                                         |
| Testing section                                                          | every task's test steps + `tests/api/knowledge-base.spec.ts` (6) + `tests/e2e/settings-knowledge-base.spec.ts` (11) |
| Rollout (dark by default)                                                | Global Constraints + Task 9 binding guard                                                                           |

No gaps.

**2. Placeholder scan** — no "TBD"/"handle errors"/"similar to Task N"; every
code step has real content. The two "pick during implementation" notes
(NetworkIcon vs LibraryBigIcon; exact `fetcher` option names) are cosmetic
choices with a stated default, not logic gaps.

**3. Type consistency**

- `contentHash(title, content)` — defined in Task 5 (`reconcile.ts`), consumed
  by Task 5's handler. Consistent.
- `LightRagClient.retrieve` returns `{ context, references: {id,source}[] }` —
  Task 3 defines, Task 8 consumes as `context` / `references`. Consistent.
- `setIndexStatus(id, patch)` — Task 2 defines the patch shape, Tasks 5 & 6
  call it with `indexStatus`/`indexError`/`lightragDocId`/`lightragTrackId`/`syncedHash`
  keys, all in the `Pick`. Consistent.
- `KbSyncPayload` — Task 5 defines, Task 6 enqueues `{op:'upsert',docId}` /
  `{op:'delete',lightragDocId}`. Consistent.
- `KnowledgeDocData` (renderer, Task 7) vs `KnowledgeDoc` (drizzle, Task 1):
  the renderer type intentionally omits `syncedHash`/`lightragTrackId`/`lightragDocId`;
  the router returns full rows but the renderer only reads the listed fields. OK.
- `searchKnowledgeBase(client, cfg)` — Task 8 signature; Task 9 calls
  `searchKnowledgeBase(kb, setting.knowledgeBase)`. `setting.knowledgeBase` is
  `z.infer<KnowledgeBaseSchema> | null | undefined`, matching the `QueryConfig`
  param. Consistent.

No mismatches found.
