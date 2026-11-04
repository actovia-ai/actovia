import { drizzle } from 'drizzle-orm/pglite'
import { describe, expect, it, vi } from 'vitest'

import { createMigratedPglite } from '../../../helpers/migrated-pglite'

const pglite = await createMigratedPglite('0022')
const db = drizzle(pglite)
vi.mock('@main/lib/db/db', () => ({ db, pglite }))

const { createConversation } = await import('@main/lib/db/conversation-queries')
const { getPlansForDashboard } = await import('@main/lib/db/plan-queries')
const { conversationPlan, planStep } = await import('@main/lib/db/schema')

describe('getPlansForDashboard', () => {
  it('includes active plans, recent history, and ordered steps but omits archived and stale history', async () => {
    const activeGroup = await createConversation({ title: 'Active group' })
    const draftingGroup = await createConversation({ title: 'Drafting group' })
    const recentGroup = await createConversation({ title: 'Recent group' })
    const staleGroup = await createConversation({ title: 'Stale group' })
    const archivedGroup = await createConversation({ title: 'Archived group' })
    const now = new Date()
    const eightDaysAgo = new Date(now.getTime() - 8 * 24 * 60 * 60 * 1000)
    const twoDaysAgo = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000)
    const plans = await db
      .insert(conversationPlan)
      .values([
        {
          conversationId: activeGroup.id,
          summary: 'Active plan',
          status: 'active',
          updatedAt: eightDaysAgo
        },
        {
          conversationId: draftingGroup.id,
          summary: 'Drafting plan',
          status: 'drafting',
          updatedAt: eightDaysAgo
        },
        {
          conversationId: recentGroup.id,
          summary: 'Recent plan',
          status: 'completed',
          updatedAt: twoDaysAgo
        },
        {
          conversationId: staleGroup.id,
          summary: 'Stale plan',
          status: 'completed',
          updatedAt: eightDaysAgo
        },
        {
          conversationId: archivedGroup.id,
          summary: 'Archived plan',
          status: 'active',
          archivedAt: now,
          updatedAt: now
        }
      ])
      .returning()
    const activePlan = plans.find((plan) => plan.summary === 'Active plan')
    if (!activePlan) throw new Error('Active plan was not inserted')
    await db.insert(planStep).values([
      {
        planId: activePlan.id,
        ordinal: 1,
        title: 'Second step'
      },
      {
        planId: activePlan.id,
        ordinal: 0,
        title: 'First step'
      }
    ])

    const results = await getPlansForDashboard()

    expect(results.map(({ plan }) => plan.summary).toSorted()).toEqual(
      ['Active plan', 'Drafting plan', 'Recent plan'].toSorted()
    )
    expect(
      results
        .find(({ plan }) => plan.summary === 'Active plan')
        ?.steps.map((step) => step.title)
    ).toEqual(['First step', 'Second step'])
  })
})
