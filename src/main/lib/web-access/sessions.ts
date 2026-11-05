import { randomBytes } from 'node:crypto'

import { hashToken } from '../lan/token-hash'

export const WEB_IDLE_MS = 30 * 60_000
export const WEB_ABSOLUTE_MS = 12 * 60 * 60_000

interface Session {
  deviceId: string
  bindingHash: string
  createdAt: number
  activeAt: number
  requests: Set<AbortController>
}

/** Server-side sessions; the persistent device binding alone grants no API access. */
export function createWebSessions(now: () => number = Date.now) {
  const sessions = new Map<string, Session>()

  function remove(key: string) {
    const session = sessions.get(key)
    sessions.delete(key)
    for (const controller of session?.requests ?? []) controller.abort()
  }

  function sweep() {
    for (const [key, session] of sessions) {
      if (
        now() - session.activeAt >= WEB_IDLE_MS ||
        now() - session.createdAt >= WEB_ABSOLUTE_MS
      )
        remove(key)
    }
  }

  function read(token: string, deviceId: string, binding: string) {
    sweep()
    const session = sessions.get(hashToken(token))
    return session?.deviceId === deviceId &&
      session.bindingHash === hashToken(binding)
      ? session
      : null
  }

  return {
    create(deviceId: string, binding: string) {
      // One active session per paired browser. New verification replaces it.
      this.revoke(deviceId)
      const token = randomBytes(32).toString('base64url')
      sessions.set(hashToken(token), {
        deviceId,
        bindingHash: hashToken(binding),
        createdAt: now(),
        activeAt: now(),
        requests: new Set()
      })
      return token
    },
    read,
    touch(token: string, deviceId: string, binding: string) {
      const session = read(token, deviceId, binding)
      if (session) session.activeAt = now()
      return !!session
    },
    track(token: string, deviceId: string, binding: string) {
      const session = read(token, deviceId, binding)
      if (!session) return null
      const controller = new AbortController()
      session.requests.add(controller)
      return {
        signal: controller.signal,
        release: () => session.requests.delete(controller)
      }
    },
    revoke(deviceId?: string) {
      for (const [key, session] of sessions)
        if (!deviceId || session.deviceId === deviceId) remove(key)
    },
    sweep
  }
}
