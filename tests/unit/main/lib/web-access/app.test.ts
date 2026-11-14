import {
  createWebApp,
  DEVICE_COOKIE,
  SESSION_COOKIE
} from '@main/lib/web-access/app'
import { createWebTerminals } from '@main/lib/web-access/terminals'
import { describe, expect, it, vi } from 'vitest'

const ORIGIN = 'https://mac.example.ts.net'
function fixture() {
  let enabled = true
  let locked = false
  const records = new Map([
    ['a', { id: 'a', name: 'Work browser', webCredential: null }],
    ['b', { id: 'b', name: 'Other browser', webCredential: null }]
  ])
  const terminals = createWebTerminals({
    authenticate: async (binding) => (records.has(binding) ? binding : null),
    find: async (id) => records.get(id) ?? null,
    register: vi.fn(),
    update: vi.fn(),
    remove: async (id) => {
      records.delete(id)
      terminals.invalidate(id)
    },
    unlockHost: vi.fn()
  })
  const upstream = vi.fn(async (_request, env) =>
    Response.json({ device: env.webDeviceId })
  )
  const app = createWebApp({
    config: () => ({ enabled, origin: ORIGIN }),
    hostLocked: () => locked,
    terminals,
    api: upstream,
    asset: async () => new Response('public entry')
  })
  const a = terminals.sessions.create('a', 'a')
  const b = terminals.sessions.create('b', 'b')
  const cookie = (id = 'a', token = id === 'a' ? a : b) =>
    `${DEVICE_COOKIE}=${id}; ${SESSION_COOKIE}=${token}`
  const request = (path: string, options: RequestInit = {}) =>
    app.request(`${ORIGIN}${path}`, {
      ...options,
      headers: { Host: new URL(ORIGIN).host, ...options.headers }
    })
  const post = (path: string, id = 'a', body = {}) =>
    request(path, {
      method: 'POST',
      headers: {
        Cookie: cookie(id),
        Origin: ORIGIN,
        'x-actovia-web': '1',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    })
  return {
    app,
    terminals,
    upstream,
    cookie,
    request,
    post,
    disable: () => {
      enabled = false
    },
    lock: () => {
      locked = true
    }
  }
}

describe('paired browser HTTP entry', () => {
  it('only serves the entry while enabled and leaks no business data before unlock', async () => {
    const f = fixture()
    expect((await f.request('/')).status).toBe(200)
    for (const headers of [
      {},
      { Cookie: `${DEVICE_COOKIE}=a` },
      { Authorization: 'Bearer a' },
      { 'x-actovia-presence': 'spoof', 'x-actovia-device-id': 'a' }
    ])
      expect((await f.request('/api/v1/history', { headers })).status).toBe(401)
    expect(f.upstream).not.toHaveBeenCalled()
    expect(
      await (
        await f.request('/api/web-terminal', {
          headers: { Cookie: `${DEVICE_COOKIE}=a` }
        })
      ).json()
    ).toEqual({ paired: true, unlocked: false, deviceName: 'Work browser' })
    f.disable()
    expect((await f.request('/')).status).toBe(404)
  })

  it('requires the exact Host, Origin and custom header on writes', async () => {
    const f = fixture()
    for (const headers of [
      { Host: 'evil.test' },
      { Origin: 'https://evil.test' },
      { Origin: 'null' }
    ])
      expect((await f.request('/', { headers })).status).toBe(403)
    for (const headers of [
      {},
      { Origin: ORIGIN },
      { 'x-actovia-web': '1' },
      { Origin: 'https://evil.test', 'x-actovia-web': '1' }
    ])
      expect(
        (
          await f.request('/api/v1/chat', {
            method: 'POST',
            headers: { Cookie: f.cookie(), ...headers },
            body: '{}'
          })
        ).status
      ).toBe(403)
    expect((await f.post('/api/v1/chat')).status).toBe(200)
    expect(f.upstream.mock.calls[0][1]).toEqual({
      listener: 'web',
      webDeviceId: 'a',
      webOrigin: ORIGIN
    })
  })

  it('keeps native management inaccessible even to a verified browser', async () => {
    const f = fixture()
    for (const path of [
      '/devices',
      '/devices/pairing',
      '/web-access',
      '/pair',
      '/lock/cli-pass',
      '/host/quit'
    ])
      expect(
        (await f.request(`/api/v1${path}`, { headers: { Cookie: f.cookie() } }))
          .status,
        path
      ).toBe(403)
    expect(f.upstream).not.toHaveBeenCalled()
  })

  it('serves the artifact sandbox read-only to the opaque iframe origin', async () => {
    const f = fixture()
    const response = await f.request(
      '/api/v1/artifacts/sandbox/src/renderer/sub-apps/artifacts/index.html',
      {
        headers: {
          Cookie: f.cookie(),
          Origin: 'null'
        }
      }
    )
    expect(response.status).toBe(200)
    expect(f.upstream).not.toHaveBeenCalled()
    expect(response.headers.get('access-control-allow-origin')).toBe('*')
    expect(response.headers.get('content-security-policy')).toContain(
      'sandbox allow-scripts'
    )
    // Static runtime is public like other compiled JS; no cookies or user code.
    expect(
      (
        await f.request('/api/v1/artifacts/sandbox/assets/runtime.js', {
          headers: { Origin: 'null' }
        })
      ).status
    ).toBe(200)
    expect(
      (
        await f.request('/api/v1/history', {
          headers: { Cookie: f.cookie(), Origin: 'null' }
        })
      ).status
    ).toBe(403)
    expect(
      (
        await f.request(
          '/api/v1/artifacts/sandbox/src/renderer/sub-apps/artifacts/index.html',
          {
            method: 'POST',
            headers: {
              Cookie: f.cookie(),
              Origin: ORIGIN,
              'x-actovia-web': '1'
            }
          }
        )
      ).status
    ).toBe(403)
  })

  it('locking and forgetting affect only the bound device, never a supplied id', async () => {
    const f = fixture()
    const lock = await f.post('/api/web-terminal/lock')
    expect(lock.headers.get('set-cookie')).toContain('Secure')
    expect(
      (await f.request('/api/v1/history', { headers: { Cookie: f.cookie() } }))
        .status
    ).toBe(401)
    expect(
      (
        await f.request('/api/v1/history', {
          headers: { Cookie: f.cookie('b') }
        })
      ).status
    ).toBe(200)
    expect(
      (await f.post('/api/web-terminal/forget', 'a', { deviceId: 'b' })).status
    ).toBe(200)
    expect(await f.terminals.device('a')).toBeNull()
    expect(await f.terminals.device('b')).toBeTruthy()
  })

  it('host lock invalidates every unlocked browser session', async () => {
    const f = fixture()
    f.lock()
    expect(
      (await f.request('/api/v1/history', { headers: { Cookie: f.cookie() } }))
        .status
    ).toBe(401)
    expect(
      await (
        await f.request('/api/web-terminal', {
          headers: { Cookie: f.cookie('b') }
        })
      ).json()
    ).toMatchObject({ paired: true, unlocked: false })
  })

  it('revocation closes an existing SSE body, including when revoked while its handler is starting', async () => {
    for (const duringHandler of [false, true]) {
      const f = fixture()
      const cancel = vi.fn()
      f.upstream.mockImplementation(async () => {
        if (duringHandler) f.terminals.invalidate('a')
        return new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode('data: hello\n\n'))
            },
            cancel
          }),
          { headers: { 'Content-Type': 'text/event-stream' } }
        )
      })
      const response = await f.request('/api/v1/events', {
        headers: { Cookie: f.cookie() }
      })
      const reader = response.body!.getReader()
      if (!duringHandler) {
        await reader.read()
        f.terminals.invalidate('a')
      }
      await reader.read()
      expect(cancel).toHaveBeenCalledOnce()
    }
  })

  it('sets protective response headers and bounds pre-auth request bodies', async () => {
    const f = fixture()
    const response = await f.request('/api/v1/history', {
      headers: { Cookie: f.cookie() }
    })
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('content-security-policy')).toContain(
      "frame-ancestors 'none'"
    )
    expect(
      (
        await f.post('/api/web-terminal/pair/options', 'none', {
          code: 'x'.repeat(140_000),
          name: 'x'
        })
      ).status
    ).toBe(413)
  })
})
