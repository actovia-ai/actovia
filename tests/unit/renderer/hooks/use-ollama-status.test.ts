// @vitest-environment happy-dom
import { focusManager, QueryClientProvider } from '@tanstack/react-query'
import { act, createElement, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

const fetcherMock = vi.fn()
vi.mock('@actovia/shared/utils/http', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@actovia/shared/utils/http')>()),
  fetcher: (...args: unknown[]) => fetcherMock(...args)
}))
const report = vi.fn()
vi.mock('@/lib/report-error', () => ({
  reportRendererError: (...args: unknown[]) => report(...args)
}))
const toastError = vi.fn()
vi.mock('@/components/ui/toast', () => {
  // `toast.add({ type, ...options })` → the spy for that type.
  const byType: Record<string, (options: unknown) => void> = {
    error: (...args: unknown[]) => toastError(...args)
  }
  return {
    toast: {
      add: ({ type, ...options }: { type: string }) => byType[type]?.(options)
    }
  }
})

const { ollamaStatusKeys, useOllamaStatus } =
  await import('@/hooks/use-ollama-status')
const { createAppQueryClient } = await import('@/lib/query-client')

;(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

type Harness = ReturnType<typeof useOllamaStatus> & {
  setBaseUrl: (value: string | null | undefined) => void
}

function Probe({
  initial,
  onReady
}: {
  initial: string | null | undefined
  onReady: (value: Harness) => void
}) {
  const [baseUrl, setBaseUrl] = useState(initial)
  onReady({ ...useOllamaStatus(baseUrl), setBaseUrl })
  return null
}

// Every mounted client listens to the one global focusManager, so a root left
// mounted would answer the focus tests' toggles with fetches of its own.
const mounted: Array<() => Promise<void>> = []

// The app's own client, retries left at React Query's default: a probe that
// rejected would be retried with backoff and reported by `queryCache.onError`.
async function mountStatus(initial: string | null | undefined) {
  let latest: Harness | undefined
  const queryClient = createAppQueryClient()
  const root = createRoot(document.createElement('div'))
  await act(async () => {
    root.render(
      createElement(
        QueryClientProvider,
        { client: queryClient },
        createElement(Probe, {
          initial,
          onReady: (value) => (latest = value)
        })
      )
    )
  })
  mounted.push(async () => {
    await act(async () => {
      root.unmount()
    })
  })
  return {
    queryClient,
    api: () => latest!,
    setBaseUrl: async (value: string | null | undefined) => {
      await act(async () => {
        latest!.setBaseUrl(value)
      })
    }
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

const BASE_URL = 'http://localhost:11434'
const pingUrl = (baseUrl: string) =>
  `/api/v1/tools/ping-ollama?url=${encodeURIComponent(baseUrl)}`

describe('ollamaStatusKeys', () => {
  it('nests each base URL under the ollama-status root', () => {
    expect(ollamaStatusKeys.all).toEqual(['ollama-status'])
    expect(ollamaStatusKeys.baseUrl(BASE_URL)).toEqual([
      'ollama-status',
      BASE_URL
    ])
  })
})

describe('useOllamaStatus', () => {
  afterEach(async () => {
    vi.useRealTimers()
    for (const unmount of mounted.splice(0)) await unmount()
    focusManager.setFocused(undefined)
    fetcherMock.mockReset()
    report.mockClear()
    toastError.mockClear()
  })

  it('is running when the ping answers, and caches the result under the base URL', async () => {
    fetcherMock.mockResolvedValue({ message: 'Ollama is running' })
    const { queryClient, api } = await mountStatus(BASE_URL)

    await act(async () => {
      await vi.waitFor(() =>
        expect(
          queryClient.getQueryData(ollamaStatusKeys.baseUrl(BASE_URL))
        ).toBe(true)
      )
    })

    expect(api().isRunning).toBe(true)
    expect(fetcherMock).toHaveBeenCalledTimes(1)
    expect(fetcherMock).toHaveBeenCalledWith(pingUrl(BASE_URL))
  })

  it('is not running when the ping rejects, and a failed probe is data, not an error', async () => {
    fetcherMock.mockRejectedValue(new Error('Ollama is not reachable'))
    const { queryClient, api } = await mountStatus(BASE_URL)

    await act(async () => {
      await vi.waitFor(() => expect(api().isRunning).toBe(false))
    })

    expect(queryClient.getQueryData(ollamaStatusKeys.baseUrl(BASE_URL))).toBe(
      false
    )
    expect(report).not.toHaveBeenCalled()
    expect(toastError).not.toHaveBeenCalled()
  })

  it('does not retry a failed probe, however long it waits', async () => {
    vi.useFakeTimers()
    fetcherMock.mockRejectedValue(new Error('Ollama is not reachable'))
    const { api } = await mountStatus(BASE_URL)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000)
    })

    expect(api().isRunning).toBe(false)
    expect(fetcherMock).toHaveBeenCalledTimes(1)
    expect(report).not.toHaveBeenCalled()
  })

  it('reads as running while the first ping is in flight, then as it answers', async () => {
    const ping = deferred<unknown>()
    fetcherMock.mockReturnValue(ping.promise)
    const { api } = await mountStatus(BASE_URL)

    expect(fetcherMock).toHaveBeenCalledTimes(1)
    expect(api().isRunning).toBe(true)

    await act(async () => {
      ping.reject(new Error('Ollama is not reachable'))
      await vi.waitFor(() => expect(api().isRunning).toBe(false))
    })
  })

  it.each([undefined, null, ''])(
    'does not ping, and is not running, for a base URL of %j',
    async (baseUrl) => {
      const { api } = await mountStatus(baseUrl)
      await act(async () => {
        await new Promise<void>((resolve) => {
          setTimeout(resolve, 20)
        })
      })

      expect(fetcherMock).not.toHaveBeenCalled()
      expect(api().isRunning).toBe(false)
    }
  )

  it('encodes the base URL, so ?, & and = inside it reach the server intact', async () => {
    fetcherMock.mockResolvedValue({})
    const url = 'http://localhost:11434/?a=b&c=d e'
    await mountStatus(url)

    expect(fetcherMock).toHaveBeenCalledTimes(1)
    expect(fetcherMock).toHaveBeenCalledWith(
      '/api/v1/tools/ping-ollama?url=http%3A%2F%2Flocalhost%3A11434%2F%3Fa%3Db%26c%3Dd%20e'
    )
  })

  it('probes a changed base URL under its own key, without carrying the old result over', async () => {
    const other = 'http://192.168.1.20:11434'
    const otherPing = deferred<unknown>()
    fetcherMock.mockRejectedValueOnce(new Error('Ollama is not reachable'))
    fetcherMock.mockReturnValueOnce(otherPing.promise)
    const { queryClient, api, setBaseUrl } = await mountStatus(BASE_URL)
    await act(async () => {
      await vi.waitFor(() => expect(api().isRunning).toBe(false))
    })

    await setBaseUrl(other)

    expect(fetcherMock).toHaveBeenCalledTimes(2)
    expect(fetcherMock).toHaveBeenLastCalledWith(pingUrl(other))
    expect(api().isRunning).toBe(true)

    await act(async () => {
      otherPing.resolve({})
      await vi.waitFor(() =>
        expect(queryClient.getQueryData(ollamaStatusKeys.baseUrl(other))).toBe(
          true
        )
      )
    })

    expect(api().isRunning).toBe(true)
    expect(queryClient.getQueryData(ollamaStatusKeys.baseUrl(BASE_URL))).toBe(
      false
    )
    expect(report).not.toHaveBeenCalled()
  })

  it('stops reporting running, and pings nothing more, once the base URL is cleared', async () => {
    fetcherMock.mockResolvedValue({})
    const { queryClient, api, setBaseUrl } = await mountStatus(BASE_URL)
    await act(async () => {
      await vi.waitFor(() =>
        expect(
          queryClient.getQueryData(ollamaStatusKeys.baseUrl(BASE_URL))
        ).toBe(true)
      )
    })
    expect(api().isRunning).toBe(true)

    await setBaseUrl('')

    expect(api().isRunning).toBe(false)
    expect(fetcherMock).toHaveBeenCalledTimes(1)
  })

  it('re-pings when the window regains focus, so a server started meanwhile turns the dot green', async () => {
    fetcherMock.mockRejectedValueOnce(new Error('Ollama is not reachable'))
    const { queryClient, api } = await mountStatus(BASE_URL)
    await act(async () => {
      await vi.waitFor(() => expect(api().isRunning).toBe(false))
    })
    expect(fetcherMock).toHaveBeenCalledTimes(1)

    fetcherMock.mockResolvedValue({})
    await act(async () => {
      focusManager.setFocused(false)
      focusManager.setFocused(true)
      await vi.waitFor(() => expect(api().isRunning).toBe(true))
    })

    expect(fetcherMock).toHaveBeenCalledTimes(2)
    expect(fetcherMock).toHaveBeenLastCalledWith(pingUrl(BASE_URL))
    expect(queryClient.getQueryData(ollamaStatusKeys.baseUrl(BASE_URL))).toBe(
      true
    )
    expect(report).not.toHaveBeenCalled()
  })

  it.each([undefined, ''])(
    'does not ping on focus while the base URL is %j',
    async (baseUrl) => {
      await mountStatus(baseUrl)

      await act(async () => {
        focusManager.setFocused(false)
        focusManager.setFocused(true)
        await new Promise<void>((resolve) => {
          setTimeout(resolve, 20)
        })
      })

      expect(fetcherMock).not.toHaveBeenCalled()
    }
  )
})
