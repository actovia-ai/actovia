import { describe, expect, it } from 'vitest'

import { cliStatusView } from '@/lib/cli-status'

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
