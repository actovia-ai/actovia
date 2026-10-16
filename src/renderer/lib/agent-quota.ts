import type { CliQuota } from '@exodus/shared/types/agents'

export interface QuotaPart {
  key: 'fiveHour' | 'sevenDay' | 'other'
  /** The window's name, or the model a window of its own counts. */
  name: string
  percent: number
  limited: boolean
  resetsAt: number | null
}

const KEYS: Record<string, QuotaPart['key']> = {
  five_hour: 'fiveHour',
  seven_day: 'sevenDay'
}

/** One CLI's quota as the members panel words it (spec 2026-10-16 §6). */
export function quotaParts(q: CliQuota): QuotaPart[] {
  return q.windows.map((w) => ({
    key: (!w.model && KEYS[w.name]) || 'other',
    name: w.model ?? w.name,
    percent: Math.round(w.usedPercent),
    limited:
      q.state === 'rejected' &&
      (w.name === q.rejectedWindow || w.usedPercent >= 100),
    resetsAt: w.resetsAt
  }))
}
