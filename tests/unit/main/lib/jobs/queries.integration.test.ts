import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

/**
 * Integration test — deliberately exercises REAL SQL against a REAL, in-memory
 * PGlite instance with the `pgmq` extension registered (mirroring
 * `src/main/lib/db/db.ts`'s registration pattern). Every other job-queue test in
 * this repo stubs `db.execute`, which means none of them can catch a malformed
 * SQL string; this one can, and does (it is what proves the `::bigint` cast in
 * `archiveMessage` — pgmq overloads `archive(text, bigint)` and
 * `archive(text, bigint[])`, so an untyped bound parameter resolves to neither
 * and fails with "function pgmq.archive(unknown, unknown) is not unique").
 *
 * `@main/lib/db/db` is still module-mocked, but only as dependency injection:
 * the factory hands back a genuine PGlite + drizzle pair instead of the app
 * singleton, which would otherwise open the user's real `~/.actovia/database`
 * directory (and drag Electron in via `paths.ts`) at import time. No query
 * behavior is faked — `enqueueJob`, `readBatch` and `archiveMessage` below are
 * the real exported functions running real statements.
 */
vi.mock('@main/lib/db/db', async () => {
  const { PGlite } = await import('@electric-sql/pglite')
  const { pgmq } = await import('@electric-sql/pglite-pgmq')
  const { drizzle } = await import('drizzle-orm/pglite')
  const pglite = new PGlite({ extensions: { pgmq } })
  return { pglite, db: drizzle(pglite) }
})

// `worker.ts` pulls in the real handlers (LLM/LightRAG/Electron) and the
// file logger; both are irrelevant here and are stubbed. The queue SQL that
// `processQueue` drives stays real.
const mockHandler = vi.fn()
vi.mock('@main/lib/jobs/handlers', () => ({
  handlers: {
    'kb-sync': mockHandler,
    'lcm-post-turn': vi.fn(),
    'memory-consolidate': vi.fn(),
    'discover-refresh': vi.fn()
  }
}))
vi.mock('@main/lib/logger', () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() }
}))

const { pglite } = await import('@main/lib/db/db')
const {
  enqueueJob,
  readBatch,
  archiveMessage,
  deleteMessage,
  purgeArchive,
  stripApiKeysFromQueuedJobs
} = await import('@main/lib/jobs/queries')
const { processQueue } = await import('@main/lib/jobs/worker')

const QUEUE = 'kb-sync' as const

async function queueDepth(): Promise<number> {
  const result = await pglite.query<{ count: number }>(
    `SELECT count(*)::int AS count FROM pgmq."q_${QUEUE}"`
  )
  return result.rows[0].count
}

async function archiveDepth(): Promise<number> {
  const result = await pglite.query<{ count: number }>(
    `SELECT count(*)::int AS count FROM pgmq."a_${QUEUE}"`
  )
  return result.rows[0].count
}

beforeAll(async () => {
  await pglite.waitReady
  await pglite.exec('CREATE EXTENSION IF NOT EXISTS pgmq;')
  await pglite.exec(`SELECT pgmq.create('${QUEUE}');`)
}, 60_000)

afterAll(async () => {
  await pglite.close()
})

describe('job queue SQL against a real PGlite + pgmq instance', () => {
  it('round-trips enqueue → read → archive and leaves the queue empty', async () => {
    await enqueueJob(QUEUE, { id: 'msg-1', chatId: 'chat-1' })
    expect(await queueDepth()).toBe(1)

    // vt = 0 keeps the message immediately visible again, so a follow-up read
    // returning nothing can only mean it was archived, never merely hidden.
    const first = await readBatch(QUEUE, 0, 5)
    expect(first).toHaveLength(1)
    expect(first[0].message).toEqual({ id: 'msg-1', chatId: 'chat-1' })
    expect(first[0].msgId).toBeGreaterThan(0)
    expect(first[0].readCt).toBe(1)

    // Still in the queue before archiving — proves the assertion below is real.
    expect(await readBatch(QUEUE, 0, 5)).toHaveLength(1)

    await archiveMessage(QUEUE, first[0].msgId)

    expect(await readBatch(QUEUE, 0, 5)).toEqual([])
    expect(await queueDepth()).toBe(0)
    expect(await archiveDepth()).toBe(1)
  })

  // Same overload trap as `archive`: `pgmq.delete(text, bigint)` vs
  // `pgmq.delete(text, bigint[])` — only real SQL proves the cast resolves.
  it('deleteMessage removes a message without archiving it', async () => {
    const archivedBefore = await archiveDepth()
    await enqueueJob(QUEUE, { id: 'msg-del', chatId: 'chat-del' })
    const [read] = await readBatch(QUEUE, 0, 5)

    await deleteMessage(QUEUE, read.msgId)

    expect(await queueDepth()).toBe(0)
    expect(await archiveDepth()).toBe(archivedBefore)
  })

  it('processQueue deletes — and does not archive — a message whose handler succeeds', async () => {
    mockHandler.mockClear()
    mockHandler.mockResolvedValue()
    const archivedBefore = await archiveDepth()

    await enqueueJob(QUEUE, { id: 'msg-2', chatId: 'chat-2' })
    await processQueue(QUEUE)

    expect(mockHandler).toHaveBeenCalledWith({ id: 'msg-2', chatId: 'chat-2' })
    expect(await readBatch(QUEUE, 0, 5)).toEqual([])
    expect(await queueDepth()).toBe(0)
    expect(await archiveDepth()).toBe(archivedBefore)
  })

  it('purgeArchive empties the (hyphenated, quoted) archive table', async () => {
    expect(await archiveDepth()).toBeGreaterThan(0)

    await purgeArchive(QUEUE)

    expect(await archiveDepth()).toBe(0)
  })

  it('processQueue leaves a message queued when its handler throws', async () => {
    mockHandler.mockClear()
    mockHandler.mockRejectedValue(new Error('boom'))

    await enqueueJob(QUEUE, { id: 'msg-3', chatId: 'chat-3' })
    await processQueue(QUEUE)

    expect(mockHandler).toHaveBeenCalledTimes(1)
    expect(await queueDepth()).toBe(1)

    // Clean up so the queue is empty for any later test in this file. The
    // message is invisible for the worker's visibility timeout, so read its id
    // straight from the queue table rather than through `readBatch`.
    const pending = await pglite.query<{ msg_id: number }>(
      `SELECT msg_id FROM pgmq."q_${QUEUE}"`
    )
    await archiveMessage(QUEUE, Number(pending.rows[0].msg_id))
    expect(await queueDepth()).toBe(0)
  })

  // Ledger ruling R3: a build before it queued `apiKey` in lcm / memory
  // payloads; the startup pass removes it from live rows (and archives), and
  // tolerates the queues this instance never created.
  it('stripApiKeysFromQueuedJobs removes a queued apiKey and keeps the rest', async () => {
    await readBatch(QUEUE, 0, 100).then((rows) =>
      Promise.all(rows.map((r) => deleteMessage(QUEUE, r.msgId)))
    )
    await enqueueJob(QUEUE, { chatId: 'c', apiKey: 'sk-queued-secret-9999' })

    await stripApiKeysFromQueuedJobs()

    const raw = await pglite.query<{ message: unknown }>(
      `SELECT message FROM pgmq."q_${QUEUE}"`
    )
    expect(JSON.stringify(raw.rows)).not.toContain('sk-queued-secret-9999')
    expect(raw.rows[0].message).toEqual({ chatId: 'c' })
  })
})
