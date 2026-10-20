import type { CliQuota, QuotaWindow } from '@actovia/shared/types/agents'

export interface QuotaPart {
  key: 'fiveHour' | 'sevenDay' | 'other'
  /** The window's name, or the model a window of its own counts. */
  name: string
  percent: number
  /** The CLI stopped on this window and it has not reset yet. */
  limited: boolean
  /** Its reset time has passed: the percentage is from before it. */
  reset: boolean
  resetsAt: number | null
}

const KEYS: Record<string, QuotaPart['key']> = {
  five_hour: 'fiveHour',
  seven_day: 'sevenDay'
}
/** Codex names its windows `primary` / `secondary`; the length says which. */
const DURATION_KEYS: Record<number, QuotaPart['key']> = {
  300: 'fiveHour',
  10080: 'sevenDay'
}

const keyOf = (w: QuotaWindow): QuotaPart['key'] =>
  (!w.model &&
    ((w.durationMins !== undefined && DURATION_KEYS[w.durationMins]) ||
      KEYS[w.name])) ||
  'other'

/** One CLI's quota as the members panel words it (spec 2026-10-16 §6). */
export function quotaParts(q: CliQuota, now: number = Date.now()): QuotaPart[] {
  return q.windows.map((w) => {
    const reset = w.resetsAt !== null && w.resetsAt <= now
    // Mirrors main's noResetStale(): no reset time is believed for an hour.
    const stale =
      w.resetsAt === null && now - (w.seenAt ?? q.asOf) >= 60 * 60_000
    return {
      key: keyOf(w),
      name: w.model ?? w.name,
      percent: Math.round(w.usedPercent),
      limited:
        !reset &&
        !stale &&
        (!!w.rejected ||
          (q.state === 'rejected' &&
            (w.name === q.rejectedWindow || w.usedPercent >= 100))),
      reset,
      resetsAt: w.resetsAt
    }
  })
}
