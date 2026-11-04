import { resolvePhilharmonicSettings } from '@actovia/shared/constants/philharmonic-settings'
import type { AgentTool } from '@earendil-works/pi-agent-core'
import { StringEnum, Type } from '@earendil-works/pi-ai'

import type { Settings } from '../../db/schema'
import { trustedContextWindow } from '../providers/resolve-model'
import { getModelFromProvider } from '../utils/chat-message-util'
import { recruitmentModelOptions } from './recruit'

/** Both PM and API employees may change model between requests, never mid-call. */
export function modelRouter(
  setting: Settings,
  initial = getModelFromProvider(setting)
) {
  let current = initial
  let inputTokens = 0
  const options = recruitmentModelOptions(setting)
  const tools: AgentTool[] =
    !resolvePhilharmonicSettings(setting.agents).autoModelRouting ||
    options.length < 2
      ? []
      : [
          {
            name: 'choose_model',
            label: 'Choose Model',
            description: `Choose the model for your NEXT request. Use a small/local model for routine work, a reasoning model for difficult analysis. Stay on the current model when switching would not help. Configured models:\n${options.map((o) => `${o.value}: ${o.snapshot.reasoningLevels.some((l) => l !== 'off') ? 'reasoning' : 'ordinary'}, context ${o.snapshot.contextWindow ?? 'unknown'}`).join('\n')}`,
            parameters: Type.Object({
              model: StringEnum(options.map((o) => o.value)),
              reason: Type.String()
            }),
            execute: async (
              _id: string,
              args: { model: string; reason: string }
            ) => {
              const selected = options.find((o) => o.value === args.model)
              if (!selected) throw new Error('Choose a configured model.')
              const next = getModelFromProvider({
                ...setting,
                providerConfig: {
                  provider: selected.provider,
                  model: selected.model,
                  modelSnapshot: selected.snapshot
                }
              })
              const window = trustedContextWindow(next.model)
              if (window && inputTokens > window * 0.8)
                throw new Error(
                  'This model is too small for the current context. Keep the current model or choose a larger context window.'
                )
              current = next
              return {
                content: [
                  {
                    type: 'text' as const,
                    text: `Next model: ${selected.value}. ${args.reason}`
                  }
                ],
                details: { model: selected.model, provider: selected.provider }
              }
            }
          } as AgentTool
        ]
  return {
    get current() {
      return current
    },
    tools,
    observe(tokens: number) {
      inputTokens = tokens
    }
  }
}
