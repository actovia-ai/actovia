import {
  CONTEXT_PART_KEYS,
  type ContextPartKey
} from '@actovia/shared/types/chat-context'
import type { PmContextSnapshot } from '@actovia/shared/types/philharmonic'
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

function isContextPartKey(value: unknown): value is ContextPartKey {
  return (
    typeof value === 'string' &&
    CONTEXT_PART_KEYS.includes(value as ContextPartKey)
  )
}

function isPmContextSnapshot(value: unknown): value is PmContextSnapshot {
  if (!value || typeof value !== 'object') return false
  const snapshot = value as Record<string, unknown>
  return (
    typeof snapshot.takenAt === 'string' &&
    typeof snapshot.roundId === 'string' &&
    typeof snapshot.model === 'string' &&
    typeof snapshot.contextWindow === 'number' &&
    (typeof snapshot.compactAt === 'number' || snapshot.compactAt === null) &&
    (typeof snapshot.lcmTokens === 'number' || snapshot.lcmTokens === null) &&
    typeof snapshot.total === 'number' &&
    typeof snapshot.estimated === 'boolean' &&
    Array.isArray(snapshot.parts) &&
    snapshot.parts.length === CONTEXT_PART_KEYS.length &&
    snapshot.parts.every((part) => isContextPart(part))
  )
}

function isContextPart(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false
  const part = value as Record<string, unknown>
  return isContextPartKey(part.key) && typeof part.tokens === 'number'
}

export async function getLatestPmContextSnapshot(
  conversationId: string
): Promise<PmContextSnapshot | null> {
  const [event] = await db
    .select({ payload: pmRoundEvent.payload })
    .from(pmRoundEvent)
    .where(
      and(
        eq(pmRoundEvent.conversationId, conversationId),
        eq(pmRoundEvent.kind, 'context')
      )
    )
    .orderBy(desc(pmRoundEvent.createdAt))
    .limit(1)
  return isPmContextSnapshot(event?.payload) ? event.payload : null
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
