import type { LockConfig } from '@exodus/shared/types/lock'
import { LOCK_CHANNELS } from '@exodus/shared/types/lock'
import { ipcMain, safeStorage, systemPreferences } from 'electron'

import { logger } from '../logger'
import { getMainWindow } from '../window'
import type { IdleWatcher } from './idle-watcher'
import { getLockManager } from './lock-manager'
import { getRecentNotifications } from './lock-notifications'

function touchIdAvailable(): boolean {
  return (
    process.platform === 'darwin' &&
    typeof systemPreferences.canPromptTouchID === 'function' &&
    systemPreferences.canPromptTouchID()
  )
}

export function setupLockIPC(): void {
  const manager = getLockManager()

  manager.removeAllListeners('state-changed')
  manager.removeAllListeners('config-changed')

  manager.on('state-changed', () => {
    getMainWindow()?.webContents.send(LOCK_CHANNELS.stateChanged)
  })
  manager.on('config-changed', () => {
    getMainWindow()?.webContents.send(LOCK_CHANNELS.stateChanged)
  })

  ipcMain.handle(LOCK_CHANNELS.getStatus, () =>
    manager.getStatus(touchIdAvailable())
  )

  ipcMain.handle(LOCK_CHANNELS.unlock, (_e, pin: string) => manager.unlock(pin))

  ipcMain.handle(LOCK_CHANNELS.unlockTouchId, async () => {
    if (!touchIdAvailable()) return { ok: false }
    try {
      await systemPreferences.promptTouchID('Unlock Actovia')
      manager.completeUnlock()
      return { ok: true }
    } catch (err) {
      logger.info('app', 'Touch ID unlock cancelled/failed', {
        error: err
      })
      return { ok: false }
    }
  })

  ipcMain.handle(LOCK_CHANNELS.lockNow, () => {
    manager.lock('manual')
  })

  ipcMain.handle(LOCK_CHANNELS.setPin, (_e, pin: string) => {
    const ok = manager.setPin(pin)
    return { ok, status: manager.getStatus(touchIdAvailable()) }
  })

  ipcMain.handle(
    LOCK_CHANNELS.changePin,
    (_e, oldPin: string, newPin: string) => manager.changePin(oldPin, newPin)
  )

  ipcMain.handle(LOCK_CHANNELS.disable, (_e, pin: string) =>
    manager.disable(pin)
  )

  ipcMain.handle(LOCK_CHANNELS.setConfig, (_e, patch: Partial<LockConfig>) => {
    if (patch.touchIdEnabled && !touchIdAvailable())
      patch.touchIdEnabled = false
    return manager.setConfig(patch)
  })

  ipcMain.handle(LOCK_CHANNELS.pingActivity, () => {
    getLockIdleWatcher()?.recordActivity()
  })

  ipcMain.handle(LOCK_CHANNELS.getRecentNotifications, () =>
    getRecentNotifications()
  )

  logger.info('app', 'Lock IPC ready', {
    safeStorage: safeStorage.isEncryptionAvailable(),
    touchId: touchIdAvailable()
  })
}

let idleWatcher: IdleWatcher | null = null
export function setLockIdleWatcher(w: IdleWatcher): void {
  idleWatcher = w
}
function getLockIdleWatcher(): IdleWatcher | null {
  return idleWatcher
}
