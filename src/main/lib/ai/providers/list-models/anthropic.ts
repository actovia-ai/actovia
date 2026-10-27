import type { EffortLevel } from '@actovia/shared/schemas/settings-schema'

import type { ListModelsFn, NormalizedModel } from './types'

const EFFORT_LEVELS_IN_ORDER: Exclude<EffortLevel, 'off'>[] = [
  'low',
  'medium',
  'high',
  'xhigh',
  'max'
]

interface AnthropicModel {
  id: string
  display_name: string
  max_input_tokens: number | null
  max_tokens: number | null
  capabilities: {
    effort?: {
      supported: boolean
      low?: { supported: boolean }
      medium?: { supported: boolean }
      high?: { supported: boolean }
      xhigh?: { supported: boolean } | null
      max?: { supported: boolean }
    }
    thinking?: {
      supported: boolean
      types?: {
        adaptive?: { supported: boolean } | null
        enabled?: { supported: boolean } | null
      } | null
    } | null
  } | null
}

export const listAnthropicModels: ListModelsFn = async ({
  apiKey,
  baseUrl
}) => {
  const url = `${baseUrl ?? 'https://api.anthropic.com'}/v1/models`
  const response = await fetch(url, {
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    }
  })

  if (!response.ok) {
    const body = await response.text()
    throw new Error(
      `Anthropic list-models failed (${response.status}): ${body}`
    )
  }

  const { data } = (await response.json()) as { data: AnthropicModel[] }

  return data.map((m): NormalizedModel => {
    const effort = m.capabilities?.effort
    const thinkingTypes = m.capabilities?.thinking?.types
    const levels: EffortLevel[] = effort?.supported
      ? [
          'off',
          ...EFFORT_LEVELS_IN_ORDER.filter((level) => effort[level]?.supported)
        ]
      : []
    return {
      id: m.id,
      displayName: m.display_name,
      snapshot: {
        contextWindow: m.max_input_tokens,
        maxOutputTokens: m.max_tokens,
        reasoningLevels: levels,
        // Left unset when the API doesn't say (resolveModel's id rule).
        ...(thinkingTypes
          ? {
              adaptiveThinking: thinkingTypes.adaptive?.supported === true,
              budgetThinking: thinkingTypes.enabled?.supported === true
            }
          : {})
      }
    }
  })
}
