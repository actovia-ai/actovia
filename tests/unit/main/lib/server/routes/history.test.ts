// src/main/lib/server/routes/history.ts — the chat list, whole or a page at a time.
import { isAppError } from '@actovia/shared/errors/app-error'
import {
  chatHistoryCursor,
  parseChatHistoryCursor
} from '@actovia/shared/utils/chat-history-cursor'
import { Hono } from 'hono'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getPath: () => '/tmp' } }))
vi.mock('@main/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}))

interface Row {
  id: string
  title: string
  createdAt: Date
  favorite: boolean
}

const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

// Five chats, newest first; 3 and 4 share a createdAt (the tie goes by id).
const ROWS: Row[] = [
  [5, '2026-10-05T00:00:00.000Z', false],
  [4, '2026-10-04T00:00:00.000Z', true],
  [3, '2026-10-04T00:00:00.000Z', false],
  [2, '2026-10-02T00:00:00.000Z', true],
  [1, '2026-10-01T00:00:00.000Z', false]
].map(([n, at, favorite]) => ({
  id: id(n as number),
  title: `chat ${n}`,
  createdAt: new Date(at as string),
  favorite: favorite as boolean
}))

const queries = vi.hoisted(() => ({
  getAllChats: vi.fn(),
  getChatsPage: vi.fn(),
  getFavoriteChats: vi.fn()
}))
vi.mock('@main/lib/db/queries', () => queries)

beforeEach(() => {
  vi.clearAllMocks()
  queries.getAllChats.mockResolvedValue(ROWS)
  queries.getFavoriteChats.mockResolvedValue(ROWS.filter((r) => r.favorite))
  // The SQL's semantics over ROWS: strictly older than the cursor's pair.
  queries.getChatsPage.mockImplementation(
    ({
      limit,
      before
    }: {
      limit: number
      before?: { createdAt: Date; id: string }
    }) => {
      const older = ROWS.filter(
        (r) =>
          !before ||
          r.createdAt < before.createdAt ||
          (r.createdAt.getTime() === before.createdAt.getTime() &&
            r.id < before.id)
      )
      const chats = older.slice(0, limit)
      return Promise.resolve({
        chats,
        olderCursor:
          older.length > limit ? chatHistoryCursor(chats.at(-1)!) : null
      })
    }
  )
})

async function get(query = '') {
  const { default: historyRouter } =
    await import('@main/lib/server/routes/history')
  const app = new Hono()
  app.route('/api/v1/history', historyRouter)
  app.onError((err, c) => {
    if (isAppError(err)) return c.json(err.toJSON(), err.statusCode as never)
    return c.json({ message: err.message }, 500)
  })
  return app.request(`/api/v1/history${query}`)
}

describe('GET /api/v1/history', () => {
  it('answers the whole list as an array without `limit`', async () => {
    const res = await get()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(Array.isArray(body)).toBe(true)
    expect(body.map((c: Row) => c.id)).toEqual(ROWS.map((r) => r.id))
    expect(queries.getChatsPage).not.toHaveBeenCalled()
  })

  it('answers the first page with a cursor and the favourites', async () => {
    const res = await get('?limit=2')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.chats.map((c: Row) => c.id)).toEqual([id(5), id(4)])
    expect(body.olderCursor).toBe(`2026-10-04T00:00:00.000Z|${id(4)}`)
    expect(body.favorites.map((c: Row) => c.id)).toEqual([id(4), id(2)])
    expect(queries.getChatsPage).toHaveBeenCalledWith({
      limit: 2,
      before: undefined
    })
  })

  it('walks every chat once, in order, until the cursor is null; later pages carry no favourites', async () => {
    const seen: string[] = []
    let res = await get('?limit=2')
    let body = await res.json()
    seen.push(...body.chats.map((c: Row) => c.id))
    let pages = 1
    while (body.olderCursor) {
      res = await get(`?limit=2&before=${encodeURIComponent(body.olderCursor)}`)
      expect(res.status).toBe(200)
      body = await res.json()
      expect(body).not.toHaveProperty('favorites')
      seen.push(...body.chats.map((c: Row) => c.id))
      pages++
    }
    expect(pages).toBe(3)
    expect(seen).toEqual(ROWS.map((r) => r.id))
  })

  it('passes the cursor on as its pair', async () => {
    const cursor = `2026-10-04T00:00:00.000Z|${id(4)}`
    await get(`?limit=2&before=${encodeURIComponent(cursor)}`)
    expect(queries.getChatsPage).toHaveBeenCalledWith({
      limit: 2,
      before: parseChatHistoryCursor(cursor)
    })
    expect(queries.getFavoriteChats).not.toHaveBeenCalled()
  })

  it.each(['0', '101', 'abc', '2.5', ''])(
    'rejects limit=%j with 400',
    async (limit) => {
      const res = await get(`?limit=${limit}`)
      expect(res.status).toBe(400)
      expect((await res.json()).error.code).toBe('VALIDATION_FAILED')
      expect(queries.getChatsPage).not.toHaveBeenCalled()
    }
  )

  it.each([
    'nope',
    `not-a-date|${id(1)}`,
    '2026-10-04T00:00:00.000Z|',
    '2026-10-04T00:00:00.000Z|not-a-uuid'
  ])('rejects before=%j with 400', async (before) => {
    const res = await get(`?limit=2&before=${encodeURIComponent(before)}`)
    expect(res.status).toBe(400)
    expect((await res.json()).error.code).toBe('VALIDATION_FAILED')
    expect(queries.getChatsPage).not.toHaveBeenCalled()
  })
})
