import type { AgentsSettings } from '../schemas/settings-schema'
import { SETTING_DEFAULTS } from './setting-defaults'

/** Null and absent fields retain the shipped defaults on existing installs. */
export function resolvePhilharmonicSettings(agents?: AgentsSettings | null) {
  const value = agents?.philharmonic
  const defaults = SETTING_DEFAULTS.philharmonic
  return {
    maxRunning: value?.maxRunning ?? defaults.maxRunning,
    pmMaxToolCalls: value?.pmMaxToolCalls ?? defaults.pmMaxToolCalls,
    staffMaxToolCalls: value?.staffMaxToolCalls ?? defaults.staffMaxToolCalls,
    failureLimit: value?.failureLimit ?? defaults.failureLimit,
    autoModelRouting: value?.autoModelRouting ?? defaults.autoModelRouting
  }
}
