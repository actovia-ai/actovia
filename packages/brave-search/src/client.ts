export const BRAVE_API_BASE = 'https://api.search.brave.com/res/v1'

/** Why a request failed: Brave said no, or never answered. */
export type BraveFailure =
  | 'rate_limited'
  | 'unauthorized'
  | 'quota'
  | 'http'
  | 'network'

const FAILURE_MESSAGES: Record<BraveFailure, string> = {
  rate_limited: 'Brave Search rate limit reached',
  unauthorized: 'Brave Search rejected the API key',
  quota: "Brave Search plan's quota is used up",
  http: 'Brave Search answered with an error',
  network: 'Brave Search could not be reached'
}

/**
 * A request Brave answered with a non-2xx. The message carries neither the
 * query nor the key, so it can be logged or shown as it is.
 */
export class BraveSearchError extends Error {
  constructor(
    readonly failure: BraveFailure,
    readonly status?: number
  ) {
    super(
      status
        ? `${FAILURE_MESSAGES[failure]} (HTTP ${status})`
        : FAILURE_MESSAGES[failure]
    )
    this.name = 'BraveSearchError'
  }
}

export function failureOfStatus(status: number): BraveFailure {
  if (status === 429) return 'rate_limited'
  if (status === 401 || status === 403) return 'unauthorized'
  if (status === 402) return 'quota'
  return 'http'
}

export interface BraveClientOptions {
  apiKey: string
  /** Defaults to the global `fetch`, read at call time. */
  fetch?: typeof fetch
  baseUrl?: string
  /** The pause before the one retry of a 429 (the free tier is 1 req/s). */
  retryDelayMs?: number
}

export interface BraveClient {
  get<T>(
    path: string,
    params: URLSearchParams,
    signal?: AbortSignal
  ): Promise<T>
}

/**
 * The Brave API over `fetch`: asks for gzip, retries a 429 once after a short
 * pause, and throws a `BraveSearchError` for a non-2xx it gives up on. A
 * request that never got an answer throws what `fetch` threw.
 */
export function createBraveClient({
  apiKey,
  fetch: fetchImpl,
  baseUrl = BRAVE_API_BASE,
  retryDelayMs = 1200
}: BraveClientOptions): BraveClient {
  return {
    async get<T>(path: string, params: URLSearchParams, signal?: AbortSignal) {
      const query = params.toString()
      const url = `${baseUrl}${path}${query ? `?${query}` : ''}`
      for (let attempt = 0; ; attempt++) {
        const res = await (fetchImpl ?? globalThis.fetch)(url, {
          headers: {
            Accept: 'application/json',
            'Accept-Encoding': 'gzip',
            'x-subscription-token': apiKey
          },
          signal
        })
        if (res.ok) return (await res.json()) as T
        if (res.status === 429 && attempt === 0) {
          await new Promise((r) => setTimeout(r, retryDelayMs))
          continue
        }
        throw new BraveSearchError(failureOfStatus(res.status), res.status)
      }
    }
  }
}
