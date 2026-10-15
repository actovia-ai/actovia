// Re-review S2 r2: a save never unlocks what it could not decrypt, and never
// writes a key in the clear.
//
// R2-1: a save that does not move a value's destination keeps the stored
//   ciphertext of anything that failed to decrypt — posted back as a mask,
//   left unset, or as the `[]` / `null` / absent key the API showed for it.
//   Undecryptable url / args are replaced only by a real value. The
//   rename-and-save reproducer: an args-lost `bash -c` server stays skipped,
//   and no transport is ever built.
// R2-2: fail closed. With encryption unavailable (here: a new OSCrypt tag
//   that still opens the old one — the self-check fails), a mask or an unset
//   value keeps the stored RAW value; the plaintext of an envelope is never
//   written. A new key typed then is stored as typed (the notice says so).
//
// Real SQL on an in-memory PGlite, the real routes and MCP connect code;
// safeStorage is faked and the SDK transports mocked.
import { isAppError } from '@exodus/shared/errors/app-error'
import { eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  fakeSafeStorageState,
  resetFakeSafeStorage
} from '../../../helpers/fake-safe-storage'

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
const transports = vi.hoisted(() => ({
  stdio: vi.fn(),
  http: vi.fn(),
  sse: vi.fn()
}))
vi.mock('@modelcontextprotocol/sdk/client/stdio.js', () => ({
  StdioClientTransport: transports.stdio
}))
vi.mock('@modelcontextprotocol/sdk/client/streamableHttp.js', () => ({
  StreamableHTTPClientTransport: transports.http
}))
vi.mock('@modelcontextprotocol/sdk/client/sse.js', () => ({
  SSEClientTransport: transports.sse
}))
vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: vi.fn().mockImplementation(function () {
    return {
      connect: vi.fn(async () => {}),
      listTools: vi.fn(async () => ({ tools: [] })),
      close: vi.fn(async () => {})
    }
  })
}))

const { pglite, db } = await import('@main/lib/db/db')
const { mcpServer, settings: settingsTable } =
  await import('@main/lib/db/schema')
const mcpQueries = await import('@main/lib/db/mcp-queries')
const queries = await import('@main/lib/db/queries')
const { ENC_PREFIX, resetEncryptionWarning, encryptionState } =
  await import('@main/lib/secrets/crypto')
const { mcpDecryptFailures } = await import('@main/lib/secrets/at-rest')
const mcp = await import('@main/lib/ai/mcp')
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

async function shown(id: string): Promise<Record<string, unknown>> {
  const list = (await (await send('GET', '/api/v1/mcp')).json()) as Array<
    Record<string, unknown>
  >
  return list.find((s) => s.id === id)!
}

/** What the desktop form posts on save (`mcp-servers.tsx`), from what it showed. */
function formPayload(row: Record<string, unknown>, over = {}) {
  const extra = row.extraConfig as Record<string, unknown> | null
  const base: Record<string, unknown> = {
    name: row.name,
    description: row.description || null,
    transportType: row.transportType,
    extraConfig: extra && Object.keys(extra).length > 0 ? extra : null
  }
  if (row.transportType === 'stdio') {
    base.command = row.command
    base.args = row.args
    base.env = row.env && Object.keys(row.env).length > 0 ? row.env : null
  } else {
    base.url = row.url
    base.headers = row.headers
  }
  return { ...base, ...over }
}

function onAnotherMachine() {
  fakeSafeStorageState.machine = 'machine-B'
  queries.invalidateSettingsCache()
}

beforeEach(async () => {
  resetFakeSafeStorage()
  resetEncryptionWarning()
  for (const t of Object.values(transports)) t.mockClear()
  await mcp.invalidateAllMcpCache()
  await db.delete(mcpServer)
})

