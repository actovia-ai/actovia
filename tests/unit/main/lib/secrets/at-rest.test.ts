// Secrets encrypted at rest (spec 2026-09-25 §2.3): every registry value in
// `settings` and every MCP secret is stored as `enc:v1:…` (safeStorage,
// faked), decrypted into the in-process cache; the startup migration is
// idempotent; an unavailable backend keeps plaintext; a ciphertext that no
// longer opens reads as unset and is listed for re-entry — and is never sent
// or overwritten by an unrelated save. Also the destination rule (ledger R1):
// a secret posted back as its mask while its destination changes is cleared.
// Real SQL on an in-memory PGlite.
import { isAppError } from '@exodus/shared/errors/app-error'
import { eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  fakeSafeStorageState,
  resetFakeSafeStorage
} from '../../../helpers/fake-safe-storage'

const info = vi.hoisted(() => vi.fn())
vi.mock('electron', async () => {
  const { fakeSafeStorage } = await import('../../../helpers/fake-safe-storage')
  return { app: { getPath: () => '/tmp' }, safeStorage: fakeSafeStorage }
})
vi.mock('@main/lib/logger', () => ({
  logger: { info, warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}))
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
const { settings: settingsTable, mcpServer } =
  await import('@main/lib/db/schema')
const queries = await import('@main/lib/db/queries')
const mcpQueries = await import('@main/lib/db/mcp-queries')
const { SETTINGS_SECRET_PATHS, SECRET_DESTINATIONS } =
  await import('@main/lib/secrets/registry')
const { maskSecret } = await import('@main/lib/secrets/mask')
const { ENC_PREFIX, resetEncryptionWarning } =
  await import('@main/lib/secrets/crypto')
const { encryptSecretsAtRest } = await import('@main/lib/secrets/migrate')
const { getSecretsStatus } = await import('@main/lib/secrets/status')
const { default: settingsRouter } =
  await import('@main/lib/server/routes/settings')

afterAll(async () => {
  await pglite.close()
})

type Tree = Record<string, unknown>

function getAt(obj: unknown, path: string): unknown {
  return path
    .split('.')
    .reduce<unknown>((o, k) => (o as Tree | null | undefined)?.[k], obj)
}

function setAt(obj: Tree, path: string, value: unknown) {
  const keys = path.split('.')
  let o = obj
  for (const k of keys.slice(0, -1)) {
    o[k] ??= {}
    o = o[k] as Tree
  }
  o[keys.at(-1)!] = value
}

const plain = (path: string) => `plaintext-${path}-SECRET-${path.length}`

async function rawSettings(): Promise<Tree> {
  const [row] = await db.select().from(settingsTable)
  return row as unknown as Tree
}

async function rawMcp() {
  return db.select().from(mcpServer)
}

/** Writes plaintext straight into the row, as a pre-S2 build left it. */
async function seedPlaintextRow() {
  await queries.getSettings()
  const row = await rawSettings()
  for (const p of SETTINGS_SECRET_PATHS) setAt(row, p, plain(p))
  const { id, createdAt, updatedAt, lastBackupAt, ...rest } = row
  void createdAt
  void updatedAt
  void lastBackupAt
  await db
    .update(settingsTable)
    .set(rest as never)
    .where((await import('drizzle-orm')).eq(settingsTable.id, id as string))
  queries.invalidateSettingsCache()
}

async function seedViaApi() {
  const s = (await queries.getSettings()) as unknown as Tree
  for (const p of SETTINGS_SECRET_PATHS) setAt(s, p, plain(p))
  await queries.updateSettings(s as never)
}

const MCP_ROW = {
  name: 'github',
  transportType: 'streamable-http',
  url: 'https://mcp.example.com/api',
  command: 'npx',
  env: { GITHUB_TOKEN: 'ghp_env_token_value_123456' },
  headers: { Authorization: 'Bearer header-token-value-7890' },
  extraConfig: { oauth: { clientSecret: 'oauth-client-secret-4567' } }
}
const MCP_SECRETS = [
  MCP_ROW.env.GITHUB_TOKEN,
  MCP_ROW.headers.Authorization,
  MCP_ROW.extraConfig.oauth.clientSecret
]

function buildApp() {
  const app = new Hono()
  app.use('*', async (c, next) => {
    c.set('settings' as never, (await queries.getSettings()) as never)
    await next()
  })
  app.route('/api/v1/settings', settingsRouter)
  app.onError((err, c) => {
    if (isAppError(err)) return c.json(err.toJSON(), err.statusCode as never)
    return c.json({ message: err.message }, 500)
  })
  return app
}

async function post(app: Hono, body: unknown) {
  return app.request('/api/v1/settings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })
}

beforeEach(async () => {
  resetFakeSafeStorage()
  resetEncryptionWarning()
  info.mockClear()
  await db.delete(mcpServer)
  await seedViaApi()
})

describe('settings at rest', () => {
  it('stores every registry secret as enc:v1:, never as plaintext', async () => {
    const row = await rawSettings()
    for (const p of SETTINGS_SECRET_PATHS) {
      expect(String(getAt(row, p)).startsWith(ENC_PREFIX)).toBe(true)
    }
    const text = JSON.stringify(row)
    for (const p of SETTINGS_SECRET_PATHS) expect(text).not.toContain(plain(p))
  })

  it('decrypts into the in-process settings', async () => {
    const s = await queries.getSettings()
    for (const p of SETTINGS_SECRET_PATHS) expect(getAt(s, p)).toBe(plain(p))
  })

  it('masks the plaintext (the real last four), not the ciphertext', async () => {
    const res = await buildApp().request('/api/v1/settings')
    const body = (await res.json()) as Tree
    expect(getAt(body, 'providers.openaiApiKey')).toBe(
      maskSecret(plain('providers.openaiApiKey'))
    )
  })

  it('an autosave posting masks back keeps each key (re-encrypted or not, it opens to the same)', async () => {
    const app = buildApp()
    const body = (await (await app.request('/api/v1/settings')).json()) as Tree
    expect((await post(app, body)).status).toBe(200)
    const s = await queries.getSettings()
    for (const p of SETTINGS_SECRET_PATHS) expect(getAt(s, p)).toBe(plain(p))
    const row = await rawSettings()
    for (const p of SETTINGS_SECRET_PATHS) {
      expect(String(getAt(row, p)).startsWith(ENC_PREFIX)).toBe(true)
    }
  })

  it('updateSettingField encrypts a secret column too', async () => {
    await queries.updateSettingField('webSearch', {
      braveApiKey: 'brave-new-key-000000000'
    })
    const row = await rawSettings()
    expect(
      String(getAt(row, 'webSearch.braveApiKey')).startsWith(ENC_PREFIX)
    ).toBe(true)
    expect(getAt(await queries.getSettings(), 'webSearch.braveApiKey')).toBe(
      'brave-new-key-000000000'
    )
  })
})

describe('startup migration', () => {
  it('encrypts plaintext settings and MCP values in place, logging counts only', async () => {
    await seedPlaintextRow()
    fakeSafeStorageState.available = false
    await mcpQueries.createMcpServer(MCP_ROW)
    fakeSafeStorageState.available = true
    expect(JSON.stringify(await rawMcp())).toContain(MCP_SECRETS[0])

    const counts = await encryptSecretsAtRest()
    // env, headers, the extraConfig secret — and the url (ruling b).
    expect(counts).toEqual({ settings: SETTINGS_SECRET_PATHS.length, mcp: 4 })

    const row = await rawSettings()
    for (const p of SETTINGS_SECRET_PATHS) {
      expect(String(getAt(row, p)).startsWith(ENC_PREFIX)).toBe(true)
    }
    const [mcp] = await rawMcp()
    expect(mcp.env!.GITHUB_TOKEN.startsWith(ENC_PREFIX)).toBe(true)
    expect(mcp.headers!.Authorization.startsWith(ENC_PREFIX)).toBe(true)
    expect(mcp.url!.startsWith(ENC_PREFIX)).toBe(true)
    expect(
      String(
        (mcp.extraConfig as { oauth: { clientSecret: string } }).oauth
          .clientSecret
      ).startsWith(ENC_PREFIX)
    ).toBe(true)
    const rawText = JSON.stringify({ row, mcp })
    for (const p of SETTINGS_SECRET_PATHS)
      expect(rawText).not.toContain(plain(p))
    for (const v of MCP_SECRETS) expect(rawText).not.toContain(v)

    const logged = JSON.stringify(info.mock.calls)
    for (const p of SETTINGS_SECRET_PATHS)
      expect(logged).not.toContain(plain(p))
    for (const v of MCP_SECRETS) expect(logged).not.toContain(v)

    // And the app still reads them.
    const s = await queries.getSettings()
    for (const p of SETTINGS_SECRET_PATHS) expect(getAt(s, p)).toBe(plain(p))
    const [read] = await mcpQueries.getAllMcpServers()
    expect(read.env).toEqual(MCP_ROW.env)
    expect(read.headers).toEqual(MCP_ROW.headers)
    expect(read.extraConfig).toEqual(MCP_ROW.extraConfig)
    expect(read.url).toBe(MCP_ROW.url)
  })

  it('is idempotent: a second run changes nothing', async () => {
    await seedPlaintextRow()
    await encryptSecretsAtRest()
    const before = JSON.stringify(await rawSettings())
    expect(await encryptSecretsAtRest()).toEqual({ settings: 0, mcp: 0 })
    expect(JSON.stringify(await rawSettings())).toBe(before)
  })

  it('keeps plaintext when safeStorage is unavailable, and says so', async () => {
    await seedPlaintextRow()
    fakeSafeStorageState.available = false
    expect(await encryptSecretsAtRest()).toEqual({ settings: 0, mcp: 0 })
    const row = await rawSettings()
    expect(getAt(row, 'providers.openaiApiKey')).toBe(
      plain('providers.openaiApiKey')
    )
    expect(getSecretsStatus().encryption).toBe('unavailable')
    const s = await queries.getSettings()
    expect(getAt(s, 'providers.openaiApiKey')).toBe(
      plain('providers.openaiApiKey')
    )
  })
})

describe('a ciphertext that no longer opens', () => {
  function onAnotherMachine() {
    fakeSafeStorageState.machine = 'machine-B'
    queries.invalidateSettingsCache()
  }

  it('reads as unset, is listed for re-entry, and is never handed out', async () => {
    onAnotherMachine()
    const s = await queries.getSettings()
    for (const p of SETTINGS_SECRET_PATHS) expect(getAt(s, p)).toBeNull()
    expect(getSecretsStatus().needsReentry).toEqual(
      expect.arrayContaining([...SETTINGS_SECRET_PATHS])
    )
    const res = await buildApp().request('/api/v1/settings')
    expect(await res.text()).not.toContain(ENC_PREFIX)
  })

  it('an unrelated save keeps the ciphertext (the notice stays until re-entry)', async () => {
    onAnotherMachine()
    const app = buildApp()
    const body = (await (await app.request('/api/v1/settings')).json()) as Tree
    setAt(body, 'providers.openaiBaseUrl', null)
    expect((await post(app, body)).status).toBe(200)
    const row = await rawSettings()
    for (const p of SETTINGS_SECRET_PATHS) {
      expect(String(getAt(row, p)).startsWith(ENC_PREFIX)).toBe(true)
    }
    await queries.getSettings()
    expect(getSecretsStatus().needsReentry).toContain('providers.openaiApiKey')
  })

  it('re-entering a key replaces it and takes it off the list', async () => {
    onAnotherMachine()
    const app = buildApp()
    const body = (await (await app.request('/api/v1/settings')).json()) as Tree
    setAt(body, 'providers.openaiApiKey', 'sk-re-entered-key-00000000')
    expect((await post(app, body)).status).toBe(200)
    const s = await queries.getSettings()
    expect(getAt(s, 'providers.openaiApiKey')).toBe(
      'sk-re-entered-key-00000000'
    )
    expect(getSecretsStatus().needsReentry).not.toContain(
      'providers.openaiApiKey'
    )
  })

  it('an MCP secret reads as unset and is listed by server', async () => {
    await mcpQueries.createMcpServer(MCP_ROW)
    fakeSafeStorageState.machine = 'machine-B'
    const [read] = await mcpQueries.getAllMcpServers()
    expect(read.env).toEqual({})
    expect(read.headers).toEqual({})
    expect(JSON.stringify(read)).not.toContain(ENC_PREFIX)
    expect(getSecretsStatus().needsReentry).toEqual(
      expect.arrayContaining([
        'mcp:github:env.GITHUB_TOKEN',
        'mcp:github:headers.Authorization',
        'mcp:github:extraConfig.oauth.clientSecret'
      ])
    )
  })
})

describe('GET /api/v1/settings/secrets-status', () => {
  it('reports encryption on and nothing to re-enter', async () => {
    const res = await buildApp().request('/api/v1/settings/secrets-status')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ encryption: 'on', needsReentry: [] })
  })

  it('reports what needs re-entering, MCP included', async () => {
    await mcpQueries.createMcpServer(MCP_ROW)
    fakeSafeStorageState.machine = 'machine-B'
    queries.invalidateSettingsCache()
    const res = await buildApp().request('/api/v1/settings/secrets-status')
    const body = (await res.json()) as { needsReentry: string[] }
    expect(body.needsReentry).toContain('providers.anthropicApiKey')
    expect(body.needsReentry).toContain('mcp:github:env.GITHUB_TOKEN')
  })

  it('reports an unavailable backend', async () => {
    fakeSafeStorageState.available = false
    const res = await buildApp().request('/api/v1/settings/secrets-status')
    expect(((await res.json()) as { encryption: string }).encryption).toBe(
      'unavailable'
    )
  })
})

