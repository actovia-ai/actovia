// A detail page's question carries its category's last days instead of the
// day's snapshot (actovia-ios `HealthHistory`): listed by day.
import {
  formatDay,
  formatMinutes,
  type HealthDetailRow,
  type HealthDetailSection,
  type HealthFormat,
  isRecord,
  number
} from '@/components/chat/health/health-format'

const MOODS = new Set([
  'veryUnpleasant',
  'unpleasant',
  'slightlyUnpleasant',
  'neutral',
  'slightlyPleasant',
  'pleasant',
  'veryPleasant'
])

/** One value of a detail page's week, by its wire key (`HealthHistory.Day.values`). */
function weekRow(key: string, v: number, f: HealthFormat): HealthDetailRow {
  const { t, locale } = f
  switch (key) {
    case 'asleepHours':
      return {
        label: t('health.field.asleep'),
        value: formatMinutes(v * 60, locale)
      }
    case 'deepMin':
      return { label: t('health.field.deep'), value: formatMinutes(v, locale) }
    case 'remMin':
      return { label: t('health.field.rem'), value: formatMinutes(v, locale) }
    case 'awakeMin':
      return { label: t('health.field.awake'), value: formatMinutes(v, locale) }
    case 'steps':
      return { label: t('health.field.steps'), value: number(v, locale) }
    case 'exerciseMin':
      return {
        label: t('health.field.exercise'),
        value: formatMinutes(v, locale)
      }
    case 'hrvMs':
      return {
        label: t('health.field.hrv'),
        value: t('health.ms', { value: number(v, locale) })
      }
    case 'restingHr':
      return {
        label: t('health.field.restingHr'),
        value: t('health.bpm', { value: Math.trunc(v) })
      }
    case 'respRate':
      return {
        label: t('health.field.respRate'),
        value: t('health.perMin', { value: number(v, locale, 1) })
      }
    case 'weightKg':
      return {
        label: t('health.field.weight'),
        value: t('health.kg', { value: number(v, locale, 1) })
      }
    case 'waterCups':
      return {
        label: t('health.field.water'),
        value: t('health.cups', { count: v })
      }
    default:
      return { label: key, value: number(v, locale, 2) }
  }
}

const WEEK_ORDER = [
  'asleepHours',
  'deepMin',
  'remMin',
  'awakeMin',
  'steps',
  'exerciseMin',
  'hrvMs',
  'restingHr',
  'respRate',
  'weightKg',
  'waterCups'
]

export function weekDetails(
  days: unknown[],
  f: HealthFormat
): HealthDetailSection[] {
  const sections: HealthDetailSection[] = []
  for (const day of days) {
    if (!isRecord(day) || typeof day.date !== 'string') continue
    const values = isRecord(day.values) ? day.values : {}
    const keys = Object.keys(values).toSorted((a, b) => {
      const ia = WEEK_ORDER.indexOf(a)
      const ib = WEEK_ORDER.indexOf(b)
      return (
        (ia === -1 ? WEEK_ORDER.length : ia) -
        (ib === -1 ? WEEK_ORDER.length : ib)
      )
    })
    const rows: HealthDetailRow[] = []
    for (const key of keys) {
      const v = values[key]
      if (typeof v === 'number' && Number.isFinite(v))
        rows.push(weekRow(key, v, f))
    }
    if (typeof day.wake === 'string') {
      rows.push({ label: f.t('health.field.wake'), value: day.wake })
    }
    if (typeof day.mood === 'string') {
      rows.push({
        label: f.t('health.field.mood'),
        value: MOODS.has(day.mood) ? f.t(`health.mood.${day.mood}`) : day.mood
      })
    }
    sections.push({
      title: formatDay(day.date, f.locale),
      rows:
        rows.length > 0 ? rows : [{ label: f.t('health.noData'), value: '' }]
    })
  }
  return sections
}
