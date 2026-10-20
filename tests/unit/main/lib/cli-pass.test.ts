import {
  CLI_PASS_TTL_MS,
  clearCliPasses,
  isCliPass,
  issueCliPass
} from '@main/lib/cli-pass'
import { beforeEach, describe, expect, it } from 'vitest'

beforeEach(() => clearCliPasses())

describe('CLI pass', () => {
  it('opens the device routes only', () => {
    const { token } = issueCliPass()
    expect(isCliPass(token, '/api/v1/devices')).toBe(true)
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
