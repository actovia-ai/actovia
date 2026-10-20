import type { LockNotification } from '@actovia/shared/types/lock'
import { LOCK_CHANNELS } from '@actovia/shared/types/lock'
import { v4 as uuidV4 } from 'uuid'

import { notifyIfBackground } from '../philharmonic-notifications'
import { getMainWindow } from '../window'

const MAX = 20
const recent: LockNotification[] = []

export function getRecentNotifications(): LockNotification[] {
  return [...recent]
}

/**
 * Fire a notification that should appear on the lock screen feed AND as an OS
 * notification when the app is backgrounded/locked.
 */
export function pushLockNotification(title: string, body: string): void {
  const event: LockNotification = {
    id: uuidV4(),
    title,
    body,
    timestamp: Date.now()
  }
  recent.unshift(event)
  if (recent.length > MAX) recent.pop()

  getMainWindow()?.webContents.send(LOCK_CHANNELS.notification, event)
  notifyIfBackground({ title, body })
}
