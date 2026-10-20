// The settings API hands out masks only (spec 2026-09-25 §2.2): GET
// /api/v1/settings masks every registry field, a posted mask means
// "unchanged", null / "" clear, anything else sets, and list-models swaps a
// posted mask for the stored key. Real SQL on an in-memory PGlite; the
// in-process `getSettings()` keeps returning plaintext.
import { isAppError } from '@actovia/shared/errors/app-error'
import { AiProviders } from '@actovia/shared/types/ai'
import { Hono } from 'hono'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getPath: () => '/tmp' } }))
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
const listOpenAiModels = vi.hoisted(() => vi.fn(async () => []))
vi.mock('@main/lib/ai/providers/list-models', () => ({
  listModelsByProvider: { 'OpenAI GPT': listOpenAiModels }
}))

const { pglite } = await import('@main/lib/db/db')
const queries = await import('@main/lib/db/queries')
const {
  SETTINGS_SECRET_PATHS,
  API_MASKED_SETTINGS_PATHS,
  API_PLAINTEXT_EXCEPTIONS
} = await import('@main/lib/secrets/registry')
const { maskSecret } = await import('@main/lib/secrets/mask')
const { default: settingsRouter } =
  await import('@main/lib/server/routes/settings')

afterAll(async () => {
  await pglite.close()
})

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

/** A distinct, 12+-character plaintext per registry field. */
const plain = (path: string) => `plaintext-${path}-SECRET-${path.length}`

async function seedAll() {
  const s = (await queries.getSettings()) as unknown as Tree
  for (const p of SETTINGS_SECRET_PATHS) setAt(s, p, plain(p))
  await queries.updateSettings(s as never)
}

async function getJson(app: Hono) {
  const res = await app.request('/api/v1/settings')
  expect(res.status).toBe(200)
  return { text: await res.clone().text(), body: (await res.json()) as Tree }
}

