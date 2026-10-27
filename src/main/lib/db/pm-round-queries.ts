import type { PmRoundEventKind } from '@actovia/shared/types/pm-round'
import { and, asc, desc, eq } from 'drizzle-orm'

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
