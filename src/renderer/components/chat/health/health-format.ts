// Formatting for what a question from the phone's Health workspace carried
// (`health-context.ts`): the locale's numbers, days and durations, and
// Health's category names.
import {
  healthSnapshotSchema,
  type HealthSnapshot
} from '@actovia/shared/types/health'

export type HealthChipIcon = 'sleep' | 'steps' | 'heart' | 'water' | 'health'

export interface HealthChip {
  icon: HealthChipIcon
  text: string
}

export interface HealthDetailRow {
  label: string
  value: string
}

export interface HealthDetailSection {
  title: string
  rows: HealthDetailRow[]
}

/** `t` is the `chat` namespace's; `locale` a BCP 47 tag for `Intl`. */
export interface HealthFormat {
  t: (key: string, options?: Record<string, unknown>) => string
  locale: string
}

const CATEGORIES = ['sleep', 'activity', 'recovery', 'body'] as const

export function parse(json: string): unknown {
  try {
    return JSON.parse(json)
  } catch {
    return undefined
  }
}

export function has<T>(v: T | null | undefined): v is T {
  return v !== null && v !== undefined
}

export function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
}

export function snapshotOf(value: unknown): HealthSnapshot | null {
  const parsed = healthSnapshotSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}

/** A category's title by its wire name; one this build doesn't know reads as sent. */
export function categoryTitle(wire: string, f: HealthFormat): string {
  return (CATEGORIES as readonly string[]).includes(wire)
    ? f.t(`health.category.${wire}`)
    : wire
}

type DurationFormatCtor = new (
  locale: string,
  options: Record<string, string>
) => { format: (d: Record<string, number>) => string }

/** Minutes as hours and minutes, narrow — "7h 12m", "42m" — as iOS draws them. */
export function formatMinutes(total: number, locale: string): string {
  const minutes = Math.max(0, Math.round(total))
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  const DurationFormat = (Intl as { DurationFormat?: DurationFormatCtor })
    .DurationFormat
  if (DurationFormat) {
    try {
      return new DurationFormat(locale, {
        style: 'narrow',
        minutesDisplay: 'always'
      }).format(h > 0 ? { hours: h, minutes: m } : { minutes: m })
    } catch {
      // An unknown tag: the plain form below.
    }
  }
  return `${h}:${String(m).padStart(2, '0')}`
}

export function number(n: number, locale: string, maxFraction = 0): string {
  try {
    return new Intl.NumberFormat(locale, {
      maximumFractionDigits: maxFraction
    }).format(n)
  } catch {
    return String(n)
  }
}

/** "2026-10-01" as the locale writes a day: "Wed, Oct 1". */
export function formatDay(date: string, locale: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(date)
  if (!match) return date
  const d = new Date(Date.UTC(+match[1], +match[2] - 1, +match[3]))
  try {
    return new Intl.DateTimeFormat(locale, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      timeZone: 'UTC'
    }).format(d)
  } catch {
    return date
  }
}
