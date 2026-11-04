// The loopback OAuth callback listener: it binds to 127.0.0.1 on an ephemeral
// port, answers only the callback path, hands back the authorization code and
// state, and rejects on an error redirect or timeout. Real node:http and
// fetch; only the logger is mocked.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const logged = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn()
}))
vi.mock('@main/lib/logger', () => ({ logger: logged }))

import {
  CALLBACK_PATH,
  startLoopbackCallback
} from '@main/lib/ai/mcp-oauth/callback-server'

describe('MCP OAuth loopback callback', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('binds a loopback redirect URI on an ephemeral port', async () => {
    const cb = await startLoopbackCallback()
    try {
      const url = new URL(cb.redirectUri)
      expect(url.hostname).toBe('127.0.0.1')
      expect(url.pathname).toBe(CALLBACK_PATH)
      expect(Number(url.port)).toBeGreaterThan(0)
    } finally {
      cb.close()
    }
  })

  it('resolves with the code and state the browser returns', async () => {
    const cb = await startLoopbackCallback()
    try {
      // Register the expectation before hitting the endpoint so the promise's
      // handler is attached when it settles.
      const settled = expect(cb.waitForCode()).resolves.toEqual({
        code: 'abc123',
        state: 'xyz'
      })
      const res = await fetch(`${cb.redirectUri}?code=abc123&state=xyz`)
      expect(res.status).toBe(200)
      await settled
    } finally {
      cb.close()
    }
  })

  it('rejects when the provider redirects with an error', async () => {
    const cb = await startLoopbackCallback()
    try {
      const rejected = expect(cb.waitForCode()).rejects.toThrow(
        /access_denied/u
      )
      const res = await fetch(`${cb.redirectUri}?error=access_denied`)
      expect(res.status).toBe(400)
      await rejected
    } finally {
      cb.close()
    }
  })

  it('escapes authorization error descriptions before displaying them', async () => {
    const cb = await startLoopbackCallback()
    try {
      const request = fetch(
        `${cb.redirectUri}?error=access_denied&error_description=%3Cimg%20src%3Dx%20onerror%3Dalert(1)%3E`
      )
      await expect(cb.waitForCode()).rejects.toThrow(/access_denied/u)
      const res = await request
      const html = await res.text()
      expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;')
      expect(html).not.toContain('<img src=x')
    } finally {
      cb.close()
    }
  })

  it('rejects a pending authorization when its listener is closed', async () => {
    const cb = await startLoopbackCallback()
    const rejected = expect(cb.waitForCode()).rejects.toThrow(
      /Authorization cancelled/u
    )
    cb.close()
    await rejected
  })

  it('404s any path that is not the callback, without resolving', async () => {
    const cb = await startLoopbackCallback()
    try {
      const base = new URL(cb.redirectUri)
      const res = await fetch(`${base.origin}/favicon.ico`)
      expect(res.status).toBe(404)
    } finally {
      cb.close()
    }
  })
})
