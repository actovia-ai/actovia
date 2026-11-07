import { mkdirSync, mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

import {
  parseEnvDump,
  scrubEnv,
  withCliFallbacks
} from '@main/lib/agents/login-shell'
// tests/unit/main/lib/agents/login-shell.test.ts
import { describe, expect, it, vi } from 'vitest'

vi.mock('@main/lib/logger', () => ({ logger: { warn: vi.fn() } }))

describe('login shell environment', () => {
  it('reads the NUL-separated dump between the markers, ignoring rc-file noise', () => {
    const out =
      'Welcome to zsh\n__ACTOVIA_ENV__PATH=/opt/homebrew/bin:/usr/bin\0HOME=/Users/o\0A=b=c\0__ACTOVIA_ENV__\nbye'
    expect(parseEnvDump(out)).toEqual({
      PATH: '/opt/homebrew/bin:/usr/bin',
      HOME: '/Users/o',
      A: 'b=c'
    })
  })

  it('returns nothing when the markers are missing', () => {
    expect(parseEnvDump('no markers here')).toEqual({})
  })

  it('keeps the selected Node first and appends older nvm installations in numeric version order', async () => {
    const home = mkdtempSync(join(tmpdir(), 'actovia-nvm-'))
    const versions = join(home, '.nvm/versions/node')
    for (const version of ['v9.9.0', 'v24.14.0', 'v26.13.0', 'not-a-version']) {
      mkdirSync(join(versions, version, 'bin'), { recursive: true })
    }
    const current = join(versions, 'v26.13.0/bin')
    const env = await withCliFallbacks(
      { PATH: `${current}:/usr/bin`, LANG: 'en_US.UTF-8' },
      home
    )
    const paths = env.PATH.split(':')
    expect(paths[0]).toBe(current)
    expect(paths.filter((path) => path.startsWith(versions))).toEqual([
      current,
      join(versions, 'v24.14.0/bin'),
      join(versions, 'v9.9.0/bin')
    ])
    expect(env.LANG).toBe('en_US.UTF-8')
  })

  it('honors a custom NVM_DIR and tolerates an absent nvm installation', async () => {
    const home = mkdtempSync(join(tmpdir(), 'actovia-custom-nvm-'))
    const custom = join(home, 'custom-node-manager')
    mkdirSync(join(custom, 'versions/node/v24.14.0/bin'), { recursive: true })
    const env = await withCliFallbacks(
      { PATH: '/usr/bin', NVM_DIR: custom },
      home
    )
    expect(env.PATH.split(':')).toContain(
      join(custom, 'versions/node/v24.14.0/bin')
    )
    const absent = await withCliFallbacks({ PATH: '/usr/bin' }, home)
    expect(absent.PATH.split(':')).toContain(join(home, '.local/bin'))
    expect(absent.PATH.split(':')).not.toContain(
      join(custom, 'versions/node/v24.14.0/bin')
    )
  })

  it("drops Actovia's, Electron's and Vite's variables and NODE_OPTIONS, keeps the owner's own", () => {
    expect(
      scrubEnv({
        PATH: '/bin',
        ACTOVIA_HOME: '/x',
        ELECTRON_RUN_AS_NODE: '1',
        VITE_DEV_SERVER_URL: 'http://localhost',
        NODE_OPTIONS: '--inspect',
        ANTHROPIC_API_KEY: 'owner-set-this',
        EMPTY: undefined
      })
    ).toEqual({ PATH: '/bin', ANTHROPIC_API_KEY: 'owner-set-this' })
  })
})
