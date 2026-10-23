import type { ConversationMessageData } from '@/stores/philharmonic'

/**
 * A group's saved rows with the ones read `?after=` its last row added at
 * the end. Two re-reads can ask after the same row when two messages end
 * close together, so a row already held is not added twice.
 */
export function appendRows(
  history: ConversationMessageData[],
  rows: ConversationMessageData[]
): ConversationMessageData[] {
  const held = new Set(history.map((m) => m.id))
  const fresh = rows.filter((m) => !held.has(m.id))
  return fresh.length ? [...history, ...fresh] : history
}
