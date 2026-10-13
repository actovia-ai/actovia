import { randomUUID } from 'crypto'

import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

// Real SQL on an in-memory PGlite with every migration applied (the pattern
// of `jobs/queries.integration.test.ts`): what this proves is the chat-search
// statement itself — the CTEs, the window, the casts.
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
const { getChatsByTitle, getMessageHitsByIds, searchChats } =
  await import('@main/lib/db/queries')

afterAll(async () => {
  await pglite.close()
})

beforeEach(async () => {
  await db.delete(message)
  await db.delete(chat)
})

const at = (minute: number) => new Date(Date.UTC(2026, 9, 14, 0, minute))

async function addChat(title: string, createdAt = at(0)) {
  const id = randomUUID()
  await db.insert(chat).values({ id, title, createdAt })
  return id
}

async function addMessage(
  chatId: string,
  text: string,
  minute: number,
  role = 'assistant'
) {
  const id = randomUUID()
  await db.insert(message).values({
    id,
    chatId,
    runId: id,
    role,
    content: [{ type: 'text', text }],
    searchText: role === 'toolResult' ? null : text,
    createdAt: at(minute)
  })
  return id
}

describe('searchChats', () => {
  it('answers [] for an empty or blank query', async () => {
    await addChat('Anything')
    expect(await searchChats('')).toEqual([])
    expect(await searchChats('   ')).toEqual([])
  })

  it('answers one row per chat with its three newest matches as plain-text snippets', async () => {
    const id = await addChat('Trip planning')
    await addMessage(
      id,
      '## Duck\n\n**Peking duck**【1-source】 is roasted',
      1,
      'user'
    )
    const m2 = await addMessage(id, 'More duck facts', 2)
    const m3 = await addMessage(id, 'Duck sauce', 3, 'user')
    const m4 = await addMessage(id, 'The last DUCK', 4)
    await addMessage(id, 'Nothing here', 5)

    const [result, ...rest] = await searchChats('duck')

    expect(rest).toEqual([])
    expect(result).toEqual({
      chatId: id,
      title: 'Trip planning',
      matchedAt: at(4).toISOString(),
      snippets: [
        {
          messageId: m4,
          role: 'assistant',
          text: 'The last DUCK',
          createdAt: at(4).toISOString()
        },
        {
          messageId: m3,
          role: 'user',
          text: 'Duck sauce',
          createdAt: at(3).toISOString()
        },
        {
          messageId: m2,
          role: 'assistant',
          text: 'More duck facts',
          createdAt: at(2).toISOString()
        }
      ]
    })
  })

  it('requires every word, in any order, CJK included, and reads % and _ literally', async () => {
    const both = await addChat('A')
    await addMessage(both, '我想吃北京烤鸭和 100% 果汁', 1)
    const one = await addChat('B')
    await addMessage(one, '北京的天气', 2)

    expect((await searchChats('烤鸭 北京')).map((r) => r.chatId)).toEqual([
      both
    ])
    expect((await searchChats('100%')).map((r) => r.chatId)).toEqual([both])
    expect(await searchChats('1_0')).toEqual([])
  })

  it("matches titles too, dated by the chat's newest message, and orders chats newest match first", async () => {
    const titled = await addChat('Weekly duck review')
    await addMessage(titled, 'unrelated', 10)
    const older = await addChat('Other')
    await addMessage(older, 'a duck', 5)
    const newer = await addChat('Third')
    await addMessage(newer, 'duck again', 20)

    const results = await searchChats('duck')

    expect(results.map((r) => [r.chatId, r.matchedAt])).toEqual([
      [newer, at(20).toISOString()],
      [titled, at(10).toISOString()],
      [older, at(5).toISOString()]
    ])
    expect(results[1].snippets).toEqual([])
  })

  it('never searches tool results', async () => {
    const id = await addChat('Tools')
    await addMessage(id, 'duck', 1, 'toolResult')
    expect(await searchChats('duck')).toEqual([])
  })

  it('keeps 30 chats', async () => {
    for (let i = 0; i < 32; i++) {
      await addMessage(await addChat(`Chat ${i}`), 'duck', i)
    }
    const results = await searchChats('duck')
    expect(results).toHaveLength(30)
    expect(results[0].matchedAt).toBe(at(31).toISOString())
  })
})

describe('getMessageHitsByIds / getChatsByTitle', () => {
  it("reads the hits' titles in the same query and finds chats by title", async () => {
    const id = await addChat('Duck notes', at(1))
    const m = await addMessage(id, 'roast it', 7)

    const hits = await getMessageHitsByIds([m])
    expect(hits.messages).toEqual([
      expect.objectContaining({ id: m, chatId: id, searchText: 'roast it' })
    ])
    expect(hits.chats).toEqual([
      expect.objectContaining({ chatId: id, title: 'Duck notes' })
    ])

    expect(await getChatsByTitle(['duck'])).toEqual([
      { chatId: id, title: 'Duck notes', activityAt: at(7).toISOString() }
    ])
    expect(await getChatsByTitle(['goose'])).toEqual([])
  })
})
