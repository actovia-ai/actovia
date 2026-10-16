import { CLI_NAMES, type CliStatus } from '@exodus/shared/types/agents'
import { useTranslation } from 'react-i18next'

import { cliStatusView } from '@/lib/cli-status'

/** A CLI in the runtime picker: its name, and why it can't be chosen when it isn't ready. */
export function CliRuntimeLabel({ cli }: { cli: CliStatus }) {
  const { t } = useTranslation('philharmonic')
  return (
    <>
      {CLI_NAMES[cli.id]}
      {cli.state !== 'ready' && ` — ${t(cliStatusView(cli).labelKey)}`}
    </>
  )
}
