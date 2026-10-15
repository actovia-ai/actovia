// S3 review I2: a secret the server clears because its destination moved
// (ruling R1 — a stored key never follows a new host) is listed in
// `GET /api/v1/settings/secrets-status` `needsReentry`, persisted under
// `~/.exodus` so the prompt survives a restart (and reaches exodus-ios), until
// a new value is saved for it. Settings fields and MCP servers alike.
//
// Real SQL on an in-memory PGlite and the real routes; safeStorage is faked,
// EXODUS_HOME is a temp dir.
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

import { isAppError } from '@exodus/shared/errors/app-error'
import { Hono } from 'hono'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { resetFakeSafeStorage } from '../../../helpers/fake-safe-storage'

const home = mkdtempSync(join(tmpdir(), 'exodus-moved-reentry-'))
process.env.EXODUS_HOME = home

vi.mock('electron', async () => {
  const { fakeSafeStorage } = await import('../../../helpers/fake-safe-storage')
  return { app: { getPath: () => '/tmp' }, safeStorage: fakeSafeStorage }
})
vi.mock('@main/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}))
vi.mock('@main/lib/db/db', async () => {
  const { drizzle } = await import('drizzle-orm/pglite')
  const { createMigratedPglite } =
    await import('../../../helpers/migrated-pglite')
  const pglite = await createMigratedPglite('9999')
  return { pglite, db: drizzle(pglite) }
})
vi.mock('@main/lib/ai/providers/list-models', () => ({
  listModelsByProvider: {}
}))
vi.mock('@main/lib/ai/mcp', () => ({
  getMcpTools: vi.fn(async () => []),
  invalidateAllMcpCache: vi.fn(),
  invalidateMcpCache: vi.fn()
}))

const { pglite, db } = await import('@main/lib/db/db')
const { mcpServer } = await import('@main/lib/db/schema')
const queries = await import('@main/lib/db/queries')
const mcpQueries = await import('@main/lib/db/mcp-queries')
const status = await import('@main/lib/secrets/status')
const { default: mcpRouter } = await import('@main/lib/server/routes/mcp')
const { default: settingsRouter } =
  await import('@main/lib/server/routes/settings')

afterAll(async () => {
  await pglite.close()
  rmSync(home, { recursive: true, force: true })
  delete process.env.EXODUS_HOME
})

function app() {
  const a = new Hono()
  a.use('*', async (c, next) => {
    c.set('settings' as never, (await queries.getSettings()) as never)
    await next()
  })
  a.route('/api/v1/mcp', mcpRouter)
  a.route('/api/v1/settings', settingsRouter)
  a.onError((err, c) => {
    if (isAppError(err)) return c.json(err.toJSON(), err.statusCode as never)
    return c.json({ message: err.message }, 500)
  })
  return a
}

const send = (method: string, path: string, body?: unknown) =>
  app().request(path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  })

async function needsReentry(): Promise<string[]> {
  const res = await send('GET', '/api/v1/settings/secrets-status')
  return ((await res.json()) as { needsReentry: string[] }).needsReentry
}

async function shownSettings(): Promise<Record<string, never>> {
  return (await (await send('GET', '/api/v1/settings')).json()) as never
}

/** What survives an app restart: nothing in memory, only what is on disk. */
function restart() {
  queries.invalidateSettingsCache()
  status.recordSettingsDecryptFailures([])
  status.clearMcpDecryptFailures()
}

const OPENAI_KEY = 'sk-openai-moved-test-0000WXYZ'
const HEADER = 'Bearer header-moved-test-BBBB'
const TOKEN = 'ghp_env-moved-test-token-AAAA'

beforeEach(async () => {
  resetFakeSafeStorage()
  rmSync(join(home, 'secrets-reentry.json'), { force: true })
  await db.delete(mcpServer)
  const current = await shownSettings()
  await send('POST', '/api/v1/settings', {
    ...current,
    providers: {
      ...(current.providers as object),
      openaiApiKey: OPENAI_KEY,
      openaiBaseUrl: null
    }
  })
})

describe('a settings key cleared by a base-URL move', () => {
  it('is listed, survives a restart, and goes once a new key is saved', async () => {
    const shown = await shownSettings()
    const providers = shown.providers as Record<string, unknown>
    expect(providers.openaiApiKey).toBe('•••• WXYZ')

    await send('POST', '/api/v1/settings', {
      ...shown,
      providers: { ...providers, openaiBaseUrl: 'https://proxy.example/v1' }
    })
    expect(await needsReentry()).toContain('providers.openaiApiKey')

    restart()
    expect(await needsReentry()).toContain('providers.openaiApiKey')
    // Names only on disk — never a value.
    const onDisk = readFileSync(join(home, 'secrets-reentry.json'), 'utf8')
    expect(onDisk).toContain('providers.openaiApiKey')
    expect(onDisk).not.toContain('WXYZ')

    const after = await shownSettings()
    await send('POST', '/api/v1/settings', {
      ...after,
      providers: {
        ...(after.providers as object),
        openaiApiKey: 'sk-typed-for-the-proxy-1111'
      }
    })
    expect(await needsReentry()).not.toContain('providers.openaiApiKey')
    restart()
    expect(await needsReentry()).not.toContain('providers.openaiApiKey')
  })

  it('is listed too when the form already posts it cleared with the new URL (the desktop autosave does)', async () => {
    const shown = await shownSettings()
    await send('POST', '/api/v1/settings', {
      ...shown,
      providers: {
        ...(shown.providers as object),
        openaiApiKey: null,
        openaiBaseUrl: 'https://proxy.example/v1'
      }
    })
    expect(await needsReentry()).toContain('providers.openaiApiKey')
  })

  it('a save that only posts the mask back (no move) lists nothing', async () => {
    const shown = await shownSettings()
    await send('POST', '/api/v1/settings', shown)
    expect(await needsReentry()).toEqual([])
    expect(existsSync(join(home, 'secrets-reentry.json'))).toBe(false)
  })

  it('a key cleared on purpose (no move) is not asked for', async () => {
    const shown = await shownSettings()
    await send('POST', '/api/v1/settings', {
      ...shown,
      providers: { ...(shown.providers as object), openaiApiKey: null }
    })
    expect(await needsReentry()).toEqual([])
  })
})

