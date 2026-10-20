// src/main/lib/server/routes/artifact-sandbox.ts — GET /api/v1/artifacts/sandbox/*,
// mounted in a bare Hono app behind the real authGate, ahead of the artifacts
// router, the way app.ts mounts it. The "build" is a scratch directory.
import { mkdirSync, mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

import { Hono } from 'hono'
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: { getPath: () => tmpdir() },
  protocol: {},
  net: {}
}))
vi.mock('@main/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}))
vi.mock('@main/lib/lan/devices', () => ({
  authenticate: vi.fn(async (token: string) =>
    token === 'good' ? 'dev-1' : null
  )
}))
vi.mock('@main/lib/ai/artifacts', () => ({
  getArtifact: vi.fn(() => null),
  listArtifacts: vi.fn(() => [])
}))
vi.mock('@main/lib/db/queries', () => ({
  updateArtifactCodeByArtifactId: vi.fn()
}))

const { createArtifactSandboxRouter, resolveSandboxFile, SANDBOX_PAGE } =
  await import('@main/lib/server/routes/artifact-sandbox')
const { default: artifactsRouter } =
  await import('@main/lib/server/routes/artifacts')
const { authGate } = await import('@main/lib/server/middlewares/auth-gate')
const { errorHandler } =
  await import('@main/lib/server/middlewares/error-handler')

const root = mkdtempSync(join(tmpdir(), 'actovia-sandbox-route-'))
const rendererDir = join(root, 'main_window')
mkdirSync(join(rendererDir, 'src/renderer/sub-apps/artifacts'), {
  recursive: true
})
mkdirSync(join(rendererDir, 'assets'), { recursive: true })
writeFileSync(join(rendererDir, SANDBOX_PAGE), '<!doctype html><p>sandbox')
writeFileSync(join(rendererDir, 'assets/artifacts-abc.js'), 'export {}')
writeFileSync(join(rendererDir, 'assets/globals-abc.css'), 'body{}')
writeFileSync(join(rendererDir, 'assets/inter.woff2'), Buffer.from([1, 2]))
writeFileSync(join(rendererDir, 'index.html'), '<!doctype html><p>main')
// Outside the build: must never be served.
writeFileSync(join(root, 'secret.txt'), 'secret')

function makeApp(opts: Parameters<typeof createArtifactSandboxRouter>[0]) {
  const app = new Hono()
  app.use('/api/*', authGate)
  app.route('/api/v1/artifacts/sandbox', createArtifactSandboxRouter(opts))
  app.route('/api/v1/artifacts', artifactsRouter)
  app.onError(errorHandler)
  return app
}

const app = makeApp({ rendererDir })
const get = (path: string, init?: RequestInit, env?: unknown) =>
  app.request(`/api/v1/artifacts/sandbox/${path}`, init, env as never)

describe('GET /api/v1/artifacts/sandbox/*', () => {
  it.each([
    [SANDBOX_PAGE, 'text/html; charset=utf-8', 'no-cache'],
    [
      'assets/artifacts-abc.js',
      'text/javascript; charset=utf-8',
      'private, max-age=31536000, immutable'
    ],
    [
      'assets/globals-abc.css',
      'text/css; charset=utf-8',
      'private, max-age=31536000, immutable'
    ],
    ['assets/inter.woff2', 'font/woff2', 'private, max-age=31536000, immutable']
  ])('serves %s as %s', async (path, type, cache) => {
    const res = await get(path)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe(type)
    expect(res.headers.get('cache-control')).toBe(cache)
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
  })

  it('serves the page itself, not the artifacts router', async () => {
    const res = await get(SANDBOX_PAGE)
    expect(await res.text()).toContain('sandbox')
  })

  it.each([
    ['a missing asset', 'assets/nope.js'],
    ["the main window's page", 'index.html'],
    ['the bare mount', ''],
    ['an encoded traversal', 'assets/..%2F..%2Fsecret.txt'],
    ['a NUL', 'assets/%00.js'],
    ['a malformed escape', 'assets/%E0%A4%A']
  ])('answers 404 for %s', async (_label, path) => {
    const res = await get(path)
    expect(res.status).toBe(404)
    expect(await res.text()).not.toContain('secret')
  })

  // `%2e%2e` is folded by the URL parser, so the request leaves the mount.
  it('never serves a file outside the build for a folded dot-dot', async () => {
    const res = await get('assets/%2e%2e/%2e%2e/secret.txt')
    expect(await res.text()).not.toContain('secret')
  })

  it('answers 404 when there is no build (e.g. under tests)', async () => {
    const res = await makeApp({}).request(
      `/api/v1/artifacts/sandbox/${SANDBOX_PAGE}`
    )
    expect(res.status).toBe(404)
  })

  it('needs a paired device on the LAN listener', async () => {
    const lan = { listener: 'lan' }
    expect((await get(SANDBOX_PAGE, undefined, lan)).status).toBe(401)
    const ok = await get(
      SANDBOX_PAGE,
      { headers: { authorization: 'Bearer good' } },
      lan
    )
    expect(ok.status).toBe(200)
  })

  it('proxies to the Vite dev server in dev', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('export {}', {
        headers: { 'content-type': 'text/javascript' }
      })
    )
    const dev = makeApp({ devServerUrl: 'http://localhost:5173/' })
    const res = await dev.request(
      '/api/v1/artifacts/sandbox/src/renderer/sub-apps/artifacts/main.tsx'
    )
    expect(fetchSpy).toHaveBeenCalledWith(
      'http://localhost:5173/src/renderer/sub-apps/artifacts/main.tsx'
    )
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('text/javascript')
    fetchSpy.mockRestore()
  })

  it('asks the dev server the way it is given, and answers 502 when it cannot be reached', async () => {
    const asked: string[] = []
    const reachable = makeApp({
      devServerUrl: 'http://localhost:5173',
      fetchUpstream: async (url) => {
        asked.push(url)
        return new Response('<!doctype html>', {
          headers: { 'content-type': 'text/html' }
        })
      }
    })
    const page = await reachable.request(
      `/api/v1/artifacts/sandbox/${SANDBOX_PAGE}`
    )
    expect(asked).toEqual([`http://localhost:5173/${SANDBOX_PAGE}`])
    expect(page.status).toBe(200)

    const down = makeApp({
      devServerUrl: 'http://localhost:5173',
      fetchUpstream: () => Promise.reject(new Error('ECONNREFUSED'))
    })
    const res = await down.request(`/api/v1/artifacts/sandbox/${SANDBOX_PAGE}`)
    expect(res.status).toBe(502)
  })
})

