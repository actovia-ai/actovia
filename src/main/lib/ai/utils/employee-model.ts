import type { Model } from '@earendil-works/pi-ai'
import { ConfigurationError, ErrorCode } from '@exodus/shared'

import type { Agent, Settings } from '../../db/schema'
import { getModelFromProvider } from './model-util'

/**
 * The model an Actovia employee runs on: its own provider + model when set,
 * else the app's (spec §8.1). Its own choice never falls back silently — a
 * provider without a key, or a model gone, fails the step with the reason.
 */
export function resolveEmployeeModel(
  agent: Pick<Agent, 'provider' | 'model'>,
  setting: Settings
): { model: Model<string>; apiKey: string } {
  if (!agent.provider || !agent.model) return getModelFromProvider(setting)
  try {
    return getModelFromProvider({
      ...setting,
      providerConfig: { provider: agent.provider, model: agent.model }
    } as Settings)
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    throw new ConfigurationError(
      ErrorCode.CONFIG_MISSING_PROVIDER,
      `This employee's model (${agent.provider} · ${agent.model}) is unavailable: ${reason}`
    )
  }
}
