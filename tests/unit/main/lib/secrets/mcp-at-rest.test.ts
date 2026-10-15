// S2 fix round 1: MCP `url` / `args` encrypted at rest (ruling b); extraConfig
// url / endpoint / host / issuer values are part of the MCP destination
// (ruling a); a Keychain that refuses to encrypt fails the save with a clear,
// value-free message, logged once (M2). Real SQL on an in-memory PGlite,
// safeStorage faked.
import { isAppError } from '@exodus/shared/errors/app-error'
import { eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  fakeSafeStorageState,
  resetFakeSafeStorage
} from '../../../helpers/fake-safe-storage'

const logged = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn()
}))
vi.mock('electron', async () => {
  const { fakeSafeStorage } = await import('../../../helpers/fake-safe-storage')
  return { app: { getPath: () => '/tmp' }, safeStorage: fakeSafeStorage }
})
vi.mock('@main/lib/logger', () => ({ logger: logged }))
vi.mock('@main/lib/db/db', async () => {
  const { drizzle } = await import('drizzle-orm/pglite')
  const { createMigratedPglite } =
    await import('../../../helpers/migrated-pglite')
  const pglite = await createMigratedPglite('9999')
  return { pglite, db: drizzle(pglite) }
})
vi.mock('@main/lib/ai/mcp', () => ({
  getMcpTools: vi.fn(async () => []),
  invalidateAllMcpCache: vi.fn(),
  invalidateMcpCache: vi.fn()
}))
vi.mock('@main/lib/ai/providers/list-models', () => ({
  listModelsByProvider: {}
}))

const { pglite, db } = await import('@main/lib/db/db')
const { mcpServer, settings: settingsTable } =
  await import('@main/lib/db/schema')
const mcpQueries = await import('@main/lib/db/mcp-queries')
const queries = await import('@main/lib/db/queries')
const { ENC_PREFIX, resetEncryptionWarning } =
  await import('@main/lib/secrets/crypto')
const { encryptSecretsAtRest } = await import('@main/lib/secrets/migrate')
const { default: mcpRouter } = await import('@main/lib/server/routes/mcp')
const { default: settingsRouter } =
  await import('@main/lib/server/routes/settings')

