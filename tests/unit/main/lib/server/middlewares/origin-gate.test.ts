import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@main/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}))

const { createOriginGate, isAllowedHost, isAllowedOrigin } =
  await import('@main/lib/server/middlewares/origin-gate')

const DEV = 'http://localhost:5173'

describe('isAllowedOrigin', () => {
  // Measured on the packaged build: a file:// page in Electron sends no Origin
  // at all — so neither does anything else of ours, except the dev renderer.
  it('allows a request with no Origin (the packaged app, actovia-ios, actovia-cli, curl)', () => {
    expect(isAllowedOrigin(undefined)).toBe(true)
    expect(isAllowedOrigin(undefined, DEV)).toBe(true)
  })

  it('allows the dev renderer, and only in a dev build', () => {
    expect(isAllowedOrigin(DEV, DEV)).toBe(true)
    expect(isAllowedOrigin(DEV, `${DEV}/`)).toBe(true)
    expect(isAllowedOrigin(DEV)).toBe(false)
  })

  it.each([
    ['a website', 'https://evil.example'],
    ['a plain-http website', 'http://evil.example'],
    ['a site on the API port', 'http://evil.example:60223'],
    ['a lookalike of localhost', 'http://localhost.evil.example'],
    ['a LAN web page', 'http://192.168.1.20:8080'],
    // Some other dev server on this machine — or an XSS on one.
    ['another loopback port', 'http://localhost:3000'],
    ['the same port on another loopback name', 'http://127.0.0.1:5173'],
    // What a sandboxed iframe on a hostile page sends. Actovia never does.
    ['an opaque origin', 'null'],
    ['a browser extension', 'chrome-extension://abcdefghijklmnop'],
    ['a file origin', 'file://'],
    // Model-written code; see src/main/lib/artifact-protocol.ts.
    ['the artifact sandbox', 'actovia-artifact://sandbox'],
    ['garbage', 'not a url']
  ])('rejects %s, in dev and packaged alike', (_label, origin) => {
    expect(isAllowedOrigin(origin)).toBe(false)
    expect(isAllowedOrigin(origin, DEV)).toBe(false)
  })
})

describe('isAllowedHost', () => {
  const LOOPBACK = '127.0.0.1'

  it.each([
    ['localhost:60223'],
    ['127.0.0.1:60223'],
    ['[::1]:60223'],
    ['192.168.1.10:60223'],
    ['mac.local:60223']
  ])('lets a loopback client address the server as %s', (host) => {
    expect(isAllowedHost(host, LOOPBACK)).toBe(true)
  })

  it('rejects a loopback client that addresses the server by a public name (DNS rebinding)', () => {
    expect(isAllowedHost('evil.example:60223', LOOPBACK)).toBe(false)
    expect(isAllowedHost('evil.example:60223', '::1')).toBe(false)
    expect(isAllowedHost('evil.example:60223', '::ffff:127.0.0.1')).toBe(false)
  })

  it('passes when there is nothing to judge (no Host, or no socket under app.request())', () => {
    expect(isAllowedHost(undefined, LOOPBACK)).toBe(true)
    expect(isAllowedHost('evil.example', undefined)).toBe(true)
  })
})

describe('createOriginGate', () => {
  function buildApp(opts: { devOrigin?: string } = {}) {
    const app = new Hono()
    app.use('*', createOriginGate(opts))
    app.use('*', cors())
    app.get('/api/v1/settings', (c) => c.json({ apiKey: 'sk-secret' }))
    app.post('/api/v1/chat', (c) => c.json({ ok: true }))
    return app
  }

  it('serves a request with no Origin', async () => {
    expect((await buildApp().request('/api/v1/settings')).status).toBe(200)
  })

  it('packaged: refuses anything that carries an Origin, loopback included', async () => {
    const res = await buildApp().request('/api/v1/settings', {
      headers: { Origin: DEV }
    })
    expect(res.status).toBe(403)
  })

  it('dev: serves exactly the Vite renderer', async () => {
    const app = buildApp({ devOrigin: DEV })
    const renderer = await app.request('/api/v1/settings', {
      headers: { Origin: DEV }
    })
    const other = await app.request('/api/v1/settings', {
      headers: { Origin: 'http://localhost:3000' }
    })
    expect(renderer.status).toBe(200)
    expect(other.status).toBe(403)
  })

  it('refuses a website, without a body worth reading or a CORS grant', async () => {
    const res = await buildApp({ devOrigin: DEV }).request('/api/v1/settings', {
      headers: { Origin: 'https://evil.example' }
    })
    expect(res.status).toBe(403)
    expect(await res.text()).not.toContain('sk-secret')
    expect(res.headers.get('access-control-allow-origin')).toBeNull()
  })

  it('refuses an opaque origin — a sandboxed iframe on a hostile page', async () => {
    const res = await buildApp().request('/api/v1/settings', {
      headers: { Origin: 'null' }
    })
    expect(res.status).toBe(403)
  })

  it("refuses a website's preflight, so its real request is never sent", async () => {
    const res = await buildApp().request('/api/v1/chat', {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://evil.example',
        'Access-Control-Request-Method': 'POST'
      }
    })
    expect(res.status).toBe(403)
    expect(res.headers.get('access-control-allow-origin')).toBeNull()
  })

  it('refuses a rebinding request that reaches the loopback listener', async () => {
    const res = await buildApp().request(
      '/api/v1/settings',
      { headers: { Host: 'evil.example:60223' } },
      { incoming: { socket: { remoteAddress: '127.0.0.1' } } }
    )
    expect(res.status).toBe(403)
  })

  // actovia-ios may reach the computer by whatever name the user gave it.
  it('does not hold the lan listener to the Host check', async () => {
    const res = await buildApp().request(
      '/api/v1/settings',
      { headers: { Host: 'mac.tailnet.ts.net:63129' } },
      { listener: 'lan', incoming: { socket: { remoteAddress: '127.0.0.1' } } }
    )
    expect(res.status).toBe(200)
  })
})