describe('R2-1: a save never unlocks a row it cannot decrypt', () => {
  it('rename-and-save of an args-lost bash -c server: still skipped, no transport', async () => {
    const created = await mcpQueries.createMcpServer({
      name: 'shell',
      transportType: 'stdio',
      command: 'bash',
      args: ['-c', 'exec my-mcp --token=tok-lost-0123456789'],
      isActive: true
    })
    const before = await rawRow(created.id)
    onAnotherMachine()
    const row = await shown(created.id)
    expect(row.args).toEqual([])

    const res = await send(
      'PUT',
      `/api/v1/mcp/${created.id}`,
      formPayload(row, { name: 'shell-renamed' })
    )
    expect(res.status).toBe(200)
    const after = await rawRow(created.id)
    expect(after.args).toEqual(before.args)
    expect(after.name).toBe('shell-renamed')
    expect(
      mcpDecryptFailures((await mcpQueries.getMcpServerById(created.id))!)
    ).toContain('args')
    expect(await mcp.getMcpTools()).toEqual([])
    for (const t of Object.values(transports)) expect(t).not.toHaveBeenCalled()
  })

  it('args typed again replace the lost ones and the server connects', async () => {
    const created = await mcpQueries.createMcpServer({
      name: 'shell',
      command: 'bash',
      args: ['-c', 'x --token=tok-lost-0123456789'],
      isActive: true
    })
    onAnotherMachine()
    const row = await shown(created.id)
    await send(
      'PUT',
      `/api/v1/mcp/${created.id}`,
      formPayload(row, { args: ['-c', 'exec my-mcp'] })
    )
    const read = (await mcpQueries.getMcpServerById(created.id))!
    expect(read.args).toEqual(['-c', 'exec my-mcp'])
    expect(mcpDecryptFailures(read)).toEqual([])
  })

  it('a url-lost remote server saved with null keeps its url ciphertext', async () => {
    const created = await mcpQueries.createMcpServer({
      name: 'remote',
      transportType: 'sse',
      url: 'https://mcp.example.com/sse',
      isActive: true
    })
    const before = await rawRow(created.id)
    onAnotherMachine()
    await send('PUT', `/api/v1/mcp/${created.id}`, {
      name: 'remote-2',
      url: null
    })
    expect((await rawRow(created.id)).url).toBe(before.url)
    expect(await mcp.getMcpTools()).toEqual([])
  })

  it('undecryptable header / env / extraConfig leaves survive an unrelated save', async () => {
    const remote = await mcpQueries.createMcpServer({
      name: 'remote',
      transportType: 'streamable-http',
      url: 'https://mcp.example.com/mcp',
      headers: {
        Authorization: 'Bearer header-lost-0123456789',
        'X-Team': 'a'
      },
      extraConfig: {
        oauth: { clientId: 'cid', clientSecret: 'cs-lost-01234567' }
      }
    })
    const local = await mcpQueries.createMcpServer({
      name: 'local',
      command: 'uvx',
      args: ['srv'],
      env: { API_TOKEN: 'env-lost-0123456789' }
    })
    const beforeRemote = await rawRow(remote.id)
    const beforeLocal = await rawRow(local.id)
    // Only the secret leaves are lost: re-seal the row's url / args /
    // plain header on machine B so they read, as after a partial re-entry.
    onAnotherMachine()
    await db
      .update(mcpServer)
      .set({ url: 'https://mcp.example.com/mcp' })
      .where(eq(mcpServer.id, remote.id))
    await db
      .update(mcpServer)
      .set({ args: ['srv'] })
      .where(eq(mcpServer.id, local.id))

    await send(
      'PUT',
      `/api/v1/mcp/${remote.id}`,
      formPayload(await shown(remote.id), { description: 'x' })
    )
    await send(
      'PUT',
      `/api/v1/mcp/${local.id}`,
      formPayload(await shown(local.id), { description: 'y' })
    )

    const r = await rawRow(remote.id)
    expect(r.headers!.Authorization).toBe(beforeRemote.headers!.Authorization)
    expect(
      (r.extraConfig as { oauth: { clientSecret: string } }).oauth.clientSecret
    ).toBe(
      (beforeRemote.extraConfig as { oauth: { clientSecret: string } }).oauth
        .clientSecret
    )
    expect((await rawRow(local.id)).env!.API_TOKEN).toBe(
      beforeLocal.env!.API_TOKEN
    )
  })

  it('lost leaves under a dotted key, and a lost array item, come back where they were (S2 M-1)', async () => {
    const { encryptSecret } = await import('@main/lib/secrets/crypto')
    const created = await mcpQueries.createMcpServer({
      name: 'remote',
      transportType: 'streamable-http',
      url: 'https://mcp.example.com/mcp',
      extraConfig: {
        'svc.v1': { apiKey: 'dotted-lost-0123456789' },
        tokens: ['array-lost-a-0123456', 'array-b-old-0123456']
      }
    })
    const before = await rawRow(created.id)
    const beforeExtra = before.extraConfig as {
      'svc.v1': { apiKey: string }
      tokens: string[]
    }
    onAnotherMachine()
    // Machine B can read the url and the array's second item (re-entered
    // there); the dotted key and the first item stay lost.
    const bItem = encryptSecret('array-b-new-0123456')
    await db
      .update(mcpServer)
      .set({
        url: 'https://mcp.example.com/mcp',
        extraConfig: {
          'svc.v1': beforeExtra['svc.v1'],
          tokens: [beforeExtra.tokens[0], bItem]
        }
      })
      .where(eq(mcpServer.id, created.id))

    const res = await send(
      'PUT',
      `/api/v1/mcp/${created.id}`,
      formPayload(await shown(created.id), { description: 'x' })
    )
    expect(res.status).toBe(200)
    const after = (await rawRow(created.id)).extraConfig as {
      'svc.v1': { apiKey: string }
      tokens: string[]
      svc?: unknown
    }
    // Under the dotted key itself, not a nested `svc: { v1: … }`.
    expect(after['svc.v1'].apiKey).toBe(beforeExtra['svc.v1'].apiKey)
    expect(after.svc).toBeUndefined()
    // The lost item back at index 0, the readable one kept as stored after it.
    expect(after.tokens).toEqual([beforeExtra.tokens[0], bItem])
  })

  it('a moved destination still clears an undecryptable header', async () => {
    const created = await mcpQueries.createMcpServer({
      name: 'remote',
      transportType: 'streamable-http',
      url: 'https://mcp.example.com/mcp',
      headers: { Authorization: 'Bearer header-lost-0123456789' }
    })
    onAnotherMachine()
    await db
      .update(mcpServer)
      .set({ url: 'https://mcp.example.com/mcp' })
      .where(eq(mcpServer.id, created.id))
    await send('PUT', `/api/v1/mcp/${created.id}`, {
      url: 'https://elsewhere.example.net/mcp',
      headers: {}
    })
    expect((await rawRow(created.id)).headers).toEqual({})
  })
})