async function post(app: Hono, body: unknown) {
  return app.request('/api/v1/settings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })
}

beforeEach(async () => {
  await seedAll()
  listOpenAiModels.mockClear()
})

describe('GET /api/v1/settings', () => {
  it.each(API_MASKED_SETTINGS_PATHS)('masks %s', async (path) => {
    const { text, body } = await getJson(buildApp())
    expect(getAt(body, path)).toBe(maskSecret(plain(path)))
    expect(text).not.toContain(plain(path))
  })

  it('makes no exception — the Google Maps key is masked too (I5)', async () => {
    // Pinned so an exception is a deliberate change: the map card gets its
    // key over IPC and its photos through /api/v1/maps/photo.
    expect(Object.keys(API_PLAINTEXT_EXCEPTIONS)).toEqual([])
    const { text, body } = await getJson(buildApp())
    expect(getAt(body, 'googleCloud.googleApiKey')).toBe(
      maskSecret(plain('googleCloud.googleApiKey'))
    )
    expect(text).not.toContain(plain('googleCloud.googleApiKey'))
  })

  it('every registry value read from the row is masked in log lines (M4)', async () => {
    const { maskLogText } = await import('@main/lib/logger/secret-mask')
    queries.invalidateSettingsCache()
    await queries.getSettings()
    for (const p of SETTINGS_SECRET_PATHS) {
      const v = plain(p)
      if (v.length < 8) continue
      expect(maskLogText(`failed with ${v}`)).not.toContain(v)
    }
  })

  it('leaves the in-process settings in plaintext', async () => {
    const s = await queries.getSettings()
    for (const p of SETTINGS_SECRET_PATHS) expect(getAt(s, p)).toBe(plain(p))
  })

  it('keeps an unset secret unset', async () => {
    const s = (await queries.getSettings()) as unknown as Tree
    setAt(s, 'providers.xAiApiKey', null)
    await queries.updateSettings(s as never)
    const { body } = await getJson(buildApp())
    expect(getAt(body, 'providers.xAiApiKey')).toBeNull()
  })
})

describe('POST /api/v1/settings', () => {
  it('the autosave posting back everything it was given changes no secret', async () => {
    const app = buildApp()
    const { body } = await getJson(app)
    const res = await post(app, body)
    expect(res.status).toBe(200)
    const text = await res.text()
    for (const p of SETTINGS_SECRET_PATHS) expect(text).not.toContain(plain(p))

    const s = await queries.getSettings()
    for (const p of SETTINGS_SECRET_PATHS) expect(getAt(s, p), p).toBe(plain(p))
  })

  it('the autosave posting the whole providers section with masks keeps every key', async () => {
    const app = buildApp()
    const { body } = await getJson(app)
    // A non-secret edit alongside: the providers page changing a base URL.
    // That moves the OpenAI key's destination, so its mask clears it (ledger
    // ruling R1, tested pair by pair in at-rest.test.ts); every other key stays.
    ;(body.providers as Tree).openaiBaseUrl = 'https://proxy.example.com/v1'
    await post(app, body)

    const s = await queries.getSettings()
    expect(s.providers?.openaiBaseUrl).toBe('https://proxy.example.com/v1')
    expect(s.providers?.openaiApiKey).toBeNull()
    for (const p of SETTINGS_SECRET_PATHS.filter(
      (path) =>
        path.startsWith('providers.') && path !== 'providers.openaiApiKey'
    )) {
      expect(getAt(s, p), p).toBe(plain(p))
    }
  })

  it.each(SETTINGS_SECRET_PATHS)('sets a new %s', async (path) => {
    const app = buildApp()
    const { body } = await getJson(app)
    setAt(body, path, 'a-brand-new-secret-value-42')
    await post(app, body)
    const s = await queries.getSettings()
    expect(getAt(s, path)).toBe('a-brand-new-secret-value-42')
  })

  it.each(SETTINGS_SECRET_PATHS)('clears %s with null', async (path) => {
    const app = buildApp()
    const { body } = await getJson(app)
    setAt(body, path, null)
    await post(app, body)
    expect(getAt(await queries.getSettings(), path)).toBeNull()
  })

  it.each(SETTINGS_SECRET_PATHS)('clears %s with ""', async (path) => {
    const app = buildApp()
    const { body } = await getJson(app)
    setAt(body, path, '')
    await post(app, body)
    expect(getAt(await queries.getSettings(), path)).toBe('')
  })

  it('never stores a stale mask', async () => {
    const app = buildApp()
    const { body } = await getJson(app)
    setAt(body, 'providers.openaiApiKey', '•••• zzzz')
    await post(app, body)
    expect(getAt(await queries.getSettings(), 'providers.openaiApiKey')).toBe(
      plain('providers.openaiApiKey')
    )
  })
})

describe('updateSettingField', () => {
  it('treats a masked section like the full write does', async () => {
    const masked = (await getJson(buildApp())).body
    await queries.updateSettingField('webSearch', masked.webSearch)
    expect(getAt(await queries.getSettings(), 'webSearch.braveApiKey')).toBe(
      plain('webSearch.braveApiKey')
    )
  })
})

describe('POST /api/v1/settings/models', () => {
  const request = (body: Record<string, unknown>) =>
    buildApp().request('/api/v1/settings/models', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: AiProviders.OpenAiGpt, ...body })
    })
  const mask = () => maskSecret(plain('providers.openaiApiKey'))!

  async function storeBaseUrl(url: string | null) {
    const s = await queries.getSettings()
    await queries.updateSettings({
      ...s,
      providers: { ...s.providers, openaiBaseUrl: url }
    } as never)
  }

  it('substitutes the stored key for a mask with no base URL', async () => {
    const res = await request({ apiKey: mask(), baseUrl: null })
    expect(res.status).toBe(200)
    expect(listOpenAiModels).toHaveBeenCalledWith(
      expect.objectContaining({ apiKey: plain('providers.openaiApiKey') })
    )
  })

  it('substitutes the stored key for a mask with the stored base URL', async () => {
    await storeBaseUrl('https://proxy.example.com/v1')
    // Same destination, written differently: case, a trailing slash, spaces.
    const res = await request({
      apiKey: mask(),
      baseUrl: ' HTTPS://Proxy.Example.com/v1/ '
    })
    expect(res.status).toBe(200)
    expect(listOpenAiModels).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: plain('providers.openaiApiKey'),
        baseUrl: 'https://proxy.example.com/v1'
      })
    )
  })

  it('substitutes for a mask with the provider default when none is stored', async () => {
    await storeBaseUrl(null)
    const res = await request({
      apiKey: mask(),
      baseUrl: 'https://api.openai.com/v1'
    })
    expect(res.status).toBe(200)
    expect(listOpenAiModels).toHaveBeenCalledOnce()
  })

  it('refuses a mask sent with another base URL, and calls nobody', async () => {
    await storeBaseUrl('https://proxy.example.com/v1')
    const res = await request({
      apiKey: mask(),
      baseUrl: 'https://evil.example'
    })
    expect(res.status).toBe(400)
    const text = await res.text()
    expect(text).toMatch(/re-enter the API key/iu)
    // The model picker shows this one inline, under the key.
    const { error } = JSON.parse(text) as {
      error: { code: string; params?: { field?: string } }
    }
    expect(error.code).toBe('SECRET_REENTRY_REQUIRED')
    expect(error.params?.field).toBe('apiKey')
    expect(text).not.toContain(plain('providers.openaiApiKey'))
    expect(listOpenAiModels).not.toHaveBeenCalled()
  })

  it('refuses a mask with a userinfo URL that only looks like the stored host', async () => {
    await storeBaseUrl(null)
    const res = await request({
      apiKey: mask(),
      baseUrl: 'https://api.openai.com@evil.example/v1'
    })
    expect(res.status).toBe(400)
    expect(listOpenAiModels).not.toHaveBeenCalled()
  })

  it('uses a typed key as given, with any base URL', async () => {
    const res = await request({
      apiKey: 'sk-typed-just-now-0000',
      baseUrl: 'https://my-own-gateway.example/v1'
    })
    expect(res.status).toBe(200)
    expect(listOpenAiModels).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: 'sk-typed-just-now-0000',
        baseUrl: 'https://my-own-gateway.example/v1'
      })
    )
  })
})

