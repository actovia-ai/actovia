// tests/unit/main/lib/agents/cli-check.test.ts
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

import {
  checkCli,
  compareVersions,
  findOnPath,
  listCodexModels,
  parseCodexLoginStatus,
  type CheckDeps
} from '@main/lib/agents/cli-check'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@main/lib/db/queries', () => ({ getSettings: vi.fn() }))
vi.mock('@main/lib/logger', () => ({ logger: { warn: vi.fn() } }))

function fakeBin(script: string, name = 'claude'): string {
  const dir = mkdtempSync(join(tmpdir(), 'fake-cli-'))
  const file = join(dir, name)
  writeFileSync(file, `#!/bin/sh\n${script}\n`)
  chmodSync(file, 0o755)
  return dir
}

const GOOD = `case "$1" in
  --version) echo "2.1.295 (Claude Code)";;
  auth) echo '{"loggedIn": true, "authMethod": "claude.ai", "apiProvider": "firstParty"}';;
esac`

const codexBin = (version: string, login: string, loginExit = 0) =>
  fakeBin(
    `case "$1" in --version) echo "codex-cli ${version}";; login) echo "${login}" >&2; exit ${loginExit};; esac`,
    'codex'
  )

/** A Node script standing in for `codex app-server`, answering by `reply(msg)`. */
function fakeAppServer(reply: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'fake-app-server-'))
  const file = join(dir, 'codex')
  writeFileSync(
    file,
    `#!${process.execPath}
const out = (o) => process.stdout.write(JSON.stringify(o) + '\\n')
require('readline').createInterface({ input: process.stdin }).on('line', (l) => {
  const m = JSON.parse(l)
  ${reply}
})
`
  )
  chmodSync(file, 0o755)
  return file
}

function deps(
  dir: string,
  override: string | null = null,
  listModels: CheckDeps['listModels'] = () => Promise.resolve(null)
): CheckDeps {
  const real = {
    env: async () => ({ PATH: `${dir}:/usr/bin:/bin` }),
    overridePath: async () => override,
    listModels
  }
  return {
    ...real,
    exec: async (file, args, env) => {
      const { execFile } = await import('child_process')
      return new Promise((resolve) => {
        execFile(file, args, { env, timeout: 5000 }, (err, stdout, stderr) => {
          const code = err ? (typeof err.code === 'number' ? err.code : -1) : 0
          resolve({
            code,
            stdout: String(stdout),
            stderr: String(stderr) || (err && !stdout ? err.message : '')
          })
        })
      })
    }
  }
}