describe('R2-2: fail closed while encryption is unavailable', () => {
  function newTagThatOpensTheOld() {
    fakeSafeStorageState.tag = 'v20'
    fakeSafeStorageState.alsoOpens = ['v10']
    resetEncryptionWarning()
    queries.invalidateSettingsCache()
  }

  it('a settings save posting masks back keeps every envelope', async () => {
    const s = (await queries.getSettings()) as unknown as Record<
      string,
      Record<string, unknown>
    >
    s.providers = {
      ...s.providers,
      openaiApiKey: 'sk-live-openai-0123456789',
      anthropicApiKey: 'sk-ant-live-0123456789'
    }
    await queries.updateSettings(s as never)
    const [before] = await db.select().from(settingsTable)
    newTagThatOpensTheOld()
    expect(encryptionState()).toBe('unavailable')
    // Still readable in-process.
    expect((await queries.getSettings()).providers?.openaiApiKey).toBe(
      'sk-live-openai-0123456789'
    )

    const body = (await (
      await send('GET', '/api/v1/settings')
    ).json()) as Record<string, Record<string, unknown>>
    body.providers.anthropicApiKey = 'sk-ant-typed-now-99999999'
    expect((await send('POST', '/api/v1/settings', body)).status).toBe(200)

    const [after] = await db.select().from(settingsTable)
    const text = JSON.stringify(after)
    expect(text).not.toContain('sk-live-openai-0123456789')
    expect(after!.providers!.openaiApiKey).toBe(before!.providers!.openaiApiKey)
    expect(after!.providers!.openaiApiKey!.startsWith(ENC_PREFIX)).toBe(true)
    // A NEW key typed while unavailable is stored as typed (the notice says).
    expect(after!.providers!.anthropicApiKey).toBe('sk-ant-typed-now-99999999')
  })

  it('an MCP save posting masks back keeps every envelope', async () => {
    const created = await mcpQueries.createMcpServer({
      name: 'remote',
      transportType: 'streamable-http',
      url: 'https://mcp.example.com/cap0123456789abcdefXYZ0123/mcp',
      headers: { Authorization: 'Bearer header-live-0123456789' },
      extraConfig: { oauth: { clientSecret: 'cs-live-0123456789' } }
    })
    const before = await rawRow(created.id)
    newTagThatOpensTheOld()
    const row = await shown(created.id)
    await send(
      'PUT',
      `/api/v1/mcp/${created.id}`,
      formPayload(row, { description: 'z' })
    )

    const after = await rawRow(created.id)
    const text = JSON.stringify(after)
    for (const v of [
      'header-live-0123456789',
      'cs-live-0123456789',
      'cap0123456789abcdefXYZ0123'
    ]) {
      expect(text).not.toContain(v)
    }
    expect(after.url).toBe(before.url)
    expect(after.headers).toEqual(before.headers)
    expect(after.extraConfig).toEqual(before.extraConfig)
  })
})
