// src/main/lib/server/routes/analytics.ts
import { isAppError } from '@actovia/shared/errors/app-error'
import { Hono } from 'hono'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getPath: () => '/tmp' } }))
vi.mock('@main/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}))
vi.mock('@main/lib/paths', () => ({
  getAnalyticsDbPath: () => '/tmp/actovia.duckdb'
}))

const duck = vi.hoisted(() => ({
  runQuery: vi.fn(),
  duckdbVersion: vi.fn()
}))
vi.mock('@main/lib/analytics/duckdb', () => ({
  ...duck,
  DuckDBUnavailableError: class DuckDBUnavailableError extends Error {}
}))

const snap = vi.hoisted(() => ({
  buildSnapshot: vi.fn(),
  readSnapshotMeta: vi.fn(),
  snapshotExists: vi.fn()
}))
vi.mock('@main/lib/analytics/snapshot', () => snap)

async function buildApp() {
  const { default: router } = await import('@main/lib/server/routes/analytics')
  const app = new Hono()
  app.route('/api/v1/analytics', router)
  app.onError((err, c) => {
    if (isAppError(err)) return c.json(err.toJSON(), err.statusCode as never)
    return c.json({ message: err.message }, 500)
  })
  return app
}

const post = (path: string, body: unknown) =>
  new Request(`http://x${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  })

describe('/api/v1/analytics', () => {
  beforeEach(() => {
    for (const fn of [...Object.values(duck), ...Object.values(snap)])
      fn.mockReset()
    snap.readSnapshotMeta.mockResolvedValue(null)
    snap.snapshotExists.mockReturnValue(true)
  })

  it('GET /status reports the engine and snapshot', async () => {
    duck.duckdbVersion.mockResolvedValue('v1.5.5')
    snap.readSnapshotMeta.mockResolvedValue({ builtAt: 'x', tables: [] })
    const app = await buildApp()
    const res = await app.request('/api/v1/analytics/status')
    expect(await res.json()).toMatchObject({
      available: true,
      version: 'v1.5.5',
      snapshot: { builtAt: 'x' },
      path: '/tmp/actovia.duckdb'
    })
  })

  it('GET /status degrades to available=false when DuckDB cannot load', async () => {
    duck.duckdbVersion.mockRejectedValue(new Error('dlopen failed'))
    const app = await buildApp()
    const res = await app.request('/api/v1/analytics/status')
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({
      available: false,
      error: 'dlopen failed'
    })
  })

  it('POST /query validates, requires a snapshot, and surfaces DuckDB errors', async () => {
    const app = await buildApp()

    let res = await app.request(post('/api/v1/analytics/query', { sql: '  ' }))
    expect(res.status).toBe(400)

    snap.snapshotExists.mockReturnValue(false)
    res = await app.request(
      post('/api/v1/analytics/query', { sql: 'select 1' })
    )
    expect(res.status).toBe(404)
    expect((await res.json()).error.code).toBe('ANALYTICS_SNAPSHOT_MISSING')

    snap.snapshotExists.mockReturnValue(true)
    duck.runQuery.mockRejectedValue(
      new Error('Binder Error: column "nope" not found')
    )
    res = await app.request(
      post('/api/v1/analytics/query', { sql: 'select nope' })
    )
    expect(res.status).toBe(400)
    expect((await res.json()).error.message).toContain('nope')

    duck.runQuery.mockResolvedValue({ columns: [], rows: [], rowCount: 0 })
    res = await app.request(
      post('/api/v1/analytics/query', { sql: 'select 1' })
    )
    expect(res.status).toBe(200)
    expect(duck.runQuery).toHaveBeenCalledWith('select 1')
  })

  it('maps a load failure during a query or build to 503', async () => {
    const { DuckDBUnavailableError } =
      await import('@main/lib/analytics/duckdb')
    const app = await buildApp()
    duck.runQuery.mockRejectedValue(new DuckDBUnavailableError('no binding'))
    let res = await app.request(
      post('/api/v1/analytics/query', { sql: 'select 1' })
    )
    expect(res.status).toBe(503)
    expect((await res.json()).error.code).toBe('ANALYTICS_UNAVAILABLE')

    snap.buildSnapshot.mockResolvedValue({ builtAt: 'y', tables: [] })
    res = await app.request(post('/api/v1/analytics/snapshot', {}))
    expect(res.status).toBe(200)
    expect((await res.json()).builtAt).toBe('y')
  })
})
