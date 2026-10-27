import type { PmRoundEventKind } from '@actovia/shared/types/pm-round'
import { and, asc, desc, eq, gte } from 'drizzle-orm'

import { db } from './db'
import { pmRoundEvent } from './schema'

export async function appendRoundEvent(e: {
  conversationId: string
  roundId: string
  seq: number
  kind: PmRoundEventKind
  payload: Record<string, unknown>
}) {
  await db.insert(pmRoundEvent).values(e)
}

export function listRoundEvents(conversationId: string, roundId: string) {
  return db
    .select()
    .from(pmRoundEvent)
    .where(
      and(
        eq(pmRoundEvent.conversationId, conversationId),
        eq(pmRoundEvent.roundId, roundId)
      )
    )
    .orderBy(asc(pmRoundEvent.seq))
}

/** When this group's newest round began — the reports a round "read" are the ones after it. */
export async function lastRoundStartedAt(
  conversationId: string
): Promise<Date | null> {
  const [row] = await db
    .select({ at: pmRoundEvent.createdAt })
    .from(pmRoundEvent)
    .where(
      and(
        eq(pmRoundEvent.conversationId, conversationId),
        eq(pmRoundEvent.kind, 'input')
      )
    )
    .orderBy(desc(pmRoundEvent.createdAt))
    .limit(1)
  return row?.at ?? null
}

const num = (v: unknown) => (typeof v === 'number' ? v : 0)

/**
 * The PM's rounds for the Costs page (ISSUE-132): one `usage` event per round,
 * its tokens counted with the cache, as an employee's are.
 */
export async function getPmCostRows(since?: Date) {
  const rows = await db
    .select({
      conversationId: pmRoundEvent.conversationId,
      payload: pmRoundEvent.payload,
      createdAt: pmRoundEvent.createdAt
    })
    .from(pmRoundEvent)
    .where(
      and(
        eq(pmRoundEvent.kind, 'usage'),
        since ? gte(pmRoundEvent.createdAt, since) : undefined
      )
    )
  return rows.map(({ conversationId, payload, createdAt }) => ({
    conversationId,
    tokens:
      num(payload.inputTokens) +
      num(payload.outputTokens) +
      num(payload.cacheReadTokens) +
      num(payload.cacheWriteTokens),
    cost: num(payload.costUsd),
    createdAt
  }))
}
