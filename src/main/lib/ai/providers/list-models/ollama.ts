import type { ListModelsFn, NormalizedModel } from './types'

export const listOllamaModels: ListModelsFn = async ({ baseUrl }) => {
  // `providers.ollamaBaseUrl` is shared with chat's Ollama path
  // (src/main/lib/ai/providers/ollama.ts), which hands it to an
  // OpenAI-compatible SDK that appends `/chat/completions` — so that path's
  // own fallback is `http://localhost:11434/v1` and a user-entered value may
  // also carry a trailing `/v1`. Ollama serves `/api/tags` at the server
  // root, not under `/v1`, so strip a trailing `/v1` (with or without a
  // trailing slash) before appending it here, regardless of which
  // convention the configured baseUrl follows.
  const base = (baseUrl ?? 'http://localhost:11434').replace(/\/v1\/?$/, '')
  const response = await fetch(`${base}/api/tags`)

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`Ollama list-models failed (${response.status}): ${body}`)
  }

  const { models } = (await response.json()) as {
    models: { name: string; modified_at?: string }[]
  }

  // Ollama's list has no notion of a model's real release date — `modified_at`
  // (when it was last pulled/updated locally) is the closest available proxy
  // for "recent," so most-recently-pulled sorts first.
  const sorted = models.toSorted(
    (a, b) => Date.parse(b.modified_at ?? '') - Date.parse(a.modified_at ?? '')
  )

  return sorted.map((m): NormalizedModel => ({
    id: m.name,
    displayName: m.name,
    snapshot: {
      contextWindow: null,
      maxOutputTokens: null,
      reasoningLevels: []
    }
  }))
}
