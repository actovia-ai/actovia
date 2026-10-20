import type { LogLevelName } from '@actovia/shared/utils/log-query'

// One colour per level, shared by the chart, the list and the detail sheet.
// Error is the destructive token; the rest have no token of their own, and a
// log reads by these four colours whatever the colour tone is.
export const LEVEL_STYLE: Record<
  LogLevelName,
  { chip: string; bar: string; text: string }
> = {
  error: {
    chip: 'bg-destructive/12 text-destructive',
    bar: 'bg-destructive',
    text: 'text-destructive'
  },
  warn: {
    chip: 'bg-amber-500/15 text-amber-700 dark:text-amber-400',
    bar: 'bg-amber-500',
    text: 'text-amber-700 dark:text-amber-400'
  },
  info: {
    chip: 'bg-blue-500/12 text-blue-600 dark:text-blue-400',
    bar: 'bg-blue-500',
    text: 'text-blue-600 dark:text-blue-400'
  },
  debug: {
    chip: 'bg-muted text-muted-foreground',
    bar: 'bg-muted-foreground/40',
    text: 'text-muted-foreground'
  }
}

const pad = (n: number, width = 2) => String(n).padStart(width, '0')

/** `16:16:31` and `.640` of a record's time, in the local clock. */
export function splitLogTime(ts: string): { clock: string; ms: string } {
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return { clock: ts, ms: '' }
  return {
    clock: `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`,
    ms: `.${pad(d.getMilliseconds(), 3)}`
  }
}

/** `16:15` — a chart tick or a time window's edge. */
export function formatClock(ts: string | number): string {
  const d = new Date(ts)
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}