describe('db-io export', () => {
  it('carries neither the plaintext nor the ciphertext', async () => {
    const blob = await queries.exportData('settings')
    const csv = await blob!.text()
    expect(csv).not.toContain(ENC_PREFIX)
    for (const p of SETTINGS_SECRET_PATHS) expect(csv).not.toContain(plain(p))
  })
})

describe('a destination change clears a secret posted back as its mask (R1)', () => {
  const pairs = Object.entries(SECRET_DESTINATIONS) as Array<
    [string, { field: string; fallback: string | null }]
  >

  it('covers every destination the ruling names', () => {
    expect(pairs.map(([k, d]) => [k, d.field]).toSorted()).toEqual(
      [
        ['knowledgeBase.apiKey', 'knowledgeBase.url'],
        ['providers.anthropicApiKey', 'providers.anthropicBaseUrl'],
        ['providers.azureOpenaiApiKey', 'providers.azureOpenAiEndpoint'],
        ['providers.googleGeminiApiKey', 'providers.googleGeminiBaseUrl'],
        ['providers.openaiApiKey', 'providers.openaiBaseUrl'],
        ['providers.xAiApiKey', 'providers.xAiBaseUrl']
      ].toSorted()
    )
  })

  async function withDestination(secret: string, dest: string, url: string) {
    const s = (await queries.getSettings()) as unknown as Tree
    setAt(s, dest, url)
    await queries.updateSettings(s as never)
    expect(getAt(await queries.getSettings(), secret)).toBe(plain(secret))
  }

  async function postWith(dest: string, url: string | null, secret?: string) {
    const app = buildApp()
    const body = (await (await app.request('/api/v1/settings')).json()) as Tree
    setAt(body, dest, url)
    if (secret) setAt(body, secret.split('=')[0], secret.split('=')[1])
    expect((await post(app, body)).status).toBe(200)
    return queries.getSettings()
  }

  it.each(pairs)(
    '%s is cleared when its destination moves',
    async (secret, { field }) => {
      await withDestination(secret, field, 'https://own.example.com/v1')
      const s = await postWith(field, 'https://attacker.example.net/v1')
      expect(getAt(s, secret)).toBeNull()
      expect(getAt(await rawSettings(), secret) ?? null).toBeNull()
    }
  )

  it.each(pairs)(
    '%s is kept when the destination only differs in form',
    async (secret, { field }) => {
      await withDestination(secret, field, 'https://own.example.com/v1')
      const s = await postWith(field, 'HTTPS://OWN.example.com/v1/')
      expect(getAt(s, secret)).toBe(plain(secret))
    }
  )

  it.each(pairs)(
    '%s is kept when the destination is unchanged',
    async (secret, { field }) => {
      await withDestination(secret, field, 'https://own.example.com/v1')
      const s = await postWith(field, 'https://own.example.com/v1')
      expect(getAt(s, secret)).toBe(plain(secret))
    }
  )

  it.each(pairs)(
    '%s: a new key typed with the new destination is stored',
    async (secret, { field }) => {
      await withDestination(secret, field, 'https://own.example.com/v1')
      const s = await postWith(
        field,
        'https://new.example.org/v1',
        `${secret}=typed-new-key-for-new-host-1`
      )
      expect(getAt(s, secret)).toBe('typed-new-key-for-new-host-1')
    }
  )

  it('a provider base URL set to its own default is not a move', async () => {
    const s = (await queries.getSettings()) as unknown as Tree
    setAt(s, 'providers.openaiBaseUrl', null)
    await queries.updateSettings(s as never)
    const after = await postWith(
      'providers.openaiBaseUrl',
      'https://api.openai.com/v1/'
    )
    expect(getAt(after, 'providers.openaiApiKey')).toBe(
      plain('providers.openaiApiKey')
    )
  })

  it('an undecryptable key whose destination moves is cleared too', async () => {
    fakeSafeStorageState.machine = 'machine-B'
    queries.invalidateSettingsCache()
    await postWith('knowledgeBase.url', 'https://elsewhere.example.net')
    expect(
      getAt(await rawSettings(), 'knowledgeBase.apiKey') ?? null
    ).toBeNull()
  })
})

