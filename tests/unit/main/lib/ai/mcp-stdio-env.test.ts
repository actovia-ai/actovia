// A stdio MCP server spawned from a packaged, Finder-launched app ENOENTs
// because the GUI PATH lacks Homebrew / nvm / /usr/local/bin. `prepareStdioSpawn`
// recovers the login-shell PATH, passes it to the child, and resolves a bare
// command to an absolute path — throwing a clear error (not ENOENT) when it
// cannot. On Windows / dev it leaves the command verbatim.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const appState = vi.hoisted(() => ({ isPackaged: true }))
vi.mock('electron', () => ({
  app: {
    get isPackaged() {
      return appState.isPackaged
    },
    getPath: () => '/tmp'
  }
}))

const logged = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn()
}))
vi.mock('@main/lib/logger', () => ({ logger: logged }))

const shell = vi.hoisted(() => ({
  env: { PATH: '/opt/homebrew/bin:/usr/local/bin' } as Record<string, string>,
  onPath: new Set<string>()
}))
vi.mock('@main/lib/agents/login-shell', () => ({
  loginShellEnv: vi.fn(async () => shell.env),
  scrubEnv: (env: Record<string, string | undefined>) => {
    const out: Record<string, string> = {}
    for (const [k, v] of Object.entries(env)) {
      if (v === undefined) continue
      if (/^(ACTOVIA_|ELECTRON_|VITE_)/u.test(k) || k === 'NODE_OPTIONS')
        continue
      out[k] = v
    }
    return out
  }
}))
vi.mock('@main/lib/agents/cli-check', () => ({
  findOnPath: vi.fn(async (name: string, path: string) => {
    for (const dir of path.split(':').filter(Boolean)) {
      const full = `${dir}/${name}`
      if (shell.onPath.has(full)) return full
    }
    return null
  })
}))

const { prepareStdioSpawn, shouldHardenStdioPath } =
  await import('@main/lib/ai/mcp-stdio-env')

const originalPlatform = process.platform
function setPlatform(p: NodeJS.Platform) {
  Object.defineProperty(process, 'platform', { value: p, configurable: true })
}

beforeEach(() => {
  appState.isPackaged = true
  shell.env = { PATH: '/opt/homebrew/bin:/usr/local/bin' }
  shell.onPath = new Set(['/opt/homebrew/bin/npx'])
  for (const f of Object.values(logged)) f.mockClear()
})
afterEach(() => setPlatform(originalPlatform))

describe('shouldHardenStdioPath', () => {
  it('is false on Windows', () => {
    setPlatform('win32')
    expect(shouldHardenStdioPath()).toBe(false)
  })
  it('is false in dev (not packaged)', () => {
    setPlatform('darwin')
    appState.isPackaged = false
    expect(shouldHardenStdioPath()).toBe(false)
  })
  it('is true on a packaged mac/linux run', () => {
    setPlatform('darwin')
    appState.isPackaged = true
    expect(shouldHardenStdioPath()).toBe(true)
  })
})

describe('prepareStdioSpawn (packaged mac/linux)', () => {
  beforeEach(() => setPlatform('darwin'))

  it('resolves a bare command on the login-shell PATH', async () => {
    const plan = await prepareStdioSpawn('npx')
    expect(plan.command).toBe('/opt/homebrew/bin/npx')
    expect(plan.env.PATH).toContain('/opt/homebrew/bin')
  })

  it('throws a clear error (not ENOENT) when the binary is missing', async () => {
    shell.onPath = new Set()
    await expect(prepareStdioSpawn('npx')).rejects.toThrow(/not found on PATH/u)
    expect(logged.error).toHaveBeenCalled()
  })

  it('leaves an absolute command untouched', async () => {
    const plan = await prepareStdioSpawn('/custom/bin/my-server')
    expect(plan.command).toBe('/custom/bin/my-server')
  })

  it("merges the login-shell PATH but lets the server's own env win", async () => {
    const plan = await prepareStdioSpawn('/abs/node', {
      PATH: '/only/this',
      FOO: 'bar'
    })
    expect(plan.env.PATH).toBe('/only/this')
    expect(plan.env.FOO).toBe('bar')
  })
})

describe('prepareStdioSpawn (windows / dev)', () => {
  it('returns the bare command verbatim on Windows', async () => {
    setPlatform('win32')
    const plan = await prepareStdioSpawn('npx', { K: 'v' })
    expect(plan.command).toBe('npx')
    expect(plan.env.K).toBe('v')
  })

  it('returns the bare command verbatim in dev', async () => {
    setPlatform('darwin')
    appState.isPackaged = false
    const plan = await prepareStdioSpawn('npx')
    expect(plan.command).toBe('npx')
  })
})
