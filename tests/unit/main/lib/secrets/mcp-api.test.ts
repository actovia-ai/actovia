// The MCP API hands out masks only (spec 2026-09-25 §2.2): every `env` and
// `headers` value, and any secret-named value inside `extraConfig`, leaves as
// a mask; a posted mask keeps what is stored. Real SQL on an in-memory PGlite.
import { isAppError } from '@exodus/shared/errors/app-error'
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
vi.mock('@main/lib/ai/mcp', () => ({
  getMcpTools: vi.fn(async () => []),
  invalidateAllMcpCache: vi.fn(),
  invalidateMcpCache: vi.fn()
}))

const { pglite } = await import('@main/lib/db/db')
const mcpQueries = await import('@main/lib/db/mcp-queries')
const { default: mcpRouter } = await import('@main/lib/server/routes/mcp')

afterAll(async () => {
  await pglite.close()
})

function buildApp() {
  const app = new Hono()
  app.route('/api/v1/mcp', mcpRouter)
  app.onError((err, c) => {
    if (isAppError(err)) return c.json(err.toJSON(), err.statusCode as never)
    return c.json({ message: err.message }, 500)
  })
  return app
}

const ENV_SECRET = 'ghp_env-token-value-AAAA'
const HEADER_SECRET = 'Bearer header-token-BBBB'
const OAUTH_SECRET = 'oauth-client-secret-CCCC'

let id: string

beforeEach(async () => {
  await pglite.exec('DELETE FROM mcp_server;')
  const row = await mcpQueries.createMcpServer({
    name: 'github',
    transportType: 'streamable-http',
    url: 'https://mcp.example.com',
    env: { GITHUB_TOKEN: ENV_SECRET, SHORT: 'abc' },
    headers: { Authorization: HEADER_SECRET },
    extraConfig: {
      oauth: { clientId: 'public-client-id', clientSecret: OAUTH_SECRET },
      timeout: 30
    }
  })
  id = row!.id
})

