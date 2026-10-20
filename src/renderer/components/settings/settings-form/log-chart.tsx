import { TEST_IDS } from '@actovia/shared/constants/test-ids'
import {
  LOG_LEVELS,
  type LogHistogram,
  type LogLevelName
} from '@actovia/shared/utils/log-query'
import { memo, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useFormat } from '@/lib/format'
import { cn } from '@/lib/utils'

import { formatClock, LEVEL_STYLE } from './log-levels'

export interface LogWindow {
  from: number
  to: number
}

interface LogChartProps {
  histogram: LogHistogram | undefined
  /** Lines the list shows, every filter applied. */
  total: number
  /** The levels shown; the legend toggles them. */
  levels: ReadonlySet<LogLevelName>
  onToggleLevel: (level: LogLevelName) => void
  timeWindow: LogWindow | null
  onPickWindow: (next: LogWindow | null) => void
}

const TICKS = 5

/**
 * The day's lines over time, stacked by level. A bar is a time window: a
 * click shows only its lines, a second click (or the chip) shows them all
 * again. The legend is the level filter. Hovering a bar puts its counts in
 * the header, in place of the summary.
 */
export const LogChart = memo(function LogChart({
  histogram,
  total,
  levels,
  onToggleLevel,
  timeWindow,
  onPickWindow
}: LogChartProps) {
  const { t } = useTranslation('settings')
  const { number: formatNumber } = useFormat()
  const [hovered, setHovered] = useState<number | null>(null)

  const buckets = histogram?.buckets ?? []
  const bucketMs = (histogram?.bucketMinutes ?? 1) * 60_000

  const levelTotals = useMemo(() => {
    const totals = { error: 0, warn: 0, info: 0, debug: 0 }
    for (const b of buckets) {
      for (const level of LOG_LEVELS) totals[level] += b[level]
    }
    return totals
  }, [buckets])

  // The tallest bar of what is shown sets the scale.
  const max = useMemo(() => {
    let m = 0
    for (const b of buckets) {
      let sum = 0
      for (const level of LOG_LEVELS) if (levels.has(level)) sum += b[level]
      if (sum > m) m = sum
    }
    return m
  }, [buckets, levels])

  const ticks = useMemo(() => {
    if (buckets.length === 0) return []
    const count = Math.min(TICKS, buckets.length)
    return Array.from({ length: count }, (_, i) => {
      const index =
        count === 1 ? 0 : Math.round((i * (buckets.length - 1)) / (count - 1))
      return {
        index,
        label: formatClock(buckets[index].start),
        left: ((index + 0.5) / buckets.length) * 100
      }
    })
  }, [buckets])

  const hoveredBucket = hovered === null ? null : buckets[hovered]

  return (
    <div
      data-testid={TEST_IDS.logger.chart}
      className="bg-card flex flex-col gap-3 rounded-xl border px-4 pt-3 pb-2"
    >
      <div className="flex min-h-5 flex-wrap items-center justify-between gap-x-4 gap-y-1 text-xs">
        <span className="text-muted-foreground tabular-nums">
          {hoveredBucket ? (
            <BucketReadout
              bucket={hoveredBucket}
              bucketMs={bucketMs}
              levels={levels}
            />
          ) : (
            <>
              <span className="text-foreground font-medium">
                {formatNumber(total)}
              </span>{' '}
              {t('logger.chart.lines', { count: total })}
              {' · '}
              {t('logger.chart.newestFirst')}
            </>
          )}
        </span>
        <div className="flex items-center gap-1">
          {LOG_LEVELS.map((level) => {
            const on = levels.has(level)
            return (
              <button
                key={level}
                type="button"
                aria-pressed={on}
                data-testid={TEST_IDS.logger.levelToggle}
                data-level={level}
                onClick={() => onToggleLevel(level)}
                className={cn(
                  'hover:bg-muted flex h-6 items-center gap-1.5 rounded-md px-1.5 transition-[opacity,background-color] duration-150 ease-out',
                  !on && 'opacity-40'
                )}
              >
                <span
                  className={cn('size-2 rounded-[2px]', LEVEL_STYLE[level].bar)}
                />
                <span>{t(`logger.levels.${level}`)}</span>
                <span className="text-muted-foreground tabular-nums">
                  {formatNumber(levelTotals[level])}
                </span>
              </button>
            )
          })}
        </div>
      </div>

      {buckets.length === 0 ? (
        <div className="h-24" />
      ) : (
        <div>
          <div
            role="group"
            aria-label={t('logger.chart.label')}
            className="flex h-24 items-end gap-[2px]"
            onMouseLeave={() => setHovered(null)}
          >
            {buckets.map((bucket, i) => {
              const from = Date.parse(bucket.start)
              const to = from + bucketMs
              // Exactly this bar's window, or one that only overlaps it
              // ("Lines around" picks two minutes across bars).
              const picked = timeWindow?.from === from && timeWindow.to === to
              const dimmed =
                timeWindow !== null &&
                !(from < timeWindow.to && to > timeWindow.from)
              let sum = 0
              for (const level of LOG_LEVELS) {
                if (levels.has(level)) sum += bucket[level]
              }
              return (
                <button
                  key={bucket.start}
                  type="button"
                  aria-label={`${formatClock(from)}–${formatClock(to)}`}
                  aria-pressed={picked}
                  data-testid={TEST_IDS.logger.chartBar}
                  className="group flex h-full min-w-0 flex-1 flex-col-reverse rounded-t-[3px] outline-none"
                  onMouseEnter={() => setHovered(i)}
                  onFocus={() => setHovered(i)}
                  onBlur={() => setHovered(null)}
                  onClick={() => onPickWindow(picked ? null : { from, to })}
                >
                  {/* Hover and focus get a column of their own behind the
                      bar, so an empty bucket can be aimed at too. */}
                  <span
                    className={cn(
                      'flex w-full flex-col-reverse overflow-hidden rounded-t-[3px] transition-opacity duration-150 ease-out group-focus-visible:ring-2 group-focus-visible:ring-ring',
                      dimmed && 'opacity-30',
                      hovered === i && !picked && 'opacity-80'
                    )}
                    style={{ height: max ? `${(sum / max) * 100}%` : 0 }}
                  >
                    {/* Error at the top of the stack, where the eye lands. */}
                    {(['debug', 'info', 'warn', 'error'] as const).map(
                      (level) =>
                        levels.has(level) && bucket[level] > 0 ? (
                          <span
                            key={level}
                            className={cn(
                              'w-full shrink-0',
                              LEVEL_STYLE[level].bar
                            )}
                            style={{
                              height: `${(bucket[level] / sum) * 100}%`
                            }}
                          />
                        ) : null
                    )}
                  </span>
                </button>
              )
            })}
          </div>
          <div className="relative mt-1.5 h-4 border-t pt-1">
            {ticks.map((tick, i) => (
              <span
                key={tick.index}
                className={cn(
                  'text-muted-foreground absolute font-mono text-2xs tabular-nums',
                  i === 0
                    ? 'translate-x-0'
                    : i === ticks.length - 1
                      ? '-translate-x-full'
                      : '-translate-x-1/2'
                )}
                style={{
                  left:
                    i === 0
                      ? 0
                      : i === ticks.length - 1
                        ? '100%'
                        : `${tick.left}%`
                }}
              >
                {tick.label}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  )
})

function BucketReadout({
  bucket,
  bucketMs,
  levels
}: {
  bucket: LogHistogram['buckets'][number]
  bucketMs: number
  levels: ReadonlySet<LogLevelName>
}) {
  const { t } = useTranslation('settings')
  const { number: formatNumber } = useFormat()
  const from = Date.parse(bucket.start)
  return (
    <span className="flex items-center gap-3">
      <span className="text-foreground font-mono">
        {formatClock(from)}–{formatClock(from + bucketMs)}
      </span>
      {LOG_LEVELS.filter((l) => levels.has(l) && bucket[l] > 0).map((l) => (
        <span key={l} className="flex items-center gap-1">
          <span className={cn('size-2 rounded-[2px]', LEVEL_STYLE[l].bar)} />
          {formatNumber(bucket[l])}
        </span>
      ))}
      {LOG_LEVELS.every((l) => !levels.has(l) || bucket[l] === 0) && (
        <span>{t('logger.chart.noLines')}</span>
      )}
    </span>
  )
}
