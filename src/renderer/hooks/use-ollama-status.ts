import { fetcher } from '@actovia/shared/utils/http'
import { useQuery } from '@tanstack/react-query'

export const ollamaStatusKeys = {
  all: ['ollama-status'] as const,
  baseUrl: (baseUrl: string) => [...ollamaStatusKeys.all, baseUrl] as const
}

async function pingOllama(baseUrl: string): Promise<boolean> {
  // "Unreachable" is the answer this probe exists to give, not a failure: a
  // rejecting queryFn would be retried (the client default is one retry after
  // 500 ms) and reported to the log for every half-typed URL.
  try {
    await fetcher(
      `/api/v1/tools/ping-ollama?url=${encodeURIComponent(baseUrl)}`
    )
    return true
  } catch {
    return false
  }
}

export function useOllamaStatus(baseUrl: string | null | undefined) {
  const { data } = useQuery({
    queryKey: ollamaStatusKeys.baseUrl(baseUrl ?? ''),
    queryFn: () => pingOllama(baseUrl!),
    enabled: !!baseUrl,
    // Ollama is usually started in another app: coming back to Actovia is the
    // moment to ask again. Off app-wide (settings autosave), but this writes
    // nothing to settings.
    refetchOnWindowFocus: true
  })
  // Running until proven otherwise, so the dot does not flash red while the
  // first ping is in flight.
  return { isRunning: !!baseUrl && data !== false }
}
