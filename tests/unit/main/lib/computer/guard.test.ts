import { Guard } from '@main/lib/computer/guard'
import { describe, expect, it } from 'vitest'

describe('automation cancellation', () => {
  it('aborts the upstream call signal immediately and keeps the first reason', () => {
    const guard = new Guard()
    expect(guard.aborted).toBe(false)
    guard.abort('hotkey')
    guard.abort('system')
    expect(guard.aborted).toBe(true)
    expect(guard.signal.reason).toBe('hotkey')
  })
})
