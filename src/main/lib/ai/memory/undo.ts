import type { MemoryChange } from '@actovia/shared/types/memory'
import { isEqual } from 'lodash-es'

import {
  getMemoryById,
  hardDeleteMemory,
  restoreMemory,
  updateMemory
} from '../../db/memory-queries'
import { LOCAL_USER_ID, snapshotOf } from './manager'

/**
 * Reverses a run's memory changes, most recent first. A change is applied
 * only while the entry's current state still equals what the change left
 * behind (`snapshotOf(current) === after`, a missing row matching only
 * `after === null`) — an entry edited since (Settings, another chat) is
 * skipped and reported rather than overwritten. Running the same `changes`
 * through twice is a no-op the second time: everything is either already
 * reverted (so it now reads `before`, not `after`) or was skipped.
 */
export async function undoMemoryChanges(
  changes: MemoryChange[]
): Promise<{ undone: string[]; skipped: string[] }> {
  const undone: string[] = []
  const skipped: string[] = []

  for (const change of changes.toReversed()) {
    const row = await getMemoryById(change.id)
    const current = row ? snapshotOf(row) : null
    if (!isEqual(current, change.after)) {
      skipped.push(change.id)
      continue
    }

    if (change.op === 'create') {
      await hardDeleteMemory(change.id)
    } else if (change.op === 'update' && change.before) {
      await updateMemory(change.id, change.before)
    } else if (change.op === 'delete' && change.before) {
      await restoreMemory(change.id, LOCAL_USER_ID, change.before, 'explicit')
    }
    undone.push(change.id)
  }

  return { undone, skipped }
}
