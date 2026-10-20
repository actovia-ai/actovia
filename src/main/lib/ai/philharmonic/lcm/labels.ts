import { CLI_NAMES } from '@actovia/shared/types/agents'

import { cliOf, isCliId } from '../../../agents/drivers'

export interface LabelledAgent {
  name: string
  runtime: string
  model: string | null
}

/**
 * Who a report came from, as the PM reads it: the employee's name, and for a
 * coding-agent CLI the CLI and model too. An employee since deleted is
 * "former employee".
 */
export function employeeLabel(agent: LabelledAgent | undefined): string {
  if (!agent) return '[former employee]'
  if (isCliId(agent.runtime)) {
    return `[${agent.name} · ${CLI_NAMES[cliOf(agent.runtime)]} · ${agent.model ?? 'CLI default'}]`
  }
  return `[${agent.name}]`
}
