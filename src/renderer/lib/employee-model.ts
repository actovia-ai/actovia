import type { Settings } from '@exodus/shared/schemas/settings-schema'
import {
  CLI_NAMES,
  type CliId,
  type CliStatus
} from '@exodus/shared/types/agents'
import type { AiProviders } from '@exodus/shared/types/ai'

import type { AgentData } from '@/stores/philharmonic'

import {
  configuredProviders,
  modelCatalog,
  modelLabel
} from './provider-labels'

/** Claude Code's aliases are fixed; any CLI that listed its models offers those. */
export function cliModelSuggestions(
  cli: CliId,
  status: Pick<CliStatus, 'models'> | undefined
): string[] {
  if (status?.models) return status.models
  return cli === 'claude-code' ? ['opus', 'sonnet', 'haiku'] : []
}

/** The models an Exodus employee can be pinned to: every listed provider's catalog. */
export function exodusModelOptions(settings: Settings | undefined) {
  return configuredProviders(settings).flatMap((provider) => {
    const catalog = modelCatalog(settings, provider)
    return catalog.map((m) => ({
      value: `${provider}::${m.id}`,
      label: modelLabel(provider, m.id, catalog),
      provider,
      model: m.id
    }))
  })
}

/** Reads the picker's value back; '' (the Default choice) is both null. */
export function parseModelValue(value: string): {
  provider: string | null
  model: string | null
} {
  const i = value.indexOf('::')
  return i < 0
    ? { provider: null, model: null }
    : { provider: value.slice(0, i), model: value.slice(i + 2) }
}

/** What the employee runs on; 'Default' is the English word, the UI translates it. */
export function employeeModelLabel(
  agent: Pick<AgentData, 'runtime' | 'provider' | 'model'>,
  settings: Settings | undefined
): string {
  if (agent.runtime !== 'exodus') {
    const name = CLI_NAMES[agent.runtime]
    return agent.model ? `${name} · ${agent.model}` : name
  }
  if (!agent.provider || !agent.model) return 'Default'
  const provider = agent.provider as AiProviders
  return modelLabel(provider, agent.model, modelCatalog(settings, provider))
}
