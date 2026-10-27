import { randomUUID } from 'crypto'

import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

// ISSUE-237: the Artifacts page lists every artifact a chat made — read from
// the create_artifact tool results, newest first, with the chat and run it
// was made in so a click can open the chat there.
vi.mock('electron', () => ({ app: { getPath: () => '/tmp' } }))
vi.mock('@main/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}))
vi.mock('@main/lib/db/db', async () => {
  const { drizzle } = await import('drizzle-orm/pglite')
  const { createMigratedPglite } =
    await import('../../../helpers/migrated-pglite')
  const pglite = await createMigratedPglite('9999')
  return { pglite, db: drizzle(pglite) }
})

const { pglite, db } = await import('@main/lib/db/db')
const { chat, message } = await import('@main/lib/db/schema')
const { listAllArtifacts } = await import('@main/lib/db/queries')

afterAll(async () => {
  await pglite.close()
})

beforeEach(async () => {
  await db.delete(message)
  await db.delete(chat)
})

const at = (minute: number) => new Date(Date.UTC(2026, 9, 14, 0, minute))

async function addChat(title: string) {
  const id = randomUUID()
  await db.insert(chat).values({ id, title, createdAt: at(0) })
  return id
}

async function addResult(
  chatId: string,
  minute: number,
  details: Record<string, unknown> | null,
  { toolName = 'create_artifact', isError = false } = {}
) {
  const id = randomUUID()
  const runId = randomUUID()
  await db.insert(message).values({
    id,
    chatId,
    runId,
    role: 'toolResult',
    toolName,
    toolCallId: `call-${id}`,
    isError,
    content: [{ type: 'text', text: 'Created artifact' }],
    details,
    createdAt: at(minute)
  })
  return { id, runId, toolCallId: `call-${id}` }
}

describe('listAllArtifacts', () => {
  it('lists every chat’s artifacts, newest first, with the chat and run', async () => {
    const a = await addChat('Trip planning')
    const b = await addChat('Sales dashboard')
    const first = await addResult(a, 1, {
      type: 'artifact',
      artifactId: 'art-1',
      title: 'Kyoto itinerary',
      code: 'x'.repeat(5000)
    })
    const second = await addResult(b, 5, {
      type: 'artifact',
      artifactId: 'art-2',
      title: 'Q3 revenue'
    })

    const rows = await listAllArtifacts()
    expect(rows).toEqual([
      {
        artifactId: 'art-2',
        title: 'Q3 revenue',
        chatId: b,
        chatTitle: 'Sales dashboard',
        runId: second.runId,
        toolCallId: second.toolCallId,
        createdAt: at(5).toISOString()
      },
      {
        artifactId: 'art-1',
        title: 'Kyoto itinerary',
        chatId: a,
        chatTitle: 'Trip planning',
        runId: first.runId,
        toolCallId: first.toolCallId,
        createdAt: at(1).toISOString()
      }
    ])
    expect(JSON.stringify(rows)).not.toContain('xxxx')
  })

  it('leaves out failed calls, other tools and results without an artifact', async () => {
    const a = await addChat('Mixed')
    await addResult(
      a,
      1,
      { artifactId: 'bad', title: 'Broken' },
      { isError: true }
    )
    await addResult(a, 2, { results: [] }, { toolName: 'web_search' })
    await addResult(a, 3, null)
    expect(await listAllArtifacts()).toEqual([])
  })
})