const send = (method: string, path: string, body: unknown) =>
  buildApp().request(`/api/v1/mcp${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })

describe('GET /api/v1/mcp', () => {
  it('masks env and headers values and secret-named extraConfig values', async () => {
    const res = await buildApp().request('/api/v1/mcp')
    const text = await res.clone().text()
    const [server] = (await res.json()) as Array<Record<string, never>>

    expect(server.env).toEqual({ GITHUB_TOKEN: '•••• AAAA', SHORT: '••••' })
    expect(server.headers).toEqual({ Authorization: '•••• BBBB' })
    expect(server.extraConfig).toEqual({
      oauth: { clientId: 'public-client-id', clientSecret: '•••• CCCC' },
      timeout: 30
    })
    for (const s of [ENV_SECRET, HEADER_SECRET, OAUTH_SECRET])
      expect(text).not.toContain(s)
  })

  it('leaves the stored row in plaintext', async () => {
    const row = await mcpQueries.getMcpServerById(id)
    expect(row!.env).toEqual({ GITHUB_TOKEN: ENV_SECRET, SHORT: 'abc' })
  })
})

describe('PUT /api/v1/mcp/:id', () => {
  it('a form posting back the masks it was shown keeps every secret', async () => {
    const res = await send('PUT', `/${id}`, {
      name: 'github',
      description: 'edited',
      env: { GITHUB_TOKEN: '•••• AAAA', SHORT: '••••' },
      headers: { Authorization: '•••• BBBB' },
      extraConfig: {
        oauth: { clientId: 'public-client-id', clientSecret: '•••• CCCC' },
        timeout: 30
      }
    })
    expect(res.status).toBe(200)
    const text = await res.text()
    for (const s of [ENV_SECRET, HEADER_SECRET, OAUTH_SECRET])
      expect(text).not.toContain(s)

    const row = await mcpQueries.getMcpServerById(id)
    expect(row!.description).toBe('edited')
    expect(row!.env).toEqual({ GITHUB_TOKEN: ENV_SECRET, SHORT: 'abc' })
    expect(row!.headers).toEqual({ Authorization: HEADER_SECRET })
    expect(row!.extraConfig).toEqual({
      oauth: { clientId: 'public-client-id', clientSecret: OAUTH_SECRET },
      timeout: 30
    })
  })

  it('sets a new value, and clears with null', async () => {
    await send('PUT', `/${id}`, {
      headers: { Authorization: 'Bearer brand-new-token-DDDD' },
      env: null
    })
    const row = await mcpQueries.getMcpServerById(id)
    expect(row!.headers).toEqual({
      Authorization: 'Bearer brand-new-token-DDDD'
    })
    expect(row!.env).toBeNull()
  })

  it('leaves fields it was not sent alone', async () => {
    await send('PUT', `/${id}`, { description: 'only this' })
    const row = await mcpQueries.getMcpServerById(id)
    expect(row!.headers).toEqual({ Authorization: HEADER_SECRET })
  })

  it('drops a mask under a name the server never had', async () => {
    await send('PUT', `/${id}`, {
      headers: { Authorization: '•••• BBBB', 'X-Other': '•••• 9999' }
    })
    const row = await mcpQueries.getMcpServerById(id)
    expect(row!.headers).toEqual({ Authorization: HEADER_SECRET })
  })
})

describe('a failed MCP write', () => {
  it('does not echo the secrets it tried to write', async () => {
    const res = await send('PUT', `/${id}`, {
      // jsonb has no \u0000, so Postgres rejects the statement.
      headers: { Authorization: 'Bearer failing-write-FFFF', Bad: 'a\u0000b' }
    })
    expect(res.status).toBeGreaterThanOrEqual(400)
    expect(await res.text()).not.toContain('failing-write-FFFF')
  })
})

describe('POST /api/v1/mcp', () => {
  it('answers with the new row masked', async () => {
    const res = await send('POST', '', {
      name: 'other',
      transportType: 'sse',
      url: 'https://other.example.com',
      headers: { Authorization: 'Bearer created-token-EEEE' }
    })
    expect(res.status).toBe(201)
    const body = (await res.json()) as { id: string; headers: unknown }
    expect(body.headers).toEqual({ Authorization: '•••• EEEE' })
    const row = await mcpQueries.getMcpServerById(body.id)
    expect(row!.headers).toEqual({ Authorization: 'Bearer created-token-EEEE' })
  })

  it.each([
    ['a header', 'headers', { headers: { Authorization: '••••' } }],
    ['the url', 'url', { url: 'https://h.example/sse?api_key=•••• mnop' }],
    ['the args', 'args', { args: ['--token', '•••• 1234'] }],
    [
      'extraConfig',
      'extraConfig',
      { extraConfig: { oauth: { clientSecret: '•••• CCCC' } } }
    ]
  ])('refuses a create carrying a mask in %s (N2)', async (_, field, extra) => {
    const res = await send('POST', '', {
      name: 'with-mask',
      transportType: 'sse',
      url: 'https://other.example.com',
      ...extra
    })
    expect(res.status).toBe(400)
    const body = (await res.json()) as {
      error: { code: string; message: string; params?: { field?: string } }
    }
    expect(body.error.message).toMatch(/re-enter the secret/iu)
    // The form puts the error under the field it names.
    expect(body.error.code).toBe('SECRET_REENTRY_REQUIRED')
    expect(body.error.params?.field).toBe(field)
    const rows = await mcpQueries.getAllMcpServers()
    expect(rows.map((r) => r.name)).not.toContain('with-mask')
  })
})

// ─── review S1, fix round 1 ─────────────────────────────────────────────────

const CAP_URL = 'https://mcp.zapier.com/api/mcp/s/Zk3q9XbT7mW2pL8vR4nY6cA1/mcp'
const ARG_TOKEN = 'ghp_argtoken000GGGG'

async function seedLocators() {
  await pglite.exec('DELETE FROM mcp_server;')
  const row = await mcpQueries.createMcpServer({
    name: 'zapier',
    transportType: 'streamable-http',
    url: CAP_URL,
    args: ['--token', ARG_TOKEN, '--verbose'],
    headers: { Authorization: HEADER_SECRET }
  })
  return row!.id
}

describe('MCP url / args (I2)', () => {
  it('GET masks a capability url and a --token argument', async () => {
    await seedLocators()
    const res = await buildApp().request('/api/v1/mcp')
    const text = await res.clone().text()
    const [server] = (await res.json()) as Array<Record<string, unknown>>
    expect(server.url).toBe('https://mcp.zapier.com/api/mcp/s/•••• 6cA1/mcp')
    expect(server.args).toEqual(['--token', '•••• GGGG', '--verbose'])
    expect(text).not.toContain('Zk3q9XbT7mW2pL8vR4nY6cA1')
    expect(text).not.toContain(ARG_TOKEN)
  })

  it('a form posting back the masked url / args keeps them, and keeps the headers', async () => {
    const sid = await seedLocators()
    const [shown] = (await (
      await buildApp().request('/api/v1/mcp')
    ).json()) as Array<Record<string, unknown>>
    await send('PUT', `/${sid}`, {
      name: 'zapier',
      url: shown.url,
      args: shown.args,
      headers: shown.headers
    })
    const row = await mcpQueries.getMcpServerById(sid)
    expect(row!.url).toBe(CAP_URL)
    expect(row!.args).toEqual(['--token', ARG_TOKEN, '--verbose'])
    // The masked url is not a "new destination" (S2's rule): headers stay.
    expect(row!.headers).toEqual({ Authorization: HEADER_SECRET })
  })

  it('a real url change is stored, and the masked headers do not follow it', async () => {
    const sid = await seedLocators()
    await send('PUT', `/${sid}`, {
      url: 'https://evil.example/mcp',
      headers: { Authorization: '•••• BBBB' }
    })
    const row = await mcpQueries.getMcpServerById(sid)
    expect(row!.url).toBe('https://evil.example/mcp')
    expect(row!.headers).toEqual({})
  })
})

describe('extraConfig secrets (M1, M2)', () => {
  async function seedExtra(extraConfig: Record<string, unknown>) {
    await pglite.exec('DELETE FROM mcp_server;')
    const row = await mcpQueries.createMcpServer({
      name: 'x',
      transportType: 'sse',
      url: 'https://mcp.example.com',
      extraConfig
    })
    return row!.id
  }
  const shownExtra = async () =>
    (
      (await (await buildApp().request('/api/v1/mcp')).json()) as Array<{
        extraConfig: Record<string, unknown>
      }>
    )[0]!.extraConfig

  it('masks everything under a secret-named key, not only its strings', async () => {
    await seedExtra({
      tokens: { access: 'access-token-value-HHHH', expiresIn: 3600 },
      auth: { bearer: 'bearer-value-000IIII' },
      timeout: 30
    })
    const shown = await shownExtra()
    expect(shown).toEqual({
      tokens: { access: '•••• HHHH', expiresIn: '••••' },
      auth: { bearer: '•••• IIII' },
      timeout: 30
    })
    expect(JSON.stringify(shown)).not.toContain('3600')
  })

  it('round-trips a masked subtree', async () => {
    const sid = await seedExtra({
      tokens: { access: 'access-token-value-HHHH', expiresIn: 3600 }
    })
    await send('PUT', `/${sid}`, { extraConfig: await shownExtra() })
    const row = await mcpQueries.getMcpServerById(sid)
    expect(row!.extraConfig).toEqual({
      tokens: { access: 'access-token-value-HHHH', expiresIn: 3600 }
    })
  })

  it('restores array items by their name, whatever the order', async () => {
    const sid = await seedExtra({
      providers: [
        { name: 'a', apiKey: 'key-for-a-000000AAAA' },
        { name: 'b', apiKey: 'key-for-b-000000BBBB' }
      ]
    })
    const shown = (await shownExtra()) as { providers: unknown[] }
    await send('PUT', `/${sid}`, {
      extraConfig: { providers: shown.providers.toReversed() }
    })
    const row = await mcpQueries.getMcpServerById(sid)
    expect(row!.extraConfig).toEqual({
      providers: [
        { name: 'b', apiKey: 'key-for-b-000000BBBB' },
        { name: 'a', apiKey: 'key-for-a-000000AAAA' }
      ]
    })
  })

  it('clears the masks of a reordered array with no identity key', async () => {
    const sid = await seedExtra({
      servers: [
        { url: 'https://one.example', token: 'token-one-00000OOOO' },
        { url: 'https://two.example', token: 'token-two-00000TTTT' }
      ]
    })
    const shown = (await shownExtra()) as { servers: unknown[] }
    await send('PUT', `/${sid}`, {
      extraConfig: { servers: shown.servers.toReversed() }
    })
    const row = await mcpQueries.getMcpServerById(sid)
    // Never token-one next to two.example: the user re-enters them.
    expect(row!.extraConfig).toEqual({
      servers: [{ url: 'https://two.example' }, { url: 'https://one.example' }]
    })
  })

  it('keeps the masks of an array sent back unchanged', async () => {
    const sid = await seedExtra({
      servers: [{ url: 'https://one.example', token: 'token-one-00000OOOO' }]
    })
    await send('PUT', `/${sid}`, { extraConfig: await shownExtra() })
    const row = await mcpQueries.getMcpServerById(sid)
    expect(row!.extraConfig).toEqual({
      servers: [{ url: 'https://one.example', token: 'token-one-00000OOOO' }]
    })
  })
})

// ─── S2 review C1: a partial PUT that moves the destination ─────────────────

describe('a partial PUT that moves where the secrets go (C1)', () => {
  const read = () => mcpQueries.getMcpServerById(id)
  const STRIPPED_EXTRA = {
    oauth: { clientId: 'public-client-id' },
    timeout: 30
  }

  it('url only: the stored headers and extraConfig secrets are cleared', async () => {
    await send('PUT', `/${id}`, { url: 'https://attacker.example/mcp' })
    const row = await read()
    expect(row!.url).toBe('https://attacker.example/mcp')
    expect(row!.headers).toEqual({})
    expect(row!.extraConfig).toEqual(STRIPPED_EXTRA)
  })

  it('transportType only: the headers are cleared', async () => {
    await send('PUT', `/${id}`, { transportType: 'sse' })
    const row = await read()
    expect(row!.headers).toEqual({})
    expect(row!.extraConfig).toEqual(STRIPPED_EXTRA)
  })

  it('args only: the env is cleared', async () => {
    await send('PUT', `/${id}`, { args: ['-y', 'attacker-pkg'] })
    const row = await read()
    expect(row!.args).toEqual(['-y', 'attacker-pkg'])
    expect(row!.env).toEqual({})
  })

  it('command only: the env is cleared', async () => {
    await send('PUT', `/${id}`, { command: 'attacker-binary' })
    expect((await read())!.env).toEqual({})
  })

  it('keeps a plaintext secret posted with the move', async () => {
    await send('PUT', `/${id}`, {
      url: 'https://new-host.example/mcp',
      headers: { Authorization: 'Bearer typed-for-new-host-LLLL' }
    })
    expect((await read())!.headers).toEqual({
      Authorization: 'Bearer typed-for-new-host-LLLL'
    })
  })

  it('name or isActive only: every secret stays', async () => {
    await send('PUT', `/${id}`, { name: 'renamed' })
    await send('PUT', `/${id}`, { isActive: true })
    const row = await read()
    expect(row!.name).toBe('renamed')
    expect(row!.isActive).toBe(true)
    expect(row!.env).toEqual({ GITHUB_TOKEN: ENV_SECRET, SHORT: 'abc' })
    expect(row!.headers).toEqual({ Authorization: HEADER_SECRET })
    expect(row!.extraConfig).toEqual({
      oauth: { clientId: 'public-client-id', clientSecret: OAUTH_SECRET },
      timeout: 30
    })
  })

  it('the same url in another form, or as its mask, is no move', async () => {
    await send('PUT', `/${id}`, { url: 'HTTPS://MCP.example.com/' })
    expect((await read())!.headers).toEqual({ Authorization: HEADER_SECRET })
  })
})

// ─── S1 fix round 2 ─────────────────────────────────────────────────────────

const ARG_BEARER = 'Bearer real-token-000MMMM'
const REMOTE_ARGS = [
  '-y',
  'mcp-remote',
  'https://real.example/sse',
  '--header',
  `Authorization: ${ARG_BEARER}`
]

async function seedStdio() {
  await pglite.exec('DELETE FROM mcp_server;')
  const row = await mcpQueries.createMcpServer({
    name: 'remote-via-stdio',
    transportType: 'stdio',
    command: 'npx',
    args: REMOTE_ARGS,
    env: { GITHUB_TOKEN: ENV_SECRET }
  })
  return row!.id
}

const shownArgs = async () =>
  (
    (await (await buildApp().request('/api/v1/mcp')).json()) as Array<{
      args: string[]
    }>
  )[0]!.args

describe('secret args never follow a new command (N1)', () => {
  it('a PUT of only {command} starts the new command without the stored secrets', async () => {
    const sid = await seedStdio()
    const res = await send('PUT', `/${sid}`, { command: '/tmp/x.sh' })
    expect(res.status).toBe(200)
    const row = await mcpQueries.getMcpServerById(sid)
    expect(row!.command).toBe('/tmp/x.sh')
    // No stored args at all: shape-based stripping could miss a secret.
    expect(row!.args).toEqual([])
    expect(row!.env).toEqual({})
  })

  it('a secret in a shape the masker does not know does not follow either', async () => {
    await pglite.exec('DELETE FROM mcp_server;')
    const created = await mcpQueries.createMcpServer({
      name: 'json-config',
      transportType: 'stdio',
      command: 'npx',
      args: [
        '-y',
        'some-server',
        '--config',
        '{"apiKey":"json-secret-000PPPP"}'
      ]
    })
    // The masker does not look inside JSON: this is the residual it covers.
    expect(JSON.stringify(await shownArgs())).toContain('json-secret-000PPPP')
    await send('PUT', `/${created!.id}`, { command: '/tmp/x.sh' })
    const row = await mcpQueries.getMcpServerById(created!.id)
    expect(row!.args).toEqual([])
    expect(JSON.stringify(row)).not.toContain('json-secret-000PPPP')
  })

  it('a new command with the masked args is refused', async () => {
    const sid = await seedStdio()
    const res = await send('PUT', `/${sid}`, {
      command: '/tmp/x.sh',
      args: await shownArgs()
    })
    expect(res.status).toBe(400)
    expect(await res.text()).toMatch(/re-enter the secret/iu)
    const row = await mcpQueries.getMcpServerById(sid)
    expect(row!.command).toBe('npx')
    expect(row!.args).toEqual(REMOTE_ARGS)
  })

  it('a new command with the args re-sent in plaintext takes them', async () => {
    const sid = await seedStdio()
    const args = ['--header', 'Authorization: Bearer typed-again-000NNNN']
    await send('PUT', `/${sid}`, { command: 'other-launcher', args })
    const row = await mcpQueries.getMcpServerById(sid)
    expect(row!.args).toEqual(args)
  })

  it('the same command with the masked args keeps them', async () => {
    const sid = await seedStdio()
    await send('PUT', `/${sid}`, { command: 'npx', args: await shownArgs() })
    expect((await mcpQueries.getMcpServerById(sid))!.args).toEqual(REMOTE_ARGS)
  })
})

describe('a half-edited mask is refused, never stored (N2)', () => {
  it('a url edited around its mask', async () => {
    await pglite.exec('DELETE FROM mcp_server;')
    const row = await mcpQueries.createMcpServer({
      name: 'q',
      transportType: 'sse',
      url: 'https://h.com/sse?api_key=abcdefghijklmnop',
      headers: { Authorization: HEADER_SECRET }
    })
    const res = await send('PUT', `/${row!.id}`, {
      url: 'https://h.com/sse2?api_key=•••• mnop'
    })
    expect(res.status).toBe(400)
    expect(await res.text()).toMatch(/re-enter the secret/iu)
    const after = await mcpQueries.getMcpServerById(row!.id)
    expect(after!.url).toBe('https://h.com/sse?api_key=abcdefghijklmnop')
    expect(after!.headers).toEqual({ Authorization: HEADER_SECRET })
  })

  it('args edited around their masks', async () => {
    const sid = await seedStdio()
    const res = await send('PUT', `/${sid}`, {
      args: [...(await shownArgs()), '--debug']
    })
    expect(res.status).toBe(400)
    const after = await mcpQueries.getMcpServerById(sid)
    expect(after!.args).toEqual(REMOTE_ARGS)
    expect(after!.env).toEqual({ GITHUB_TOKEN: ENV_SECRET })
  })
})

describe('a value typed around a mask in env / headers / extraConfig is refused (S1 M-b)', () => {
  it.each([
    ['env', { env: { GITHUB_TOKEN: `x${'••••'} AAAA`, SHORT: '••••' } }],
    ['headers', { headers: { Authorization: 'Bearer •••• BBBB extra' } }],
    [
      'extraConfig',
      {
        extraConfig: {
          oauth: { clientId: 'public-client-id', clientSecret: 'pre ••••' },
          timeout: 30
        }
      }
    ]
  ])('%s', async (field, body) => {
    const res = await send('PUT', `/${id}`, body)
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error.code).toBe('SECRET_REENTRY_REQUIRED')
    expect(json.error.params.field).toBe(field)
    const after = await mcpQueries.getMcpServerById(id)
    expect(after!.env).toEqual({ GITHUB_TOKEN: ENV_SECRET, SHORT: 'abc' })
    expect(after!.headers).toEqual({ Authorization: HEADER_SECRET })
  })
})

describe('any env change is a command change (ruling N3)', () => {
  async function seedWithPath() {
    await pglite.exec('DELETE FROM mcp_server;')
    const row = await mcpQueries.createMcpServer({
      name: 'with-path',
      transportType: 'stdio',
      command: 'npx',
      args: REMOTE_ARGS,
      env: { GITHUB_TOKEN: ENV_SECRET, PATH: '/usr/local/bin:/usr/bin:/bin' }
    })
    return row!.id
  }

  const shown = async () =>
    (
      (await (await buildApp().request('/api/v1/mcp')).json()) as Array<{
        env: Record<string, string>
        args: string[]
      }>
    )[0]!

  it.each([
    ['PATH', { PATH: '/tmp/evil:/usr/bin' }],
    ['NODE_OPTIONS', { NODE_OPTIONS: '--require /tmp/x.js' }],
    ['DYLD_INSERT_LIBRARIES', { DYLD_INSERT_LIBRARIES: '/tmp/x.dylib' }],
    // The re-review's misses of the old denylist.
    ['NPM_CONFIG_REGISTRY', { NPM_CONFIG_REGISTRY: 'https://evil.example' }],
    ['npm_config_registry', { npm_config_registry: 'https://evil.example' }],
    ['HOME', { HOME: '/tmp/workspace' }],
    ['BASH_ENV', { BASH_ENV: '/tmp/x.sh' }],
    ['JAVA_TOOL_OPTIONS', { JAVA_TOOL_OPTIONS: '-javaagent:/tmp/x.jar' }],
    // And any other entry, by name or not.
    ['an ordinary new var', { LOG_LEVEL: 'debug' }],
    ['an existing var', { PATH: '/usr/bin:/bin' }]
  ])(
    'changing %s clears the masked env secrets and refuses the masked args',
    async (_name, change) => {
      const sid = await seedWithPath()
      const { env, args } = await shown()
      const res = await send('PUT', `/${sid}`, {
        env: { ...env, ...change },
        args
      })
      expect(res.status).toBe(400)
      const after = await mcpQueries.getMcpServerById(sid)
      expect(after!.env).toMatchObject({ GITHUB_TOKEN: ENV_SECRET })

      // Re-sent without the masked args: the env secrets do not follow.
      const ok = await send('PUT', `/${sid}`, {
        env: { ...env, ...change },
        args: ['-y', 'mcp-remote', 'https://real.example/sse']
      })
      expect(ok.status).toBe(200)
      const moved = await mcpQueries.getMcpServerById(sid)
      expect(moved!.env?.GITHUB_TOKEN).toBeUndefined()
    }
  )

  it("the re-review's scenario: a registry swap with only env sent carries no key", async () => {
    const sid = await seedWithPath()
    const { env } = await shown()
    const res = await send('PUT', `/${sid}`, {
      env: { ...env, NPM_CONFIG_REGISTRY: 'https://evil.example' }
    })
    expect(res.status).toBe(200)
    const after = await mcpQueries.getMcpServerById(sid)
    expect(after!.env?.GITHUB_TOKEN).toBeUndefined()
    expect(after!.env?.NPM_CONFIG_REGISTRY).toBe('https://evil.example')
    // No stored args follow a command change either.
    expect(after!.args).toEqual([])
  })

  it('removing an entry is a change too', async () => {
    const sid = await seedWithPath()
    const { env } = await shown()
    const { PATH: _dropped, ...rest } = env
    const res = await send('PUT', `/${sid}`, {
      env: rest,
      args: ['-y', 'mcp-remote', 'https://real.example/sse']
    })
    expect(res.status).toBe(200)
    const after = await mcpQueries.getMcpServerById(sid)
    expect(after!.env?.GITHUB_TOKEN).toBeUndefined()
  })

  it('a secret re-sent in plaintext with the change survives it', async () => {
    const sid = await seedWithPath()
    const { env } = await shown()
    const res = await send('PUT', `/${sid}`, {
      env: {
        ...env,
        GITHUB_TOKEN: 'ghp_newvalue1234567890',
        LOG_LEVEL: 'debug'
      },
      args: ['-y', 'mcp-remote', 'https://real.example/sse']
    })
    expect(res.status).toBe(200)
    const after = await mcpQueries.getMcpServerById(sid)
    expect(after!.env).toMatchObject({
      GITHUB_TOKEN: 'ghp_newvalue1234567890',
      LOG_LEVEL: 'debug'
    })
  })

  it('the same PATH posted back as its mask moves nothing', async () => {
    const sid = await seedWithPath()
    const { env, args } = await shown()
    const res = await send('PUT', `/${sid}`, { env, args })
    expect(res.status).toBe(200)
    const after = await mcpQueries.getMcpServerById(sid)
    expect(after!.env).toEqual({
      GITHUB_TOKEN: ENV_SECRET,
      PATH: '/usr/local/bin:/usr/bin:/bin'
    })
    expect(after!.args).toEqual(REMOTE_ARGS)
  })
})
