import type { ListModelsFn, NormalizedModel } from './types'

interface GoogleModel {
  name: string
  displayName: string
  inputTokenLimit: number | null
  outputTokenLimit: number | null
  thinking?: boolean
}

export const listGoogleModels: ListModelsFn = async ({ apiKey, baseUrl }) => {
  const base = baseUrl ?? 'https://generativelanguage.googleapis.com/v1beta'
  const response = await fetch(`${base}/models?key=${apiKey}`)

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`Google list-models failed (${response.status}): ${body}`)
  }

  const { models } = (await response.json()) as { models: GoogleModel[] }

  // Google's list API reports no chronological signal at all (no created
  // date, no version ordering) — alphabetical by id is just for predictable,
  // stable ordering, not a meaningful "best model first" ranking.
  const sorted = models.toSorted((a, b) => a.name.localeCompare(b.name))

  return sorted.map((m): NormalizedModel => {
    const id = m.name.replace(/^models\//, '')
    // Gemini's `thinking` flag is boolean, not leveled — this 2-state mapping
    // is a fixed convention (spec §2), not per-model data. pi-ai's own
    // thinkingLevelMap collapses named levels to Gemini's numeric
    // thinking-budget underneath, so a 2-state choice is all the composer
    // ever needs to offer for a Gemini model.
    const reasoningLevels = m.thinking ? (['off', 'high'] as const) : []
    return {
      id,
      displayName: m.displayName,
      snapshot: {
        contextWindow: m.inputTokenLimit,
        maxOutputTokens: m.outputTokenLimit,
        reasoningLevels: [...reasoningLevels]
      }
    }
  })
}
