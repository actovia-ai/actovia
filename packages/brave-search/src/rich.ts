import type { BraveRichResponse, BraveWebSearchResponse } from './types'

export interface RichHint {
  vertical: string
  callbackKey: string
}

/** The rich hint of a web search made with `enable_rich_callback`, if any. */
export function richHint(
  resp: BraveWebSearchResponse | null | undefined
): RichHint | null {
  const hint = resp?.rich?.hint
  if (!hint?.callback_key) return null
  return { vertical: hint.vertical ?? 'rich', callbackKey: hint.callback_key }
}

export interface RichSource {
  vertical: string
  provider?: string
  providerUrl?: string
  /** The results' data, as compact JSON: what a model reads. */
  json: string
  /** Whether `json` was cut to fit `maxChars`. */
  truncated: boolean
}

export interface RichSourceOptions {
  /** Entries kept of any list (an hourly forecast, a price series). */
  maxItems?: number
  /** The longest `json` may be. */
  maxChars?: number
}

/** Fields that describe the envelope, not the data. */
const ENVELOPE = new Set(['type', 'subtype', 'provider', 'language'])

/** The value without nulls, empty strings, empty lists and empty objects,
 *  each list cut to `maxItems`. `undefined` when nothing is left. */
function compact(value: unknown, maxItems: number): unknown {
  if (value === null || value === undefined || value === '') return undefined
  if (Array.isArray(value)) {
    const items = value
      .slice(0, maxItems)
      .map((v) => compact(v, maxItems))
      .filter((v) => v !== undefined)
    return items.length > 0 ? items : undefined
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .map(([k, v]) => [k, compact(v, maxItems)] as const)
      .filter(([, v]) => v !== undefined)
    return entries.length > 0 ? Object.fromEntries(entries) : undefined
  }
  return value
}

/**
 * A `web/rich` answer as one source: the vertical, who provided it, and the
 * data — empty fields dropped, long series cut, the text bounded. `null` when
 * the callback failed or brought nothing.
 */
export function richToSource(
  resp: BraveRichResponse | null | undefined,
  { maxItems = 24, maxChars = 12_000 }: RichSourceOptions = {}
): RichSource | null {
  if (!resp || resp.response_callback_info?.callback_status === 'failure') {
    return null
  }
  const results = resp.results ?? []
  const data = results
    .map((r) =>
      compact(
        Object.fromEntries(Object.entries(r).filter(([k]) => !ENVELOPE.has(k))),
        maxItems
      )
    )
    .filter((d) => d !== undefined)
  if (data.length === 0) return null

  const first = results[0]
  const full = JSON.stringify(data)
  const truncated = full.length > maxChars
  return {
    vertical: resp.response_callback_info?.vertical ?? first?.subtype ?? 'rich',
    provider: first?.provider?.name ?? first?.provider?.long_name,
    providerUrl: first?.provider?.url,
    json: truncated ? full.slice(0, maxChars) : full,
    truncated
  }
}
