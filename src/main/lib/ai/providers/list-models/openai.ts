import { MODEL_METADATA_FALLBACK } from '../resolve-model'
import type { ListModelsFn, NormalizedModel } from './types'

interface OpenAiModel {
  id: string
  created: number
  shutdown_date?: string | number | null
}

// Documented as a date string (`2027-01-20`); a Unix timestamp is read too,
// and anything else is no date at all.
function shutdownDay(value: OpenAiModel['shutdown_date']): string | null {
  if (typeof value === 'string')
    return /^\d{4}-\d{2}-\d{2}/u.test(value) ? value.slice(0, 10) : null
  if (typeof value === 'number' && Number.isFinite(value) && value > 0)
    return new Date(value * 1000).toISOString().slice(0, 10)
  return null
}

export const listOpenAiModels: ListModelsFn = async ({ apiKey, baseUrl }) => {
  const url = `${baseUrl ?? 'https://api.openai.com/v1'}/models`
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${apiKey}` }
  })

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`OpenAI list-models failed (${response.status}): ${body}`)
  }

  const { data } = (await response.json()) as { data: OpenAiModel[] }

  // OpenAI's list API returns the full catalog with no inherent ordering —
  // newest-first (by `created`) is the useful default; a model carrying a
  // `shutdown_date` (announced retirement) sinks below every still-current
  // model regardless of age, since picking one fresh is rarely what you want.
  const sorted = data.toSorted((a, b) => {
    const aRetiring = a.shutdown_date != null
    const bRetiring = b.shutdown_date != null
    if (aRetiring !== bRetiring) return aRetiring ? 1 : -1
    return b.created - a.created
  })

  return sorted.map((m): NormalizedModel => {
    const fallback = MODEL_METADATA_FALLBACK[m.id]
    const retiresAt = shutdownDay(m.shutdown_date)
    return {
      id: m.id,
      displayName: m.id,
      snapshot: {
        contextWindow: fallback?.contextWindow ?? null,
        maxOutputTokens: fallback?.maxOutputTokens ?? null,
        reasoningLevels: fallback?.reasoningLevels ?? []
      },
      ...(retiresAt ? { retiresAt } : {})
    }
  })
}
