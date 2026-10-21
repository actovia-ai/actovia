import { describe, expect, it } from 'vitest'

import { cliStatusView, displayCliPath } from '@/lib/cli-status'

const s = (state: string) =>
  ({
    id: 'claude-code',
    state,
    path: null,
    version: null,
    authMethod: null,
    detail: null,
    checkedAt: 0
  }) as never

describe('cliStatusView', () => {
  it.each([
    ['ready', 'ok', 'agents.cli.state.ready', null],
    [
      'not_installed',
      'warn',
      'agents.cli.state.notInstalled',
      'agents.cli.hint.install'
    ],
    ['broken', 'error', 'agents.cli.state.broken', 'agents.cli.hint.reinstall'],
    ['too_old', 'warn', 'agents.cli.state.tooOld', 'agents.cli.hint.update'],
    [
      'logged_out',
      'warn',
      'agents.cli.state.loggedOut',
      'agents.cli.hint.login'
    ]
  ])('%s', (state, tone, labelKey, hintKey) => {
    expect(cliStatusView(s(state))).toEqual({ tone, labelKey, hintKey })
  })
})

describe('displayCliPath', () => {
  it.each([
    ['/Users/alex/.local/bin/claude', '~/.local/bin/claude'],
    [
      '/home/alex/.nvm/versions/node/v24/bin/codex',
      '~/.nvm/versions/node/v24/bin/codex'
    ],
    ['C:\\Users\\alex\\AppData\\bin\\codex.exe', '~\\AppData\\bin\\codex.exe'],
    ['/opt/homebrew/bin/claude', '/opt/homebrew/bin/claude']
  ])('%s → %s', (path, shown) => {
    expect(displayCliPath(path)).toBe(shown)
  })
})