afterAll(async () => {
  await pglite.close()
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

async function rawRow(id: string) {
  const [row] = await db.select().from(mcpServer).where(eq(mcpServer.id, id))
  return row!
}

const URL_SECRET = 'https://mcp.example.com/cap9f8e7d6c5b4a3210abcdefXYZ/sse'
const ARGS = ['-y', 'some-mcp', '--api-key=arg-secret-value-7777']
const OAUTH = {
  clientId: 'public-client-id',
  clientSecret: 'oauth-client-secret-4567',
  issuer: 'https://auth.example.com',
  tokenUrl: 'https://auth.example.com/oauth/token'
}
const ROW = {
  name: 'remote',
  transportType: 'streamable-http',
  url: URL_SECRET,
  command: 'npx',
  args: ARGS,
  headers: { Authorization: 'Bearer header-token-value-7890' },
  extraConfig: { oauth: OAUTH }
}

beforeEach(async () => {
  resetFakeSafeStorage()
  resetEncryptionWarning()
  for (const fn of Object.values(logged)) fn.mockClear()
  await db.delete(mcpServer)
})

describe('MCP url and args at rest (ruling b)', () => {
  it('are stored as enc:v1:, args as a whole, and read back as they were', async () => {
    const created = await mcpQueries.createMcpServer(ROW)
    const raw = await rawRow(created.id)
    expect(raw.url!.startsWith(ENC_PREFIX)).toBe(true)
    expect(typeof raw.args).toBe('string')
    expect((raw.args as unknown as string).startsWith(ENC_PREFIX)).toBe(true)
    const text = JSON.stringify(raw)
    expect(text).not.toContain('cap9f8e7d6c5b4a3210abcdefXYZ')
    expect(text).not.toContain('arg-secret-value-7777')
    expect(text).not.toContain('some-mcp')

    const read = await mcpQueries.getMcpServerById(created.id)
    expect(read!.url).toBe(URL_SECRET)
    expect(read!.args).toEqual(ARGS)
  })

  it('an update re-encrypts them', async () => {
    const created = await mcpQueries.createMcpServer(ROW)
    await mcpQueries.updateMcpServer(created.id, {
      url: 'https://other.example.com/sse',
      args: ['--token', 'tok-new-value-0000']
    })
    const raw = await rawRow(created.id)
    expect(raw.url!.startsWith(ENC_PREFIX)).toBe(true)
    expect(JSON.stringify(raw)).not.toContain('tok-new-value-0000')
    const read = await mcpQueries.getMcpServerById(created.id)
    expect(read!.args).toEqual(['--token', 'tok-new-value-0000'])
  })

  it('the startup migration encrypts a pre-S2 url and args', async () => {
    fakeSafeStorageState.available = false
    const created = await mcpQueries.createMcpServer(ROW)
    fakeSafeStorageState.available = true
    expect((await rawRow(created.id)).url).toBe(URL_SECRET)
    expect((await rawRow(created.id)).args).toEqual(ARGS)

    await encryptSecretsAtRest()
    const raw = await rawRow(created.id)
    expect(raw.url!.startsWith(ENC_PREFIX)).toBe(true)
    expect(JSON.stringify(raw.args)).not.toContain('arg-secret-value-7777')
    expect((await mcpQueries.getMcpServerById(created.id))!.args).toEqual(ARGS)
  })

  it('an unset url / empty args stay as they are', async () => {
    const created = await mcpQueries.createMcpServer({
      name: 'stdio',
      command: 'uvx',
      args: []
    })
    const raw = await rawRow(created.id)
    expect(raw.url).toBeNull()
    expect(raw.args).toEqual([])
  })

  it('a url that no longer decrypts reads as unset and is listed', async () => {
    const created = await mcpQueries.createMcpServer(ROW)
    fakeSafeStorageState.machine = 'machine-B'
    const read = await mcpQueries.getMcpServerById(created.id)
    expect(read!.url).toBeNull()
    expect(read!.args).toEqual([])
    expect(JSON.stringify(read)).not.toContain(ENC_PREFIX)
  })

  it('the API masks the decrypted url and args, never the ciphertext', async () => {
    await mcpQueries.createMcpServer(ROW)
    const res = await send('GET', '/api/v1/mcp')
    const text = await res.text()
    expect(text).not.toContain(ENC_PREFIX)
    expect(text).not.toContain('arg-secret-value-7777')
    expect(text).toContain('mcp.example.com')
    expect(text).toContain('--api-key=')
  })
})

describe('extraConfig url / endpoint / host / issuer are part of the destination (ruling a)', () => {
  async function shown(id: string) {
    const res = await send('GET', '/api/v1/mcp')
    const list = (await res.json()) as Array<Record<string, unknown>>
    return list.find((s) => s.id === id)!
  }

  it('the form posting back everything it was shown moves nothing', async () => {
    const created = await mcpQueries.createMcpServer(ROW)
    const { id: _id, createdAt, updatedAt, ...body } = await shown(created.id)
    void _id
    void createdAt
    void updatedAt
    expect((await send('PUT', `/api/v1/mcp/${created.id}`, body)).status).toBe(
      200
    )
    const read = await mcpQueries.getMcpServerById(created.id)
    expect(read!.headers).toEqual(ROW.headers)
    expect(read!.extraConfig).toEqual(ROW.extraConfig)
    expect(read!.url).toBe(URL_SECRET)
  })

  it.each([
    ['issuer', { issuer: 'https://evil.example.net' }],
    ['tokenUrl', { tokenUrl: 'https://evil.example.net/token' }]
  ])(
    'a new oauth.%s clears headers and the extraConfig secrets',
    async (_key, change) => {
      const created = await mcpQueries.createMcpServer(ROW)
      const shownRow = await shown(created.id)
      const oauth = {
        ...((shownRow.extraConfig as { oauth: object }).oauth as object),
        ...change
      }
      await send('PUT', `/api/v1/mcp/${created.id}`, {
        extraConfig: { oauth }
      })
      const read = await mcpQueries.getMcpServerById(created.id)
      expect(read!.headers).toEqual({})
      expect(
        (read!.extraConfig as { oauth: Record<string, unknown> }).oauth
          .clientSecret
      ).toBeUndefined()
      expect(JSON.stringify(read)).not.toContain(OAUTH.clientSecret)
    }
  )

  it('a new endpoint / host value nested anywhere counts too', async () => {
    const created = await mcpQueries.createMcpServer({
      ...ROW,
      extraConfig: { proxy: { host: 'proxy.internal' }, apiKey: 'xc-key-AAAA' }
    })
    await send('PUT', `/api/v1/mcp/${created.id}`, {
      extraConfig: { proxy: { host: 'proxy.evil.net' }, apiKey: '••••' }
    })
    const read = await mcpQueries.getMcpServerById(created.id)
    expect(read!.headers).toEqual({})
    expect(read!.extraConfig).toEqual({ proxy: { host: 'proxy.evil.net' } })
  })

  it.each([
    ['token_uri', 'https://oauth2.googleapis.com/token'],
    ['jwks_uri', 'https://auth.example.com/.well-known/jwks.json'],
    ['authority', 'https://login.microsoftonline.com/tenant'],
    ['domain', 'tenant.auth0.com']
  ])('a new extraConfig %s counts as a move too', async (key, value) => {
    const created = await mcpQueries.createMcpServer({
      ...ROW,
      extraConfig: { auth: { [key]: value }, apiKey: 'xc-key-BBBB-0000' }
    })
    await send('PUT', `/api/v1/mcp/${created.id}`, {
      extraConfig: {
        auth: { [key]: 'https://evil.example.net/x' },
        apiKey: '••••'
      }
    })
    const read = await mcpQueries.getMcpServerById(created.id)
    expect(read!.headers).toEqual({})
    expect(read!.extraConfig).toEqual({
      auth: { [key]: 'https://evil.example.net/x' }
    })
  })

  it('the same issuer in another form is no move', async () => {
    const created = await mcpQueries.createMcpServer(ROW)
    const shownRow = await shown(created.id)
    const oauth = {
      ...((shownRow.extraConfig as { oauth: object }).oauth as object),
      issuer: 'HTTPS://AUTH.example.com/'
    }
    await send('PUT', `/api/v1/mcp/${created.id}`, { extraConfig: { oauth } })
    const read = await mcpQueries.getMcpServerById(created.id)
    expect(read!.headers).toEqual(ROW.headers)
    expect(
      (read!.extraConfig as { oauth: Record<string, unknown> }).oauth
        .clientSecret
    ).toBe(OAUTH.clientSecret)
  })
})

describe('a Keychain that refuses to encrypt (M2)', () => {
  const KEY = 'sk-typed-while-denied-12345678'

  it('fails the settings save with a clear message, stores nothing, logs once', async () => {
    const before = JSON.stringify(
      (await db.select().from(settingsTable))[0] ?? null
    )
    fakeSafeStorageState.denyEncrypt = true
    const s = (await queries.getSettings()) as unknown as Record<
      string,
      Record<string, unknown>
    >
    s.providers = { ...s.providers, openaiApiKey: KEY }
    for (let i = 0; i < 2; i++) {
      const res = await send('POST', '/api/v1/settings', s)
      expect(res.status).toBeGreaterThanOrEqual(400)
      const text = await res.text()
      expect(text).toMatch(/keychain/iu)
      expect(text).not.toContain(KEY)
    }
    expect(JSON.stringify((await db.select().from(settingsTable))[0])).toBe(
      before
    )
    await vi.waitFor(() => expect(logged.error).toHaveBeenCalled())
    const calls = logged.error.mock.calls.filter((c) =>
      /keychain/iu.test(String(c[1]))
    )
    expect(calls).toHaveLength(1)
    // As the logger writes them: an Error's message and stack included.
    const { writtenBy } = await import('../../../helpers/logged')
    expect(writtenBy(logged.error.mock.calls)).not.toContain(KEY)
  })

  it('fails an MCP save with the same message, not a generic one', async () => {
    fakeSafeStorageState.denyEncrypt = true
    const res = await send('POST', '/api/v1/mcp', ROW)
    expect(res.status).toBeGreaterThanOrEqual(400)
    const text = await res.text()
    expect(text).toMatch(/keychain/iu)
    expect(text).not.toContain(ROW.headers.Authorization)
    expect(await db.select().from(mcpServer)).toEqual([])
  })
})

describe('knownSecretValues (what the logs copy scrubs)', () => {
  it('lists the settings secrets and every MCP secret, in plaintext', async () => {
    const s = (await queries.getSettings()) as unknown as Record<
      string,
      Record<string, unknown>
    >
    s.providers = {
      ...s.providers,
      anthropicApiKey: 'sk-ant-known-1111'
    }
    await queries.updateSettings(s as never)
    await mcpQueries.createMcpServer(ROW)
    const { knownSecretValues } = await import('@main/lib/secrets/known')
    const values = await knownSecretValues()
    expect(values).toEqual(
      expect.arrayContaining([
        'sk-ant-known-1111',
        ROW.headers.Authorization,
        OAUTH.clientSecret
      ])
    )
    expect(values).not.toContain(OAUTH.clientId)
    expect(values.some((v) => v.startsWith(ENC_PREFIX))).toBe(false)
  })
})