describe('db-io export', () => {
  it('exports the settings table with every secret removed', async () => {
    const blob = await queries.exportData('settings')
    const csv = await blob!.text()
    expect(csv).toContain('id')
    expect(csv).toContain('global')
    for (const p of SETTINGS_SECRET_PATHS)
      expect(csv, p).not.toContain(plain(p))
  })
})

describe('a failed write', () => {
  it('does not echo the secrets it tried to write', async () => {
    const s = (await queries.getSettings()) as unknown as Tree
    setAt(s, 'providers.openaiApiKey', 'sk-in-a-failing-write-1234')
    // A value Postgres rejects in the same statement: jsonb has no \u0000.
    s.personality = { nickname: 'a\u0000b' }
    const err = await queries.updateSettings(s as never).catch((e) => e)
    expect(err).toBeInstanceOf(Error)
    expect(String(err.message)).not.toContain('sk-in-a-failing-write-1234')
    // Nothing reachable from the error carries the driver's message either…
    expect(err.cause).toBeUndefined()
    expect(String(err.stack)).not.toContain('sk-in-a-failing-write-1234')
    // …and neither does what was logged about it.
    const { logger } = await import('@main/lib/logger')
    const { writtenBy } = await import('../../../helpers/logged')
    expect(vi.mocked(logger.error)).toHaveBeenCalled()
    // As the logger writes it: the Error it was handed, message and stack.
    const written = writtenBy(vi.mocked(logger.error).mock.calls)
    expect(written).toContain('exception.stacktrace')
    expect(written).not.toContain('sk-in-a-failing-write-1234')
  })
})
