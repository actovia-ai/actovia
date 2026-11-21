// src/main/lib/db/conversation-queries.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

const insertReturning = vi.fn()
const updateReturning = vi.fn()
// selectWhere is returned by .from().where() — used by getConversationById
const selectWhere = vi.fn()
const selectOrderBy = vi.fn()

vi.mock('@main/lib/db/db', () => ({
  db: {
    insert: () => ({ values: () => ({ returning: insertReturning }) }),
    update: () => ({
      set: () => ({ where: () => ({ returning: updateReturning }) })
    }),
    select: () => ({
      from: () => ({
        where: selectWhere,
        orderBy: selectOrderBy
      })
    })
  }
}))

const queries = await import('@main/lib/db/conversation-queries')

describe('conversation-queries', () => {
  beforeEach(() => vi.clearAllMocks())

  it('pages newest-first storage into chronological messages with an older cursor', async () => {
    const limit = vi.fn(async () => [{ id: 'm3' }, { id: 'm2' }, { id: 'm1' }])
    selectWhere.mockReturnValue({ orderBy: () => ({ limit }) })
    expect(
      await queries.getConversationMessagePage('c1', undefined, 2)
    ).toEqual({ messages: [{ id: 'm2' }, { id: 'm3' }], olderCursor: 'm2' })
    expect(limit).toHaveBeenCalledWith(3)
  })
  it('rejects a cursor outside the conversation and stops at the oldest page', async () => {
    selectWhere.mockResolvedValueOnce([])
    expect(await queries.getConversationMessagePage('c1', 'foreign')).toBeNull()
    selectWhere.mockResolvedValueOnce([{ id: 'm3' }])
    selectWhere.mockReturnValueOnce({
      orderBy: () => ({ limit: async () => [{ id: 'm2' }, { id: 'm1' }] })
    })
    expect(await queries.getConversationMessagePage('c1', 'm3', 2)).toEqual({
      messages: [{ id: 'm1' }, { id: 'm2' }],
      olderCursor: null
    })
  })
  it('createConversation returns the inserted row', async () => {
    insertReturning.mockResolvedValue([{ id: 'c1', title: 'Group' }])
    const row = await queries.createConversation({ title: 'Group' })
    expect(row).toEqual({ id: 'c1', title: 'Group' })
  })

  it('addMemberToConversation merges without duplicates', async () => {
    // getConversationById uses db.select().from().where() — mock selectWhere to
    // return current members; updateReturning returns merged members
    selectWhere.mockResolvedValue([{ id: 'c1', memberAgentIds: ['a1'] }])
    updateReturning.mockResolvedValue([
      { id: 'c1', memberAgentIds: ['a1', 'a2'] }
    ])
    const row = await queries.addMemberToConversation('c1', 'a2')
    expect(row.memberAgentIds).toContain('a2')
    expect(row.memberAgentIds.filter((m: string) => m === 'a1')).toHaveLength(1)
  })
})