describe('an MCP destination change clears the secrets posted back as masks', () => {
  async function put(id: string, body: unknown) {
    const { default: mcpRouter } = await import('@main/lib/server/routes/mcp')
    const app = new Hono()
    app.route('/api/v1/mcp', mcpRouter)
    return app.request(`/api/v1/mcp/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    })
  }

  it('a new url drops the masked headers and extraConfig secrets', async () => {
    const created = await mcpQueries.createMcpServer(MCP_ROW)
    const res = await put(created.id, {
      url: 'https://attacker.example.net/mcp',
      headers: { Authorization: maskSecret(MCP_ROW.headers.Authorization) },
      extraConfig: {
        oauth: {
          clientSecret: maskSecret(MCP_ROW.extraConfig.oauth.clientSecret)
        }
      }
    })
    expect(res.status).toBe(200)
    const read = await mcpQueries.getMcpServerById(created.id)
    expect(read.headers).toEqual({})
    expect(read.extraConfig).toEqual({ oauth: {} })
    expect(read.env).toEqual(MCP_ROW.env)
  })

  it('a new command drops the masked env values', async () => {
    const created = await mcpQueries.createMcpServer(MCP_ROW)
    await put(created.id, {
      command: 'some-other-binary',
      env: { GITHUB_TOKEN: maskSecret(MCP_ROW.env.GITHUB_TOKEN) }
    })
    const read = await mcpQueries.getMcpServerById(created.id)
    expect(read.env).toEqual({})
    expect(read.headers).toEqual(MCP_ROW.headers)
  })

  it('the same url in another form keeps them', async () => {
    const created = await mcpQueries.createMcpServer(MCP_ROW)
    await put(created.id, {
      url: 'HTTPS://MCP.example.com/api/',
      headers: { Authorization: maskSecret(MCP_ROW.headers.Authorization) }
    })
    const read = await mcpQueries.getMcpServerById(created.id)
    expect(read.headers).toEqual(MCP_ROW.headers)
  })
})

describe('secrets nested under a secret-named key (review S1 M2)', () => {
  it('are stored encrypted, and read back as they were', async () => {
    const created = await mcpQueries.createMcpServer({
      name: 'nested',
      transportType: 'sse',
      url: 'https://mcp.example.com',
      extraConfig: {
        tokens: {
          access: 'nested-access-token-JJJJ',
          list: ['one-token-KKKK'],
          pin: 48151623
        },
        timeout: 30
      }
    })
    const [raw] = await db
      .select()
      .from(mcpServer)
      .where(eq(mcpServer.id, created.id))
    const stored = JSON.stringify(raw!.extraConfig)
    expect(stored).not.toContain('nested-access-token-JJJJ')
    expect(stored).not.toContain('one-token-KKKK')
    // A number under a secret-named key is sealed too, and opens as a number.
    expect(stored).not.toContain('48151623')
    expect(stored).toContain(ENC_PREFIX)

    const read = await mcpQueries.getMcpServerById(created.id)
    expect(read!.extraConfig).toEqual({
      tokens: {
        access: 'nested-access-token-JJJJ',
        list: ['one-token-KKKK'],
        pin: 48151623
      },
      timeout: 30
    })
  })

  it('a string secret that looks like the number marker opens as that string (S1 M-c)', async () => {
    const created = await mcpQueries.createMcpServer({
      name: 'marker-lookalike',
      transportType: 'stdio',
      command: 'node',
      env: { WEIRD: 'exodus-number:7', OTHER: 'exodus-string:x' },
      extraConfig: { apiKey: 'exodus-number:42', pin: 42 }
    })
    const read = await mcpQueries.getMcpServerById(created.id)
    expect(read!.env).toEqual({
      WEIRD: 'exodus-number:7',
      OTHER: 'exodus-string:x'
    })
    expect(read!.extraConfig).toEqual({ apiKey: 'exodus-number:42', pin: 42 })
  })
})
