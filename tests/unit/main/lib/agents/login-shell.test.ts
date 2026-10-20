import { parseEnvDump, scrubEnv } from '@main/lib/agents/login-shell'
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
