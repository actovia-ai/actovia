import { drizzle } from 'drizzle-orm/pglite'
import { describe, expect, it, vi } from 'vitest'

import { createMigratedPglite } from '../../../helpers/migrated-pglite'

const pglite = await createMigratedPglite('0020')
const db = drizzle(pglite)
vi.mock('@main/lib/db/db', () => ({ db, pglite }))

const {
  createConversation,
  createConversationMessage,
  getLatestMessagePerConversation,
  updateConversationTitleIfUnchanged
} = await import('@main/lib/db/conversation-queries')

describe('getLatestMessagePerConversation', () => {
  it('gives each conversation its newest message, stamped as a Date of the true instant', async () => {
    const group = await createConversation({ title: 'Group' })
    await createConversationMessage({
      conversationId: group.id,
      role: 'user',
      content: 'first'
    })
    await new Promise((r) => setTimeout(r, 5))
    await createConversationMessage({
      conversationId: group.id,
      role: 'pm',
      content: 'second'
    })

    const latest = await getLatestMessagePerConversation()
    expect(latest).toHaveLength(1)
    expect(latest[0]).toMatchObject({
      conversationId: group.id,
      role: 'pm',
      content: 'second'
    })
    expect(latest[0].createdAt).toBeInstanceOf(Date)
    expect(Math.abs(latest[0].createdAt.getTime() - Date.now())).toBeLessThan(
      2000
    )
  })
})

describe('updateConversationTitleIfUnchanged', () => {
  it('updates only while the Group still has the expected default title', async () => {
    const group = await createConversation({ title: 'New group' })
    const updated = await updateConversationTitleIfUnchanged(
      group.id,
      'New group',
      'Build a report'
    )
    expect(updated?.title).toBe('Build a report')
    expect(
      await updateConversationTitleIfUnchanged(
        group.id,
        'New group',
        'A stale generated title'
      )
    ).toBeUndefined()
  })

  it('does not overwrite a title changed by the user during generation', async () => {
    const group = await createConversation({ title: 'New group' })
    const { updateConversation } =
      await import('@main/lib/db/conversation-queries')
    await updateConversation(group.id, { title: 'User title' })

    expect(
      await updateConversationTitleIfUnchanged(
        group.id,
        'New group',
        'Generated title'
      )
    ).toBeUndefined()
  })
})
