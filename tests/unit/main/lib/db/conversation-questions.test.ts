import { drizzle } from 'drizzle-orm/pglite'
import { describe, expect, it, vi } from 'vitest'

import { createMigratedPglite } from '../../../helpers/migrated-pglite'

const pglite = await createMigratedPglite('0022')
const db = drizzle(pglite)
vi.mock('@main/lib/db/db', () => ({ db, pglite }))

const {
  createConversation,
  createConversationMessage,
  getQuestionMessage,
  settleQuestionMessage
} = await import('@main/lib/db/conversation-queries')

async function ask(conversationId: string, questionId: string) {
  return createConversationMessage({
    conversationId,
    role: 'pm',
    content: 'Which branch?',
    parts: [
      { kind: 'decision', delegations: 0, waits: 0 },
      {
        kind: 'question',
        questionId,
        options: ['main', 'dev'],
        status: 'pending'
      }
    ]
  })
}

describe('saved PM questions', () => {
  it('finds a question by its id, only in its own group', async () => {
    const group = await createConversation({ title: 'Q1' })
    const other = await createConversation({ title: 'Q2' })
    const row = await ask(group.id, 'q-1')
    expect((await getQuestionMessage(group.id, 'q-1'))?.id).toBe(row.id)
    expect(await getQuestionMessage(other.id, 'q-1')).toBeUndefined()
    expect(await getQuestionMessage(group.id, 'q-x')).toBeUndefined()
  })

  it('settles a pending question once, keeping its other parts in order', async () => {
    const group = await createConversation({ title: 'Q3' })
    await ask(group.id, 'q-2')
    const settled = await settleQuestionMessage(group.id, 'q-2', 'answered')
    expect(settled?.parts).toEqual([
      { kind: 'decision', delegations: 0, waits: 0 },
      {
        kind: 'question',
        questionId: 'q-2',
        options: ['main', 'dev'],
        status: 'answered'
      }
    ])
    // The second answer (another client, or the timeout) finds it settled.
    expect(await settleQuestionMessage(group.id, 'q-2', 'expired')).toBeNull()
    const stored = await getQuestionMessage(group.id, 'q-2')
    expect(stored?.parts?.[1]).toMatchObject({ status: 'answered' })
  })

  it('never settles another group’s question', async () => {
    const group = await createConversation({ title: 'Q4' })
    const other = await createConversation({ title: 'Q5' })
    await ask(group.id, 'q-3')
    expect(await settleQuestionMessage(other.id, 'q-3', 'answered')).toBeNull()
  })
})
