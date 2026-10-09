import type { CliStatus } from '@exodus/shared/types/agents'

const VIEW: Record<
  CliStatus['state'],
  { tone: 'ok' | 'warn' | 'error'; labelKey: string; hintKey: string | null }
> = {
  ready: { tone: 'ok', labelKey: 'agents.cli.state.ready', hintKey: null },
  not_installed: {
    tone: 'warn',
    labelKey: 'agents.cli.state.notInstalled',
    hintKey: 'agents.cli.hint.install'
  },
  broken: {
    tone: 'error',
    labelKey: 'agents.cli.state.broken',
    hintKey: 'agents.cli.hint.reinstall'
  },
  too_old: {
    tone: 'warn',
    labelKey: 'agents.cli.state.tooOld',
    hintKey: 'agents.cli.hint.update'
  },
  logged_out: {
    tone: 'warn',
    labelKey: 'agents.cli.state.loggedOut',
    hintKey: 'agents.cli.hint.login'
  }
}

export const cliStatusView = (status: CliStatus) => VIEW[status.state]
