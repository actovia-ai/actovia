import { drizzle } from 'drizzle-orm/pglite'
import { describe, expect, it, vi } from 'vitest'

import { createMigratedPglite } from '../../../helpers/migrated-pglite'

const pglite = await createMigratedPglite('0020')
const db = drizzle(pglite)
vi.mock('@main/lib/db/db', () => ({ db, pglite }))

const { agent } = await import('@main/lib/db/schema')
const { createConversation, createConversationMessage, getEmployeeReports } =
  await import('@main/lib/db/conversation-queries')

describe('getEmployeeReports', () => {
  it("gives an employee's own non-empty reports in that group, newest first", async () => {
    const [nora] = await db.insert(agent).values({ name: 'Nora' }).returning()
    const [kai] = await db.insert(agent).values({ name: 'Kai' }).returning()
    const group = await createConversation({ title: 'Group' })
    const other = await createConversation({ title: 'Other' })
    const add = async (
      conversationId: string,
      role: 'employee' | 'pm',
      agentId: string | null,
      content: string
    ) => {
      await createConversationMessage({
        conversationId,
        role,
        agentId,
        content
      })
      await new Promise((r) => setTimeout(r, 3))
    }
    await add(group.id, 'employee', nora.id, 'one')
    await add(group.id, 'employee', kai.id, 'kai')
    await add(group.id, 'pm', null, 'pm')
    await add(group.id, 'employee', nora.id, '')
    await add(other.id, 'employee', nora.id, 'elsewhere')
    await add(group.id, 'employee', nora.id, 'two')
    await add(group.id, 'employee', nora.id, 'three')

    const reports = await getEmployeeReports(group.id, nora.id, 2)
    expect(reports.map((r) => r.content)).toEqual(['three', 'two'])
    expect(reports[0].createdAt).toBeInstanceOf(Date)
  })
})
