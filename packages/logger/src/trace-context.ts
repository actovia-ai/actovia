import { AsyncLocalStorage } from 'node:async_hooks'
import { randomBytes } from 'node:crypto'

export interface TraceContext {
  traceId: string
  originTraceId?: string
  attributes: Record<string, unknown>
}

const als = new AsyncLocalStorage<TraceContext>()

export function newTraceId(): string {
  return randomBytes(16).toString('hex')
}

/**
 * Runs `fn` inside a fresh trace. Every `logger.*` call made anywhere in `fn`'s
 * (a)sync execution picks up this trace's `traceId` (and `originTraceId`).
 * Nesting is fine — the inner trace shadows and is restored on exit.
 */
export function withTrace<T>(
  fn: () => T,
  opts?: { originTraceId?: string; attributes?: Record<string, unknown> }
): T {
  const ctx: TraceContext = {
    traceId: newTraceId(),
    originTraceId: opts?.originTraceId,
    attributes: { ...opts?.attributes }
  }
  return als.run(ctx, fn)
}

export function currentTrace(): TraceContext | undefined {
  return als.getStore()
}

/** Merge attributes into the ambient trace so they ride every later log line. No-op outside a trace. */
export function bindTraceAttributes(attrs: Record<string, unknown>): void {
  const ctx = als.getStore()
  if (ctx) Object.assign(ctx.attributes, attrs)
}
