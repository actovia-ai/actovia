import {
  createWebSessions,
  WEB_ABSOLUTE_MS,
  WEB_IDLE_MS
} from '@main/lib/web-access/sessions'
import { describe, expect, it } from 'vitest'

describe('browser sessions', () => {
  it('binds the unlocked session to both a device and its persistent binding', () => {
    const sessions = createWebSessions()
    const token = sessions.create('browser-a', 'binding-a')
    expect(token).toMatch(/^[\w-]{43}$/u)
    expect(sessions.read(token, 'browser-a', 'binding-a')).toBeTruthy()
    expect(sessions.read(token, 'browser-b', 'binding-a')).toBeNull()
    expect(sessions.read(token, 'browser-a', 'binding-b')).toBeNull()
    expect(sessions.read('binding-a', 'browser-a', 'binding-a')).toBeNull()
  })

  it('revokes one device and aborts its active streams without affecting another', () => {
    const sessions = createWebSessions()
    const a = sessions.create('a', 'binding-a')
    const b = sessions.create('b', 'binding-b')
    const stream = sessions.track(a, 'a', 'binding-a')!
    sessions.revoke('a')
    expect(stream.signal.aborted).toBe(true)
    expect(sessions.read(a, 'a', 'binding-a')).toBeNull()
    expect(sessions.read(b, 'b', 'binding-b')).toBeTruthy()
    sessions.revoke()
    expect(sessions.read(b, 'b', 'binding-b')).toBeNull()
  })

  it('re-verification replaces the old session for the same device', () => {
    const sessions = createWebSessions()
    const old = sessions.create('a', 'binding')
    const stream = sessions.track(old, 'a', 'binding')!
    const next = sessions.create('a', 'binding')
    expect(stream.signal.aborted).toBe(true)
    expect(sessions.read(old, 'a', 'binding')).toBeNull()
    expect(sessions.read(next, 'a', 'binding')).toBeTruthy()
  })

  it('polling and SSE do not keep an idle browser unlocked', () => {
    let now = 0
    const sessions = createWebSessions(() => now)
    const token = sessions.create('a', 'binding')
    const stream = sessions.track(token, 'a', 'binding')!
    now = WEB_IDLE_MS - 1
    expect(sessions.read(token, 'a', 'binding')).toBeTruthy()
    now++
    sessions.sweep()
    expect(stream.signal.aborted).toBe(true)
    expect(sessions.touch(token, 'a', 'binding')).toBe(false)
  })

  it('user activity extends idle time but never the absolute lifetime', () => {
    let now = 0
    const sessions = createWebSessions(() => now)
    const token = sessions.create('a', 'binding')
    for (now = WEB_IDLE_MS - 1; now < WEB_ABSOLUTE_MS; now += WEB_IDLE_MS - 1)
      expect(sessions.touch(token, 'a', 'binding')).toBe(true)
    expect(sessions.read(token, 'a', 'binding')).toBeNull()
  })
})
