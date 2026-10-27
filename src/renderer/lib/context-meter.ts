import type {
  ChatContextSnapshot,
  ContextPartKey
} from '@actovia/shared/types/chat-context'

export interface ContextMeter {
  /** Share of the window in use, 0–100; null when the window is unknown. */
  percent: number | null
  /** LCM's count is over its mark: compaction follows the run. */
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
    // LCM's own count when the snapshot has it; it compacts only above.
    pastCompaction:
      s.compactAt !== null && (s.lcmTokens ?? conversation) > s.compactAt,
    rows: s.parts.map((p) => ({ ...p, share: share(p.tokens) })),
    free: window ? Math.max(0, window - s.total) : null,
    compactPercent:
      window && s.compactAt !== null ? (s.compactAt / window) * 100 : null
  }
}
