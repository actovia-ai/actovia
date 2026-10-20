import { REPORTED_STACK_MAX_CHARS } from '@actovia/shared/constants/systems'
import { fetcher } from '@actovia/shared/utils/http'

/** A stack as it is sent: its head, the frames nearest the throw. */
const bounded = (stack: unknown): string | undefined =>
  typeof stack === 'string' && stack !== ''
    ? stack.slice(0, REPORTED_STACK_MAX_CHARS)
    : undefined

/**
 * Sends an error the renderer caught to the main process's log
 * (`POST /api/v1/logs` → `renderer/<scope>` in the JSONL the Logger tab
 * reads). Fire and forget: reporting must never add a failure of its own,
 * so a refused request is dropped silently — including from the artifact
 * sandbox origin, whose CSP allows no network at all; the call is harmless
 * there, it just never leaves.
 *
 * Two stacks ride along as attributes: `stack`, the error's own, and
 * `componentStack` when the caller has one (an error boundary's
 * `info.componentStack`). Both are sent as the browser gave them — in a
 * packaged build their frames point into the built files — and the main
 * process maps them to source positions before it writes them.
 */
export function reportRendererError(
  scope: string,
  error: unknown,
  attributes: Record<string, unknown> = {}
): void {
  const message =
    error instanceof Error ? error.message : String(error ?? 'unknown')
  const stack = bounded(error instanceof Error ? error.stack : undefined)
  const { componentStack: given, ...rest } = attributes
  const componentStack = bounded(given)
  fetcher<void>('/api/v1/logs', {
    method: 'POST',
    body: {
      level: 'error',
      scope,
      message,
      attributes: {
        ...rest,
        ...(stack ? { stack } : {}),
        ...(componentStack ? { componentStack } : {})
      }
    },
    responseType: 'text'
  }).catch(() => {})
}

// A well-known false positive: browsers fire it when an observer's own
// resize-triggered layout change couldn't be delivered within one frame —
// harmless, and every layout-driven ResizeObserver in the app (Morph, the
// resizable sidebar) can trigger it under fast resizing.
const BENIGN_MESSAGE = /^ResizeObserver loop/u

let installed = false

/**
 * Catches what no `ErrorBoundary` can: React's boundaries only see errors
 * thrown during render, so anything thrown in an event handler, a timer, or
 * a promise nobody awaited went straight to DevTools and nowhere else.
 * Call once per entry that can reach the API (`main.tsx`, the searchbar and
 * quick-chat sub-apps) — never the artifact sandbox: it is a distinct,
 * deliberately isolated origin (see `security.md`) and installing this
 * there would be dead weight, not a safety net.
 */
export function installGlobalErrorReporting(): void {
  if (installed) return
  installed = true

  window.addEventListener('error', (event) => {
    const message =
      event.error instanceof Error ? event.error.message : event.message
    if (BENIGN_MESSAGE.test(message)) return
    reportRendererError('window', event.error ?? event.message, {
      filename: event.filename,
      lineno: event.lineno,
      colno: event.colno
    })
  })

  window.addEventListener('unhandledrejection', (event) => {
    reportRendererError('unhandled-rejection', event.reason)
  })
}
