import {
  CLI_PASS_TTL_MS,
  clearCliPasses,
  isCliPass,
  issueCliPass
} from '@main/lib/cli-pass'
import { beforeEach, describe, expect, it } from 'vitest'

beforeEach(() => clearCliPasses())

describe('CLI pass', () => {
  it('opens the device and host routes only', () => {
    const { token } = issueCliPass()
    expect(isCliPass(token, '/api/v1/devices')).toBe(true)
    expect(isCliPass(token, '/api/v1/host/lock')).toBe(true)
    expect(isCliPass(token, '/api/v1/hostile')).toBe(false)
    expect(isCliPass(token, '/api/v1/devices/pairing')).toBe(true)
    expect(isCliPass(token, '/api/v1/devices/d1')).toBe(true)
    expect(isCliPass(token, '/api/v1/chat/approval')).toBe(false)
    expect(isCliPass(token, '/api/v1/devices-and-more')).toBe(false)
  })

  it('lapses after its lifetime', () => {
    const { token, expiresAt } = issueCliPass(1_000)
    expect(expiresAt).toBe(1_000 + CLI_PASS_TTL_MS)
    expect(isCliPass(token, '/api/v1/devices', expiresAt - 1)).toBe(true)
    expect(isCliPass(token, '/api/v1/devices', expiresAt)).toBe(false)
    // Forgotten once seen expired.
    expect(isCliPass(token, '/api/v1/devices', 1_000)).toBe(false)
  })

  it('refuses anything that is not a pass it issued', () => {
    const { token } = issueCliPass()
    expect(isCliPass(undefined, '/api/v1/devices')).toBe(false)
    expect(isCliPass('', '/api/v1/devices')).toBe(false)
    expect(isCliPass(token.slice(1), '/api/v1/devices')).toBe(false)
    expect(isCliPass(`${token}x`, '/api/v1/devices')).toBe(false)
  })

  it('each pass is its own random token', () => {
    const a = issueCliPass().token
    const b = issueCliPass().token
    expect(a).not.toBe(b)
    expect(a).toMatch(/^[\w-]{43}$/u)
  })
})

describe('guesses at the PIN', () => {
  it('lets the first misses through, then doubles the wait, then stops issuing passes', async () => {
    const {
      cliPinGate,
      recordCliPinMiss,
      resetCliPinMisses,
      CLI_PIN_FREE_MISSES,
      CLI_PIN_MAX_MISSES
    } = await import('@main/lib/cli-pass')
    const now = 1_000_000
    for (let i = 1; i < CLI_PIN_FREE_MISSES; i++) {
      recordCliPinMiss(now)
      expect(cliPinGate(now)).toEqual({ open: true })
    }
    recordCliPinMiss(now) // 5th
    expect(cliPinGate(now)).toEqual({
      open: false,
      disabled: false,
      retryAfterMs: 30_000
    })
    recordCliPinMiss(now) // 6th
    expect(cliPinGate(now)).toEqual({
      open: false,
      disabled: false,
      retryAfterMs: 60_000
    })
    expect(cliPinGate(now + 60_000)).toEqual({ open: true })
    for (let i = 7; i <= CLI_PIN_MAX_MISSES; i++) recordCliPinMiss(now)
    // Disabled for good, however long one waits.
    expect(cliPinGate(now + 365 * 86_400_000)).toEqual({
      open: false,
      disabled: true
    })

    resetCliPinMisses()
    expect(cliPinGate(now)).toEqual({ open: true })
  })
})
