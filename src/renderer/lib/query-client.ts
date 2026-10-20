import {
  getHttpErrorMessage,
  HttpError,
  toErrorI18n
} from '@actovia/shared/utils/http'
import {
  focusManager,
  MutationCache,
  QueryCache,
  QueryClient
} from '@tanstack/react-query'
import { sileo } from 'sileo'

import { i18n } from '@/lib/i18n'
import { reportRendererError } from '@/lib/report-error'

/**
 * A mutation's `meta`, read back by the global `mutationCache.onError`
 * below. `errorTitle` is the toast title on failure (falls back to the
 * catalog's `errors:generic`); `silent: true` skips the toast entirely
 * (reporting still happens — this never means "don't tell the log").
 * `inlineCodes` does the same for an `HttpError` whose code is listed: the
 * caller shows that one in place (a field the server refused), so a toast
 * would say it twice.
 */
export interface MutationMeta extends Record<string, unknown> {
  errorTitle?: string
  silent?: boolean
  inlineCodes?: readonly string[]
}

/**
 * One QueryClient for the app, with two non-overlapping error surfaces:
 * reads report to the structured log only (a failed background read
 * shouldn't interrupt anyone); writes report *and* toast by default, since
 * a mutation is always something the user explicitly asked for. Neither
 * path can produce an unhandled rejection — React Query catches both
 * before they'd ever reach `installGlobalErrorReporting()`'s global
 * listeners, so there is no double-reporting between the two.
 */
export function createAppQueryClient(): QueryClient {
  return new QueryClient({
    queryCache: new QueryCache({
      onError: (error, query) => {
        reportRendererError('query', error, { queryKey: query.queryKey })
      }
    }),
    mutationCache: new MutationCache({
      onError: (error, _variables, _context, mutation) => {
        reportRendererError('mutation', error, {
          mutationKey: mutation.options.mutationKey
        })
        const meta = mutation.meta as MutationMeta | undefined
        if (meta?.silent) return
        if (
          error instanceof HttpError &&
          meta?.inlineCodes?.includes(error.code)
        )
          return
        sileo.error({
          title: meta?.errorTitle ?? i18n.t('errors:generic'),
          description:
            getHttpErrorMessage(error, toErrorI18n(i18n)) ??
            (error instanceof Error ? error.message : String(error))
        })
      }
    }),
    defaultOptions: {
      queries: {
        // Off app-wide: a revalidating settings GET brings back a bumped
        // `updatedAt` that resets the form and re-fires autosave
        // (use-settings.ts). Individual queries whose data an outside writer
        // can change (actovia-ios, actovia-cli, the phone) opt back in with
        // `refetchOnWindowFocus: true` — see "Server state (React Query)" in
        // CLAUDE.md for the current list.
        refetchOnWindowFocus: false,
        // The API is on localhost, so a failure is nearly always persistent
        // (server down, locked, erroring), not transient: the default
        // 3 retries at 1 s + 2 s + 4 s would keep `isLoading` true ~7 s
        // before reporting. One quick retry covers a server mid-restart.
        retry: 1,
        retryDelay: 500,
        // The API is on localhost, so connectivity is irrelevant.
        networkMode: 'always',
        refetchOnReconnect: false
      },
      mutations: { networkMode: 'always' }
    }
  })
}

export const queryClient = createAppQueryClient()

/**
 * The default focus manager listens to `visibilitychange` only, which never
 * fires when an Electron window merely loses focus to another app. Follow the
 * window's own `focus` / `blur` too; `setEventListener` replaces (and cleans
 * up) any previous listener, so installing twice does not double-register.
 *
 * The cleanup this returns only removes THIS registration — it does not put
 * the library's own default listener back. After a full unsubscribe (no one
 * has called `setEventListener` again), `focusManager` re-adds its own
 * default on the next subscriber. That only matters in a test today.
 */
export function installWindowFocusListener(): () => void {
  let remove: (() => void) | undefined
  focusManager.setEventListener((handleFocus) => {
    const onFocus = () => {
      handleFocus(true)
    }
    const onBlur = () => {
      handleFocus(false)
    }
    const onVisibilityChange = () => {
      handleFocus(!document.hidden)
    }
    window.addEventListener('focus', onFocus)
    window.addEventListener('blur', onBlur)
    window.addEventListener('visibilitychange', onVisibilityChange)
    remove = () => {
      window.removeEventListener('focus', onFocus)
      window.removeEventListener('blur', onBlur)
      window.removeEventListener('visibilitychange', onVisibilityChange)
    }
    return remove
  })
  return () => {
    remove?.()
  }
}