describe('CLI check', () => {
  it('compares dotted versions numerically', () => {
    expect(compareVersions('2.1.294', '2.1.294')).toBe(0)
    expect(compareVersions('2.1.300', '2.1.294')).toBeGreaterThan(0)
    expect(compareVersions('2.0.999', '2.1.0')).toBeLessThan(0)
  })

  it('finds an executable on the PATH it is given, not the process PATH', async () => {
    const dir = fakeBin(GOOD)
    expect(await findOnPath('claude', `/nope:${dir}`)).toBe(join(dir, 'claude'))
    expect(await findOnPath('claude', '/nope')).toBeNull()
  })

  it('is ready when found, running, new enough and logged in', async () => {
    const dir = fakeBin(GOOD)
    const s = await checkCli('claude-code', deps(dir))
    expect(s).toMatchObject({
      state: 'ready',
      version: '2.1.295',
      authMethod: 'claude.ai',
      path: join(dir, 'claude')
    })
  })

  it('is not installed when nothing is found', async () => {
    const s = await checkCli('claude-code', deps('/nonexistent-dir'))
    expect(s).toMatchObject({ state: 'not_installed', path: null })
  })

  it('is broken when the launcher is there but its binary is gone (the machine’s Codex, 2026-10-09)', async () => {
    const dir = fakeBin('exec /nonexistent/vendor/claude "$@"')
    const s = await checkCli('claude-code', deps(dir))
    expect(s.state).toBe('broken')
    expect(s.detail).toMatch(/nonexistent/)
  })

  it('is too old below the tested minimum', async () => {
    const dir = fakeBin('echo "2.0.1 (Claude Code)"')
    const s = await checkCli('claude-code', deps(dir))
    expect(s).toMatchObject({ state: 'too_old', version: '2.0.1' })
  })

  it('is logged out when auth status says so', async () => {
    const dir = fakeBin(
      `case "$1" in --version) echo "2.1.294";; auth) echo '{"loggedIn": false}'; exit 1;; esac`
    )
    const s = await checkCli('claude-code', deps(dir))
    expect(s.state).toBe('logged_out')
  })

  it("uses the owner's path when set, even off the PATH", async () => {
    const dir = fakeBin(GOOD)
    const s = await checkCli(
      'claude-code',
      deps('/nonexistent-dir', join(dir, 'claude'))
    )
    expect(s.state).toBe('ready')
  })

  it('a ready Claude Code reports no models', async () => {
    const dir = fakeBin(GOOD)
    const s = await checkCli('claude-code', deps(dir))
    expect(s.models).toBeNull()
  })

  it('reads codex login status', () => {
    expect(parseCodexLoginStatus(0, 'Logged in using API key')).toEqual({
      loggedIn: true,
      authMethod: 'API key'
    })
    expect(parseCodexLoginStatus(1, 'Not logged in')).toEqual({
      loggedIn: false,
      authMethod: null
    })
    expect(parseCodexLoginStatus(0, 'Not logged in')).toMatchObject({
      loggedIn: false
    })
  })

  it('Codex is ready when new enough and logged in, with its models', async () => {
    const dir = codexBin('0.162.1', 'Logged in using ChatGPT')
    const asked: string[] = []
    const s = await checkCli(
      'codex',
      deps(dir, null, (id, path) => {
        asked.push(`${id} ${path}`)
        return Promise.resolve(['gpt-x'])
      })
    )
    expect(s).toMatchObject({
      state: 'ready',
      version: '0.162.1',
      authMethod: 'ChatGPT',
      path: join(dir, 'codex'),
      models: ['gpt-x']
    })
    expect(asked).toEqual([`codex ${join(dir, 'codex')}`])
  })

  it('Codex below 0.162.1 is too old', async () => {
    const dir = codexBin('0.150.0', 'Logged in using ChatGPT')
    expect((await checkCli('codex', deps(dir))).state).toBe('too_old')
  })

  it('Codex logged out says so, in its own words', async () => {
    const dir = codexBin('0.162.1', 'Not logged in', 1)
    const s = await checkCli('codex', deps(dir))
    expect(s).toMatchObject({ state: 'logged_out', models: null })
    expect(s.detail).toMatch(/Not logged in/u)
  })

  it('lists Codex models from a short-lived app-server, hidden ones left out', async () => {
    const bin = fakeAppServer(`
  if (m.method === 'initialize') out({ id: m.id, result: {} })
  if (m.method === 'model/list') out({ id: m.id, result: { data: [
    { id: 'a', model: 'gpt-a', hidden: false },
    { id: 'b', model: 'gpt-b', hidden: true },
    { id: 'gpt-c', hidden: false }
  ], nextCursor: null } })`)
    expect(await listCodexModels(bin, { PATH: '/usr/bin:/bin' })).toEqual([
      'gpt-a',
      'gpt-c'
    ])
  })

  it('a refused or silent model list is unknown, never a failure', async () => {
    const refusing = fakeAppServer(`
  if (m.method === 'initialize') out({ id: m.id, result: {} })
  if (m.method === 'model/list') out({ id: m.id, error: { message: 'no' } })`)
    expect(await listCodexModels(refusing, {})).toBeNull()
    expect(await listCodexModels('/nonexistent/codex', {})).toBeNull()
  })

  it('a silent app-server times out to null and is ended, not left running', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'fake-app-server-'))
    const pidFile = join(dir, 'pid')
    const file = join(dir, 'codex')
    // Ignores stdin's end and SIGTERM is its only way out.
    writeFileSync(
      file,
      `#!${process.execPath}\nrequire('fs').writeFileSync(${JSON.stringify(pidFile)}, String(process.pid))\nsetInterval(() => {}, 1000)\n`
    )
    chmodSync(file, 0o755)
    expect(await listCodexModels(file, {}, 1500)).toBeNull()
    const pid = Number(readFileSync(pidFile, 'utf8'))
    const alive = () => {
      try {
        process.kill(pid, 0)
        return true
      } catch {
        return false
      }
    }
    const until = Date.now() + 5000
    while (alive() && Date.now() < until)
      await new Promise((r) => {
        setTimeout(r, 100)
      })
    expect(alive()).toBe(false)
  }, 10_000)
})
