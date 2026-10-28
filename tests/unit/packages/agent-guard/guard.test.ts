// @actovia-ai/agent-guard with another app's configuration: nothing of
// Actovia's (its directory, its ports, its tool names) is built in.
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

import { createGuard, forModel, type MatchEnv } from '@actovia-ai/agent-guard'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const guard = createGuard({
  appName: 'Acme',
  appDirName: '.acme',
  refused: ['vault.key', 'db'],
  ownPorts: [8123],
  tools: {
    paths: { open_file: 'file', search_tree: 'root' },
    recursive: ['search_tree'],
    terminal: 'shell',
    mcpCall: 'mcp'
  },
  skipDirs: new Set(['node_modules'])
})

let home: string
let env: MatchEnv
const check = (tool: string, args: unknown) =>
  guard.sensitiveTarget(tool, args, join(home, 'work'), env)

beforeAll(() => {
  // Real path: macOS's /var is /private/var, and a tree is walked at its real path.
  home = realpathSync(mkdtempSync(join(tmpdir(), 'agent-guard-')))
  mkdirSync(join(home, '.ssh'))
  writeFileSync(join(home, '.ssh', 'id_ed25519'), 'k')
  mkdirSync(join(home, '.acme', 'db'), { recursive: true })
  mkdirSync(join(home, 'work'))
  writeFileSync(join(home, 'work', '.env'), 'X=1')
  mkdirSync(join(home, 'proj', 'node_modules', 'pkg'), { recursive: true })
  writeFileSync(join(home, 'proj', 'node_modules', 'pkg', '.env'), 'X=1')
  mkdirSync(join(home, 'leaky'))
  writeFileSync(join(home, 'leaky', 'server.pem'), 'k')
  env = { home, appHome: join(home, '.acme'), cwd: '/' }
})
afterAll(() => rmSync(home, { recursive: true, force: true }))

describe('createGuard', () => {
  it('asks about a credential through the app’s own file tool', async () => {
    expect(
      await check('open_file', { file: `${home}/.ssh/id_ed25519` })
    ).toMatchObject({ kind: 'ask', summary: '~/.ssh/id_ed25519' })
  })

  it('refuses the app’s own refused entries, and only those', async () => {
    expect(
      await check('open_file', { file: '~/.acme/vault.key' })
    ).toMatchObject({ kind: 'refuse' })
    expect(await check('open_file', { file: '~/.acme/notes.md' })).toBeNull()
  })

  it('lets a secret-named file in the workspace pass', async () => {
    expect(await check('open_file', { file: `${home}/work/.env` })).toBeNull()
  })

  it('judges a tree only for a recursive tool, skipping its skip dirs', async () => {
    expect(await check('search_tree', { root: `${home}/leaky` })).toMatchObject(
      { kind: 'ask', summary: '~/leaky (contains ~/leaky/server.pem)' }
    )
    expect(await check('search_tree', { root: `${home}/proj` })).toBeNull()
  })

  it('reads the shell tool’s command for paths, mentions and token commands', async () => {
    expect(
      await check('shell', { command: 'cat ~/.acme/db/data' })
    ).toMatchObject({ kind: 'refuse' })
    expect(
      await check('shell', { command: 'cd ~/.acme && cat vault.key' })
    ).toMatchObject({ kind: 'refuse' })
    expect(await check('shell', { command: 'gh auth token' })).toMatchObject({
      kind: 'ask',
      summary: 'gh auth token — gh auth token'
    })
    expect(await check('shell', { command: 'ls -la' })).toBeNull()
  })

  it('refuses an MCP call at the app’s own port, naming the app', async () => {
    expect(
      await check('mcp', {
        server: 'fetch',
        tool: 'get',
        arguments: { url: 'http://127.0.0.1:08123/x' }
      })
    ).toMatchObject({
      kind: 'refuse',
      summary: "fetch/get: Acme's own API — http://127.0.0.1:08123/x"
    })
    expect(
      await check('mcp', { server: 's', tool: 't', arguments: { port: 8123 } })
    ).toMatchObject({ summary: "s/t: Acme's own API — port 8123" })
  })

  it('leaves a tool it was not told about alone', async () => {
    expect(await check('read_file', { path: '~/.ssh/id_ed25519' })).toBeNull()
  })

  it('names the app in what the model reads', () => {
    expect(guard.refusedReason('~/.acme/db')).toBe(
      "Access to ~/.acme/db is refused: it touches Acme's own secrets, data files or API, which tools never reach."
    )
    expect(forModel('x'.repeat(400))).toHaveLength(301)
  })
})

describe('createGuard without ports or refused entries', () => {
  const bare = createGuard({
    appName: 'Bare',
    appDirName: '.bare',
    tools: { paths: {}, mcpCall: 'mcp' }
  })

  it('refuses nothing and still asks about secrets', async () => {
    const e = { ...env, appHome: join(home, '.bare') }
    expect(
      await bare.sensitiveTarget(
        'mcp',
        {
          server: 's',
          tool: 't',
          arguments: { url: 'http://127.0.0.1:8123/' }
        },
        undefined,
        e
      )
    ).toBeNull()
    expect(
      await bare.sensitiveTarget(
        'mcp',
        { server: 's', tool: 't', arguments: { path: '~/.ssh/id_ed25519' } },
        undefined,
        e
      )
    ).toMatchObject({ kind: 'ask' })
  })
})
