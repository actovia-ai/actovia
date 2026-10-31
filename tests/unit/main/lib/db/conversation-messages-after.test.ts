import { drizzle } from 'drizzle-orm/pglite'
import { describe, expect, it, vi } from 'vitest'

import { createMigratedPglite } from '../../../helpers/migrated-pglite'

const pglite = await createMigratedPglite('0020')
const db = drizzle(pglite)
vi.mock('@main/lib/db/db', () => ({ db, pglite }))

const {
  createConversation,
  createConversationMessage,
  getMessagesAfter,
  getMessagesByConversationId
} = await import('@main/lib/db/conversation-queries')
const { conversationMessage } = await import('@main/lib/db/schema')

async function row(conversationId: string, content: string, at: Date) {
  const [r] = await db
    .insert(conversationMessage)
    .values({ conversationId, role: 'pm', content, createdAt: at })
    .returning()
  return r
}

describe('getMessagesAfter', () => {
  it('returns the rows after the anchor, in order', async () => {
    const group = await createConversation({ title: 'A' })
    const first = await row(group.id, 'first', new Date(1_000))
    const second = await row(group.id, 'second', new Date(2_000))
    const third = await row(group.id, 'third', new Date(3_000))
    const after = await getMessagesAfter(group.id, first.id)
    expect(after?.map((m) => m.id)).toEqual([second.id, third.id])
    expect(await getMessagesAfter(group.id, third.id)).toEqual([])
  })

  it('orders two rows of one timestamp by id, and returns the other one after either', async () => {
    const group = await createConversation({ title: 'B' })
    const at = new Date(5_000)
    const a = await row(group.id, 'a', at)
    const b = await row(group.id, 'b', at)
    const [lo, hi] = [a, b].sort((x, y) => (x.id < y.id ? -1 : 1))
    const all = await getMessagesByConversationId(group.id)
    expect(all.map((m) => m.id)).toEqual([lo.id, hi.id])
    expect((await getMessagesAfter(group.id, lo.id))?.map((m) => m.id)).toEqual(
      [hi.id]
    )
    expect(await getMessagesAfter(group.id, hi.id)).toEqual([])
  })

  it('is null for an anchor that is not a row of the conversation', async () => {
    const one = await createConversation({ title: 'C' })
    const other = await createConversation({ title: 'D' })
    const foreign = await row(other.id, 'x', new Date(1_000))
    expect(await getMessagesAfter(one.id, foreign.id)).toBeNull()
  })

  it('never returns the anchor itself for rows stamped by the database clock (microseconds)', async () => {
    const group = await createConversation({ title: 'E' })
    for (const content of ['one', 'two', 'three']) {
      await createConversationMessage({
        conversationId: group.id,
        role: 'pm',
        content
      })
    }
    // The database clock may tie; its UUID tiebreaker, not insertion order,
    // defines the cursor order. Keep microseconds in SQL instead of sorting
    // the returned JS Dates (which only preserve milliseconds).
    const rows = await getMessagesByConversationId(group.id)
    for (let i = 0; i < rows.length; i++) {
      const after = await getMessagesAfter(group.id, rows[i].id)
      expect(after?.map((m) => m.content)).toEqual(
        rows.slice(i + 1).map((m) => m.content)
      )
    }
  })
})