describe('MCP secrets cleared by a destination move', () => {
  async function remote() {
    const row = await mcpQueries.createMcpServer({
      name: 'remote',
      transportType: 'sse',
      url: 'https://mcp.example.com/sse',
      headers: { Authorization: HEADER, 'X-Trace': 'yes-please' }
    })
    return row!.id
  }

  const shownMcp = async (id: string) =>
    (
      (await (await send('GET', '/api/v1/mcp')).json()) as Array<
        Record<string, unknown>
      >
    ).find((s) => s.id === id)!

  it('a url change lists every header it dropped, by name, across a restart', async () => {
    const id = await remote()
    const row = await shownMcp(id)
    await send('PUT', `/api/v1/mcp/${id}`, {
      name: row.name,
      transportType: 'sse',
      url: 'https://elsewhere.example.com/sse',
      headers: row.headers
    })
    const listed = await needsReentry()
    expect(listed).toContain('mcp:remote:headers.Authorization')
    expect(listed).toContain('mcp:remote:headers.X-Trace')

    restart()
    expect(await needsReentry()).toContain('mcp:remote:headers.Authorization')
  })

  it('the header typed again drops off; the one still missing stays', async () => {
    const id = await remote()
    const row = await shownMcp(id)
    await send('PUT', `/api/v1/mcp/${id}`, {
      name: row.name,
      transportType: 'sse',
      url: 'https://elsewhere.example.com/sse',
      headers: row.headers
    })
    await send('PUT', `/api/v1/mcp/${id}`, {
      headers: { Authorization: 'Bearer typed-again-000CCCC' }
    })
    const listed = await needsReentry()
    expect(listed).not.toContain('mcp:remote:headers.Authorization')
    expect(listed).toContain('mcp:remote:headers.X-Trace')
  })

  it('a new command lists the env it dropped; a renamed server is listed by its new name', async () => {
    const created = await mcpQueries.createMcpServer({
      name: 'github',
      transportType: 'stdio',
      command: 'npx',
      args: ['-y', 'server-github'],
      env: { GITHUB_TOKEN: TOKEN }
    })
    const row = await shownMcp(created!.id)
    await send('PUT', `/api/v1/mcp/${created!.id}`, {
      name: 'github',
      transportType: 'stdio',
      command: 'uvx',
      args: ['server-github'],
      env: row.env
    })
    expect(await needsReentry()).toContain('mcp:github:env.GITHUB_TOKEN')

    await send('PUT', `/api/v1/mcp/${created!.id}`, { name: 'gh' })
    expect(await needsReentry()).toContain('mcp:gh:env.GITHUB_TOKEN')
  })

  it('a header removed on purpose (no move) is not asked for, and a deleted server drops off', async () => {
    const id = await remote()
    await send('PUT', `/api/v1/mcp/${id}`, {
      headers: { 'X-Trace': 'yes-please' }
    })
    expect(await needsReentry()).toEqual([])

    const row = await shownMcp(id)
    await send('PUT', `/api/v1/mcp/${id}`, {
      name: row.name,
      transportType: 'sse',
      url: 'https://elsewhere.example.com/sse',
      headers: row.headers
    })
    expect(await needsReentry()).toContain('mcp:remote:headers.X-Trace')
    await send('DELETE', `/api/v1/mcp/${id}`)
    expect(await needsReentry()).toEqual([])
  })
})

describe('the re-entry file itself (S3 minors)', () => {
  it('a corrupt or mis-shaped file reads as nothing to re-enter, and never throws', async () => {
    const { writeFileSync } = await import('fs')
    const path = join(home, 'secrets-reentry.json')
    for (const body of [
      '{not json',
      '[]',
      JSON.stringify({ settings: 'providers.openaiApiKey', mcp: [] }),
      JSON.stringify({ settings: [1, 2], mcp: { x: 'y' } })
    ]) {
      writeFileSync(path, body)
      restart()
      await expect(needsReentry()).resolves.toEqual([])
    }
  })

  it('forgetAllMovedSecrets (a data reset) drops every prompt', async () => {
    const { forgetAllMovedSecrets } = await import('@main/lib/secrets/moved')
    const current = await shownSettings()
    await send('POST', '/api/v1/settings', {
      ...current,
      providers: {
        ...(current.providers as object),
        openaiBaseUrl: 'https://proxy.example/v1'
      }
    })
    expect(await needsReentry()).toContain('providers.openaiApiKey')
    forgetAllMovedSecrets()
    restart()
    expect(await needsReentry()).not.toContain('providers.openaiApiKey')
    expect(existsSync(join(home, 'secrets-reentry.json'))).toBe(false)
  })
})
