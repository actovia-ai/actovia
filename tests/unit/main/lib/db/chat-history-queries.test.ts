// The chat list a page at a time (`getChatsPage`, `getFavoriteChats`) on a
// real, in-memory PGlite with the shipped migrations.
import { afterAll, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getPath: () => '/tmp' } }))
vi.mock('@main/lib/db/db', async () => {
  const { drizzle } = await import('drizzle-orm/pglite')
  const { createMigratedPglite } =
    await import('../../../helpers/migrated-pglite')
  const pglite = await createMigratedPglite('9999')
  return { pglite, db: drizzle(pglite) }
})

const { pglite } = await import('@main/lib/db/db')
const { getChatsPage, getFavoriteChats } = await import('@main/lib/db/queries')
const { parseChatHistoryCursor } =
  await import('@actovia/shared/utils/chat-history-cursor')

afterAll(async () => {
  await pglite.close()
})

const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

async function insert(n: number, createdAt: string, favorite = false) {
  await pglite.query(
    `INSERT INTO "chat" ("id","title","createdAt","favorite") VALUES ($1,$2,$3::timestamp,$4)`,
    [id(n), `chat ${n}`, createdAt, favorite]
  )
}

async function walk(limit: number): Promise<string[]> {
  const seen: string[] = []
  let before: { createdAt: Date; id: string } | undefined
  for (let i = 0; i < 20; i++) {
    const page = await getChatsPage({ limit, before })
    seen.push(...page.chats.map((c) => c.id))
    if (!page.olderCursor) return seen
    before = parseChatHistoryCursor(page.olderCursor) ?? undefined
  }
  throw new Error('did not end')
}

describe('getChatsPage', () => {
  it('pages newest first, breaking a tie on createdAt by id, each row once', async () => {
    await insert(1, '2026-10-01 10:00:00')
    // Three chats in the same microsecond, and two in the same millisecond
    // but different microseconds — what `defaultNow()` writes.
    await insert(2, '2026-10-02 10:00:00', true)
    await insert(3, '2026-10-02 10:00:00')
    await insert(4, '2026-10-02 10:00:00')
    await insert(5, '2026-10-03 10:00:00.123900')
    await insert(6, '2026-10-03 10:00:00.123100', true)
    await insert(7, '2026-10-04 10:00:00')

    const expected = [7, 6, 5, 4, 3, 2, 1].map((n) => id(n))
    for (const limit of [1, 2, 3, 7, 100]) {
      expect(await walk(limit)).toEqual(expected)
    }
  })

  it('answers no cursor on the last page', async () => {
    const page = await getChatsPage({ limit: 7 })
    expect(page.chats).toHaveLength(7)
    expect(page.olderCursor).toBeNull()
  })

  it('names the last row in the cursor when more exist', async () => {
    const page = await getChatsPage({ limit: 2 })
    expect(page.olderCursor).toBe(`2026-10-03T10:00:00.123Z|${id(6)}`)
  })
})

describe('getFavoriteChats', () => {
  it('answers every favourite, newest first', async () => {
    expect((await getFavoriteChats()).map((c) => c.id)).toEqual([id(6), id(2)])
  })
})
