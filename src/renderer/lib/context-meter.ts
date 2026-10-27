import type {
  ChatContextSnapshot,
  ContextPartKey
} from '@actovia/shared/types/chat-context'

export interface ContextMeter {
  /** Share of the window in use, 0–100; null when the window is unknown. */
  percent: number | null
  /** Summaries + messages have reached LCM's mark: the next run compacts. */
  pastCompaction: boolean
  rows: { key: ContextPartKey; tokens: number; share: number | null }[]
  free: number | null
  /** The mark as a share of the window; null with compaction off. */
  compactPercent: number | null
}

/** What the ring and the Context section draw from a snapshot. */
export function contextMeter(s: ChatContextSnapshot): ContextMeter {
  const window = s.contextWindow > 0 ? s.contextWindow : null
  const share = (tokens: number) => (window ? (tokens / window) * 100 : null)
  const conversation = s.parts
    .filter((p) => p.key === 'summaries' || p.key === 'messages')
    .reduce((n, p) => n + p.tokens, 0)
  return {
    percent: share(s.total),
    pastCompaction: s.compactAt !== null && conversation >= s.compactAt,
    rows: s.parts.map((p) => ({ ...p, share: share(p.tokens) })),
    free: window ? Math.max(0, window - s.total) : null,
    compactPercent:
      window && s.compactAt !== null ? (s.compactAt / window) * 100 : null
  }
}
