import { EventEmitter } from 'events'

import type {
  LockConfig,
  LockStatus,
  UnlockResult
} from '@actovia/shared/types/lock'

import { logger } from '../logger'
import { readConfig, writeConfig } from './lock-config'
import * as pinStore from './pin-store'

const MAX_FREE_ATTEMPTS = 5
const LOCKOUT_MS = 30_000

export type LockReason = 'manual' | 'idle' | 'launch' | 'system-sleep'

export class LockManager extends EventEmitter {
  private locked = false
  private wrongAttempts = 0
  private lockedOutUntil = 0
  private now: () => number

  constructor(now: () => number = Date.now) {
    super()
    this.now = now
  }

  isLocked(): boolean {
    return this.locked
  }

  private retryAfterMs(): number {
    const remaining = this.lockedOutUntil - this.now()
    return remaining > 0 ? remaining : 0
  }

  getStatus(touchIdAvailable: boolean): LockStatus {
    return {
      hasPin: pinStore.hasPin(),
      locked: this.locked,
      config: readConfig(),
      retryAfterMs: this.retryAfterMs(),
      touchIdAvailable
    }
  }

  lock(reason: LockReason): void {
    if (this.locked) return
    if (!pinStore.hasPin()) return
    this.locked = true
    logger.info('app', 'App locked', { reason })
    this.emit('state-changed')
  }

  /** Record a failed PIN attempt; trips the lockout window after MAX_FREE_ATTEMPTS. */
  private recordWrongAttempt(): void {
    this.wrongAttempts++
    if (this.wrongAttempts >= MAX_FREE_ATTEMPTS) {
      this.lockedOutUntil = this.now() + LOCKOUT_MS
      this.wrongAttempts = 0
    }
  }

  private resetAttempts(): void {
    this.wrongAttempts = 0
    this.lockedOutUntil = 0
  }

  unlock(pin: string): UnlockResult {
    if (!pinStore.hasPin())
      return { ok: false, reason: 'no-pin', retryAfterMs: 0 }
    if (this.retryAfterMs() > 0) {
      return {
        ok: false,
        reason: 'locked-out',
        retryAfterMs: this.retryAfterMs()
      }
    }
    if (!pinStore.verify(pin)) {
      this.recordWrongAttempt()
      const retry = this.retryAfterMs()
      return retry > 0
        ? { ok: false, reason: 'locked-out', retryAfterMs: retry }
        : { ok: false, reason: 'wrong-pin', retryAfterMs: 0 }
    }
    this.completeUnlock()
    return { ok: true }
  }

  completeUnlock(): void {
    this.locked = false
    this.wrongAttempts = 0
    this.lockedOutUntil = 0
    logger.info('app', 'App unlocked')
    this.emit('state-changed')
  }

  /**
   * Enrollment only. Refuses if a PIN already exists (rotation must use
   * changePin, which authenticates the old PIN) or if the app is locked.
   * Returns true if the PIN was set.
   */
  setPin(pin: string): boolean {
    if (pinStore.hasPin()) return false
    if (this.locked) return false
    pinStore.setPin(pin)
    this.emit('state-changed')
    return true
  }

  changePin(oldPin: string, newPin: string): boolean {
    if (this.retryAfterMs() > 0) return false
    if (!pinStore.verify(oldPin)) {
      this.recordWrongAttempt()
      return false
    }
    this.resetAttempts()
    pinStore.setPin(newPin)
    return true
  }

  disable(pin: string): boolean {
    if (this.retryAfterMs() > 0) return false
    if (pinStore.hasPin() && !pinStore.verify(pin)) {
      this.recordWrongAttempt()
      return false
    }
    this.resetAttempts()
    pinStore.clear()
    this.locked = false
    this.emit('state-changed')
    return true
  }

  setConfig(patch: Partial<LockConfig>): LockConfig {
    const next = writeConfig(patch)
    this.emit('config-changed', next)
    return next
  }
}

let instance: LockManager | null = null
export function getLockManager(): LockManager {
  if (!instance) instance = new LockManager()
  return instance
}