describe('dev server relay keeps the query', () => {
  it('asks Vite for the module the page named, query and all', async () => {
    const asked: string[] = []
    const app = makeApp({
      devServerUrl: 'http://localhost:5173',
      fetchUpstream: async (url) => {
        asked.push(url)
        return new Response('export {}', {
          headers: { 'content-type': 'text/javascript' }
        })
      }
    })
    await app.request(
      '/api/v1/artifacts/sandbox/node_modules/.vite/deps/react.js?v=1a2b3c'
    )
    expect(asked).toEqual([
      'http://localhost:5173/node_modules/.vite/deps/react.js?v=1a2b3c'
    ])
  })
})

describe('resolveSandboxFile', () => {
  it('keeps to the sandbox page and the assets', () => {
    expect(resolveSandboxFile(rendererDir, `/${SANDBOX_PAGE}`)).toBe(
      join(rendererDir, SANDBOX_PAGE)
    )
    expect(resolveSandboxFile(rendererDir, '/assets/x.js')).toBe(
      join(rendererDir, 'assets/x.js')
    )
    expect(resolveSandboxFile(rendererDir, '/index.html')).toBeNull()
    expect(
      resolveSandboxFile(
        rendererDir,
        '/src/renderer/sub-apps/searchbar/index.html'
      )
    ).toBeNull()
    expect(resolveSandboxFile(rendererDir, '/../secret.txt')).toBeNull()
  })
})
