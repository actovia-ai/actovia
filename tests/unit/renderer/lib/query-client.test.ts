// @vitest-environment happy-dom
import { HttpError } from '@actovia/shared/utils/http'
import {
  focusManager,
  onlineManager,
  QueryObserver
} from '@tanstack/react-query'
import type { QueryClient } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'

// A recognisable localized string per key, and a catalog that only knows one
// `errors:code.*` entry and the 503 status, so the code -> status -> unknown
// fallback chain of `getHttpErrorMessage` shows in the assertion.
const i18nExists = vi.fn(
  (key: string) => key === 'errors:code.KNOWN_CODE' || key === 'errors:http.503'
)
const i18nT = vi.fn(
  (key: string, params?: Record<string, string>) =>
    `localized(${key}${params ? `:${JSON.stringify(params)}` : ''})`
)
vi.mock('@/lib/i18n', () => ({
  i18n: {
    exists: (...args: [string]) => i18nExists(...args),
    t: (...args: [string, Record<string, string>?]) => i18nT(...args)
  }
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

const { createAppQueryClient, installWindowFocusListener } =
  await import('@/lib/query-client')

// The one quick retry a read gets against the local API (see the client's
// `retryDelay`).
const RETRY_DELAY_MS = 500

const observe = (
  client: QueryClient,
  queryFn: () => Promise<unknown>,
  extra: { retry?: false } = {}
) => {
  const observer = new QueryObserver(client, {
    queryKey: ['failing-read'],
    queryFn,
    ...extra
  })
  const unsubscribe = observer.subscribe(() => {})
  return { observer, unsubscribe }
}

describe('createAppQueryClient', () => {
  afterEach(() => {
    vi.useRealTimers()
    report.mockClear()
    toastError.mockClear()
    i18nExists.mockClear()
    i18nT.mockClear()
    onlineManager.setOnline(true)
  })

  it('a failed query reports but never toasts', async () => {
    vi.useFakeTimers()
    const client = createAppQueryClient()
    const settled = client
      .fetchQuery({
        queryKey: ['boom-query'],
        queryFn: () => Promise.reject(new Error('read failed'))
      })
      .catch(() => {})
    await vi.advanceTimersByTimeAsync(RETRY_DELAY_MS)
    await settled

    expect(report).toHaveBeenCalledTimes(1)
    expect(report).toHaveBeenCalledWith('query', expect.any(Error), {
      queryKey: ['boom-query']
    })
    expect(toastError).not.toHaveBeenCalled()
  })

  it('a failed mutation reports and toasts, using meta.errorTitle', async () => {
    const client = createAppQueryClient()
    await client
      .getMutationCache()
      .build(client, {
        mutationKey: ['boom-mutation'],
        mutationFn: () => Promise.reject(new Error('write failed')),
        meta: { errorTitle: 'Could not save' }
      })
      .execute()
      .catch(() => {})

    expect(report).toHaveBeenCalledTimes(1)
    expect(report).toHaveBeenCalledWith('mutation', expect.any(Error), {
      mutationKey: ['boom-mutation']
    })
    expect(toastError).toHaveBeenCalledWith({
      title: 'Could not save',
      description: 'write failed'
    })
    expect(i18nT).not.toHaveBeenCalled()
  })

  it('meta.silent suppresses the toast but still reports', async () => {
    const client = createAppQueryClient()
    await client
      .getMutationCache()
      .build(client, {
        mutationKey: ['silent-mutation'],
        mutationFn: () => Promise.reject(new Error('write failed')),
        meta: { silent: true }
      })
      .execute()
      .catch(() => {})

    expect(report).toHaveBeenCalledTimes(1)
    expect(toastError).not.toHaveBeenCalled()
  })

  it('a mutation with no meta.errorTitle falls back to the catalog title, errors:generic', async () => {
    const client = createAppQueryClient()
    await client
      .getMutationCache()
      .build(client, {
        mutationKey: ['untitled-mutation'],
        mutationFn: () => Promise.reject(new Error('write failed'))
      })
      .execute()
      .catch(() => {})

    expect(i18nT).toHaveBeenCalledWith('errors:generic')
    expect(toastError).toHaveBeenCalledWith({
      title: 'localized(errors:generic)',
      description: 'write failed'
    })
  })

  it('resolves the fallback title when the mutation fails, so it follows a language change', async () => {
    const client = createAppQueryClient()
    const fail = () =>
      client
        .getMutationCache()
        .build(client, {
          mutationFn: () => Promise.reject(new Error('write failed'))
        })
        .execute()
        .catch(() => {})
    await fail()
    i18nT.mockImplementationOnce(() => 'Etwas ist schiefgelaufen')
    await fail()

    expect(toastError).toHaveBeenLastCalledWith({
      title: 'Etwas ist schiefgelaufen',
      description: 'write failed'
    })
  })

  describe('a failing read', () => {
    // The API is on localhost, so a failure is almost always persistent:
    // React Query's remote-API default (3 retries, 1 s + 2 s + 4 s) would keep
    // `isLoading` true for ~7 s. One quick retry, then report.
    it('is asked once more after a short delay, then reported', async () => {
      vi.useFakeTimers()
      const client = createAppQueryClient()
      const queryFn = vi.fn(() => Promise.reject(new Error('read failed')))
      const { observer, unsubscribe } = observe(client, queryFn)

      await vi.advanceTimersByTimeAsync(RETRY_DELAY_MS - 1)
      expect(queryFn).toHaveBeenCalledTimes(1)
      expect(observer.getCurrentResult().isLoading).toBe(true)
      expect(report).not.toHaveBeenCalled()

      await vi.advanceTimersByTimeAsync(1)
      expect(queryFn).toHaveBeenCalledTimes(2)
      expect(observer.getCurrentResult().isError).toBe(true)
      expect(observer.getCurrentResult().isLoading).toBe(false)
      expect(report).toHaveBeenCalledTimes(1)
      expect(report).toHaveBeenCalledWith('query', expect.any(Error), {
        queryKey: ['failing-read']
      })

      await vi.advanceTimersByTimeAsync(60_000)
      expect(queryFn).toHaveBeenCalledTimes(2)
      expect(report).toHaveBeenCalledTimes(1)
      unsubscribe()
    })

    it('a query that opts out with retry: false is asked exactly once', async () => {
      vi.useFakeTimers()
      const client = createAppQueryClient()
      const queryFn = vi.fn(() => Promise.reject(new Error('read failed')))
      const { observer, unsubscribe } = observe(client, queryFn, {
        retry: false
      })

      await vi.advanceTimersByTimeAsync(0)
      expect(observer.getCurrentResult().isError).toBe(true)
      expect(report).toHaveBeenCalledTimes(1)

      await vi.advanceTimersByTimeAsync(60_000)
      expect(queryFn).toHaveBeenCalledTimes(1)
      unsubscribe()
    })

    it('a read that recovers on the retry is never reported', async () => {
      vi.useFakeTimers()
      const client = createAppQueryClient()
      const queryFn = vi
        .fn<() => Promise<string>>()
        .mockRejectedValueOnce(new Error('server restarting'))
        .mockResolvedValue('data')
      const { observer, unsubscribe } = observe(client, queryFn)

      await vi.advanceTimersByTimeAsync(RETRY_DELAY_MS)

      expect(queryFn).toHaveBeenCalledTimes(2)
      expect(observer.getCurrentResult().data).toBe('data')
      expect(report).not.toHaveBeenCalled()
      unsubscribe()
    })

    it('a mutation is not retried', async () => {
      vi.useFakeTimers()
      const client = createAppQueryClient()
      const mutationFn = vi.fn(() => Promise.reject(new Error('write failed')))
      const settled = client
        .getMutationCache()
        .build(client, { mutationKey: ['no-retry-mutation'], mutationFn })
        .execute()
        .catch(() => {})

      await vi.advanceTimersByTimeAsync(60_000)
      await settled

      expect(mutationFn).toHaveBeenCalledTimes(1)
      expect(report).toHaveBeenCalledTimes(1)
    })
  })

  describe("a failed mutation's toast description", () => {
    const fail = async (thrown: unknown, meta?: Record<string, unknown>) => {
      const client = createAppQueryClient()
      await client
        .getMutationCache()
        .build(client, {
          mutationKey: ['described-mutation'],
          mutationFn: () => Promise.reject(thrown),
          meta
        })
        .execute()
        .catch(() => {})
    }

    it('is the localized text of a code-driven HttpError, with its params', async () => {
      await fail(
        new HttpError(
          400,
          'KNOWN_CODE',
          'raw server text',
          { label: 'OpenAI' },
          false
        ),
        { errorTitle: 'Could not save' }
      )

      expect(i18nT).toHaveBeenCalledWith('errors:code.KNOWN_CODE', {
        label: 'OpenAI'
      })
      expect(toastError).toHaveBeenCalledTimes(1)
      expect(toastError).toHaveBeenCalledWith({
        title: 'Could not save',
        description: 'localized(errors:code.KNOWN_CODE:{"label":"OpenAI"})'
      })
    })

    it('falls back to the status text, then to the generic one, for an unknown code', async () => {
      await fail(new HttpError(503, 'NOT_IN_CATALOG', 'raw', undefined, false))
      await fail(new HttpError(418, 'NOT_IN_CATALOG', 'raw', undefined, false))

      expect(toastError).toHaveBeenNthCalledWith(1, {
        title: 'localized(errors:generic)',
        description: 'localized(errors:http.503)'
      })
      expect(toastError).toHaveBeenNthCalledWith(2, {
        title: 'localized(errors:generic)',
        description: 'localized(errors:http.unknown)'
      })
    })

    it('is the verbatim message of an HttpError that carries a custom one', async () => {
      await fail(new HttpError(500, 'KNOWN_CODE', 'Provider said: bad key'))

      // Only the title is looked up: the description stays as the server said.
      expect(i18nT.mock.calls).toEqual([['errors:generic']])
      expect(toastError).toHaveBeenCalledWith({
        title: 'localized(errors:generic)',
        description: 'Provider said: bad key'
      })
    })

    it('is the message of a plain Error, untouched by the catalog', async () => {
      await fail(new Error('write failed'))

      expect(i18nT.mock.calls).toEqual([['errors:generic']])
      expect(toastError).toHaveBeenCalledWith({
        title: 'localized(errors:generic)',
        description: 'write failed'
      })
    })

    it('is String(thrown) for something that is not an Error', async () => {
      await fail('plain string failure')

      expect(toastError).toHaveBeenCalledWith({
        title: 'localized(errors:generic)',
        description: 'plain string failure'
      })
    })

    it('meta.silent still skips the toast for an HttpError, and still reports', async () => {
      await fail(new HttpError(400, 'KNOWN_CODE', 'raw', undefined, false), {
        silent: true
      })

      expect(toastError).not.toHaveBeenCalled()
      expect(report).toHaveBeenCalledTimes(1)
    })

    it('meta.inlineCodes skips the toast only for those codes (the form shows them), and still reports', async () => {
      await fail(
        new HttpError(400, 'SECRET_REENTRY_REQUIRED', 'raw', { field: 'url' }),
        { inlineCodes: ['SECRET_REENTRY_REQUIRED'] }
      )
      expect(toastError).not.toHaveBeenCalled()
      expect(report).toHaveBeenCalledTimes(1)

      await fail(new HttpError(500, 'DB_SAVE_FAILED', 'raw'), {
        inlineCodes: ['SECRET_REENTRY_REQUIRED']
      })
      expect(toastError).toHaveBeenCalledTimes(1)
    })
  })

  describe('while the OS reports no network', () => {
    // The API is on localhost, so connectivity is irrelevant: with React
    // Query's default networkMode ('online') a query or mutation would sit
    // paused forever. A hang guard keeps a regression a failure, not a
    // stuck suite.
    const HUNG = Symbol('hung')
    const settle = <T>(promise: Promise<T>) =>
      Promise.race([
        promise,
        new Promise<typeof HUNG>((resolve) => {
          setTimeout(() => {
            resolve(HUNG)
          }, 200)
        })
      ])

    it('a query still runs', async () => {
      const client = createAppQueryClient()
      onlineManager.setOnline(false)

      const result = await settle(
        client.fetchQuery({
          queryKey: ['offline-query'],
          queryFn: () => Promise.resolve('data')
        })
      )

      expect(result).toBe('data')
      expect(client.getQueryState(['offline-query'])?.fetchStatus).toBe('idle')
    })

    it('a mutation still runs', async () => {
      const client = createAppQueryClient()
      onlineManager.setOnline(false)

      const mutation = client.getMutationCache().build(client, {
        mutationKey: ['offline-mutation'],
        mutationFn: () => Promise.resolve('saved')
      })
      const result = await settle(mutation.execute())

      expect(result).toBe('saved')
      expect(mutation.state.isPaused).toBe(false)
    })

    it('does not refetch every active query when connectivity returns', () => {
      const defaults = createAppQueryClient().getDefaultOptions()

      expect(defaults.queries?.refetchOnReconnect).toBe(false)
    })
  })
})

const callsFor = (spy: { mock: { calls: unknown[][] } }, type: string) =>
  spy.mock.calls.filter(([name]) => name === type).length

describe('installWindowFocusListener', () => {
  let uninstall: (() => void) | undefined
  let client: QueryClient | undefined

  afterEach(() => {
    uninstall?.()
    uninstall = undefined
    client?.unmount()
    client?.clear()
    client = undefined
    vi.restoreAllMocks()
    // There is no public way back to the library's own listener, so put an
    // equivalent one in place for whatever runs after this file.
    focusManager.setEventListener((handleFocus) => {
      const listener = () => {
        handleFocus()
      }
      window.addEventListener('visibilitychange', listener, false)
      return () => {
        window.removeEventListener('visibilitychange', listener)
      }
    })
    focusManager.setFocused(undefined)
  })

  it('follows the window losing and regaining focus', () => {
    uninstall = installWindowFocusListener()

    window.dispatchEvent(new Event('blur'))
    expect(focusManager.isFocused()).toBe(false)

    window.dispatchEvent(new Event('focus'))
    expect(focusManager.isFocused()).toBe(true)
  })

  it('still follows the page becoming hidden and visible', () => {
    uninstall = installWindowFocusListener()
    const hidden = vi.spyOn(document, 'hidden', 'get')

    hidden.mockReturnValue(true)
    document.dispatchEvent(new Event('visibilitychange', { bubbles: true }))
    expect(focusManager.isFocused()).toBe(false)

    hidden.mockReturnValue(false)
    document.dispatchEvent(new Event('visibilitychange', { bubbles: true }))
    expect(focusManager.isFocused()).toBe(true)
  })

  it('refetches an opt-in query on refocus and leaves a default one alone', async () => {
    uninstall = installWindowFocusListener()
    client = createAppQueryClient()
    client.mount()
    const optIn = vi.fn(() => Promise.resolve('opt-in'))
    const byDefault = vi.fn(() => Promise.resolve('default'))
    const unsubscribe = [
      new QueryObserver(client, {
        queryKey: ['opt-in'],
        queryFn: optIn,
        refetchOnWindowFocus: true
      }),
      new QueryObserver(client, {
        queryKey: ['default'],
        queryFn: byDefault
      })
    ].map((observer) => observer.subscribe(() => {}))
    await vi.waitFor(() => {
      expect(optIn).toHaveBeenCalledTimes(1)
      expect(byDefault).toHaveBeenCalledTimes(1)
      expect(client!.isFetching()).toBe(0)
    })

    window.dispatchEvent(new Event('blur'))
    window.dispatchEvent(new Event('focus'))

    await vi.waitFor(() => {
      expect(optIn).toHaveBeenCalledTimes(2)
      expect(client!.isFetching()).toBe(0)
    })
    expect(byDefault).toHaveBeenCalledTimes(1)
    unsubscribe.forEach((off) => {
      off()
    })
  })

  it('installing again replaces the listeners instead of adding to them', () => {
    installWindowFocusListener()
    const add = vi.spyOn(window, 'addEventListener')
    const remove = vi.spyOn(window, 'removeEventListener')
    uninstall = installWindowFocusListener()

    for (const type of ['focus', 'blur', 'visibilitychange']) {
      expect(callsFor(add, type)).toBe(1)
      expect(callsFor(remove, type)).toBe(1)
    }
  })

  it('the cleanup it returns removes the listeners', () => {
    uninstall = installWindowFocusListener()
    window.dispatchEvent(new Event('blur'))
    expect(focusManager.isFocused()).toBe(false)
    window.dispatchEvent(new Event('focus'))

    uninstall()
    window.dispatchEvent(new Event('blur'))

    expect(focusManager.isFocused()).toBe(true)
  })
})
