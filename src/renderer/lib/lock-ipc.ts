import {
  LOCK_CHANNELS,
  type LockConfig,
  type LockNotification,
  type LockStatus,
  type UnlockResult
} from '@actovia/shared/types/lock'
import type { IpcRendererEvent } from 'electron'

const ipc = () => window.electron.ipcRenderer

export const getLockStatus = (): Promise<LockStatus> =>
  ipc().invoke(LOCK_CHANNELS.getStatus)
export const unlockWithPin = (pin: string): Promise<UnlockResult> =>
  ipc().invoke(LOCK_CHANNELS.unlock, pin)
export const unlockWithTouchId = (): Promise<{ ok: boolean }> =>
  ipc().invoke(LOCK_CHANNELS.unlockTouchId)
export const lockNow = (): Promise<void> => ipc().invoke(LOCK_CHANNELS.lockNow)
export const setLockPin = (
  pin: string
): Promise<{ ok: boolean; status: LockStatus }> =>
  ipc().invoke(LOCK_CHANNELS.setPin, pin)
export const changeLockPin = (
  oldPin: string,
  newPin: string
): Promise<boolean> => ipc().invoke(LOCK_CHANNELS.changePin, oldPin, newPin)
export const disableLock = (pin: string): Promise<boolean> =>
  ipc().invoke(LOCK_CHANNELS.disable, pin)
export const setLockConfig = (
  patch: Partial<LockConfig>
): Promise<LockConfig> => ipc().invoke(LOCK_CHANNELS.setConfig, patch)
export const pingActivity = (): Promise<void> =>
  ipc().invoke(LOCK_CHANNELS.pingActivity)
export const getRecentLockNotifications = (): Promise<LockNotification[]> =>
  ipc().invoke(LOCK_CHANNELS.getRecentNotifications)

export function onLockStateChanged(cb: () => void): () => void {
  const handler = () => cb()
  ipc().on(LOCK_CHANNELS.stateChanged, handler)
  return () => ipc().removeListener(LOCK_CHANNELS.stateChanged, handler)
}

export function onLockNotification(
  cb: (n: LockNotification) => void
): () => void {
  const handler = (_: IpcRendererEvent, n: LockNotification) => cb(n)
  ipc().on(LOCK_CHANNELS.notification, handler)
  return () => ipc().removeListener(LOCK_CHANNELS.notification, handler)
}
