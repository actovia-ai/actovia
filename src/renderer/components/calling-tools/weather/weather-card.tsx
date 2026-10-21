import { TEST_IDS } from '@actovia/shared/constants/test-ids'
import {
  weatherClockHours,
  type WeatherResult
} from '@actovia/shared/types/weather'
import {
  ArrowDown01Icon,
  SunriseIcon,
  SunsetIcon
} from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Morph, Reveal } from '@/components/motion/morph'
import { useFormat } from '@/lib/format'
import { ROW_ENTER, staggerDelay } from '@/lib/motion'
import { cn } from '@/lib/utils'

import { conditionOf } from './condition'
import { canDrawCurve, TemperatureCurve } from './temperature-curve'

/**
 * The weather card: compact in the transcript, the whole picture on
 * "Details". Closed, it is a line of now (icon, temperature, feels like,
 * condition · place; another day's hi/lo, or the scrubbed hour, on the
 * right), the day's
 * temperature curve, and the first three days as a segmented control.
 * Open, the header becomes a headline, the readings and the curve's
 * caption grow in above the curve, and the segmented days become the
 * forecast as range-bar rows — which are also the day selector. The curve
 * is the constant; everything else moves on one 250 ms ease-out, so it
 * reads as one card opening. Tokens only; the condition's colour is in
 * its icon and, at 14%, the curve's wash.
 */

/** What a segmented control can hold; the rest waits behind Details. */
const COMPACT_DAYS = 3

export function WeatherCard({ toolResult }: { toolResult: WeatherResult }) {
  const { t } = useTranslation('chat')
  const { dateTime } = useFormat()
  const { current, forecast, location } = toolResult
  const now = conditionOf(current.weatherCode, current.isDay)
  const [expanded, setExpanded] = useState(false)
  const [dayIndex, setDayIndex] = useState(0)
  const [hover, setHover] = useState<number | null>(null)
  const day = forecast[dayIndex]
  const hasCurve = canDrawCurve(day)

  const weekday = (date: string, i: number) => {
    if (i === 0) return t('weatherCard.today')
    if (i === 1) return t('weatherCard.tomorrow')
    return dateTime(new Date(date), { weekday: 'short' })
  }
  // Times are the place's own, shown as clocks in the user's locale.
  const clock = (time: string, o: Intl.DateTimeFormatOptions) => {
    const h = weatherClockHours(time)
    if (h === null) return time
    return dateTime(
      new Date(2026, 0, 1, Math.floor(h), Math.round((h % 1) * 60)),
      o
    )
  }
  const hour = (time: string) => clock(time, { hour: 'numeric' })
  const hourMinute = (time: string) =>
    clock(time, { hour: 'numeric', minute: '2-digit' })

  const readings: Array<[string, string]> = [
    [t('weatherCard.humidity'), `${current.humidity}%`],
    [t('weatherCard.wind'), `${current.windKmph} km/h ${current.windDir}`],
    [t('weatherCard.precip'), `${current.precipMM} mm`],
    [t('weatherCard.uvIndex'), current.uvIndex],
    [t('weatherCard.visibility'), `${current.visibility} km`],
    [t('weatherCard.pressure'), `${current.pressure} hPa`]
  ]

  // The bars' scale: every day's hi/lo in the forecast.
  const scale = useMemo(() => {
    const lo = Math.min(...forecast.map((f) => Number(f.minTempC)))
    const hi = Math.max(...forecast.map((f) => Number(f.maxTempC)))
    return { lo, span: Math.max(1, hi - lo) }
  }, [forecast])

  // The selected day's numbers: hi/lo, or the scrub readout. Two lines in
  // the compact header's right, one line above the curve when open.
  const active = hover === null || !day ? null : day.hourly[hover]
  const value = day ? (
    active ? (
      <span className="text-foreground font-medium">
        {active.tempC}°
        <span className="text-muted-foreground ml-1.5 font-normal">
          {hour(active.time)}
        </span>
      </span>
    ) : (
      <span className="text-foreground font-medium">
        {day.maxTempC}°
        <span className="text-muted-foreground font-normal">
          /{day.minTempC}°
        </span>
      </span>
    )
  ) : null
  const detail = active
    ? t('weatherCard.rainChance', { percent: active.rainChance })
    : day?.condition

  const toggle = () => {
    setExpanded((v) => !v)
    // The compact control holds three days; leaving the week on a later
    // one would select a tab that is not there.
    if (expanded && dayIndex >= COMPACT_DAYS) setDayIndex(0)
  }

  return (
    <div
      className={cn(
        ROW_ENTER,
        // The open card is a step wider (the curve breathes, seven rows do
        // not crowd); the width moves with the height so it opens as one.
        'bg-card border-border w-full overflow-hidden rounded-lg border transition-[max-width] duration-250 ease-out',
        expanded ? 'max-w-md' : 'max-w-sm'
      )}
    >
      <Morph active={expanded ? 1 : 0}>
        {/* compact: a line of now */}
        <div className="flex items-center gap-3 px-4 pt-4 pb-2">
          <HugeiconsIcon
            icon={now.Icon}
            className={cn('size-8 shrink-0', now.tint)}
            strokeWidth={1.5}
          />
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-2">
              <span className="text-foreground text-3xl leading-none font-medium tracking-tight tabular-nums">
                {current.tempC}°
              </span>
              <span className="text-muted-foreground text-xs tabular-nums">
                {t('weatherCard.feelsLike', { temp: current.feelsLikeC })}
              </span>
            </div>
            <div className="text-muted-foreground mt-1 truncate text-xs">
              {current.condition}
              <span className="mx-1.5 opacity-40">·</span>
              {location}
            </div>
          </div>
          {/* Today's hi/lo is already the first segment below, and its
              condition is the line on the left: the corner speaks only for
              another day, or for the hour being scrubbed. */}
          <div
            className="flex flex-col items-end text-xs tabular-nums"
            aria-live="polite"
          >
            {day && (dayIndex !== 0 || active) && (
              <>
                <div>{value}</div>
                <div className="text-muted-foreground">{detail}</div>
              </>
            )}
          </div>
        </div>

        {/* open: the headline */}
        <div className="flex items-start justify-between gap-4 px-5 pt-5 pb-4">
          <div>
            <div className="flex items-start">
              <span className="text-foreground text-6xl leading-none font-light tracking-tighter tabular-nums">
                {current.tempC}
              </span>
              <span className="text-muted-foreground mt-1 text-2xl leading-none font-light">
                °
              </span>
            </div>
            <p className="text-foreground mt-3 text-sm font-medium">
              {current.condition}
              <span className="text-muted-foreground font-normal">
                <span className="mx-1.5 opacity-40">·</span>
                {location}
              </span>
            </p>
            <p className="text-muted-foreground mt-0.5 text-xs tabular-nums">
              {t('weatherCard.feelsLike', { temp: current.feelsLikeC })}
              <span className="mx-1.5 opacity-40">·</span>
              {t('weatherCard.observedAt', {
                time: hourMinute(current.observedAt)
              })}
            </p>
          </div>
          <HugeiconsIcon
            icon={now.Icon}
            className={cn('mt-1 size-9 shrink-0', now.tint)}
            strokeWidth={1.5}
          />
        </div>
      </Morph>

      {/* open: the readings */}
      <Reveal open={expanded} data-testid={TEST_IDS.weatherCard.readings}>
        <dl className="border-border grid grid-cols-3 gap-x-4 gap-y-3 border-t px-5 py-4">
          {readings.map(([label, reading], i) => (
            <div key={label} className={ROW_ENTER} style={staggerDelay(i)}>
              <dt className="text-muted-foreground text-2xs leading-none">
                {label}
              </dt>
              <dd className="text-foreground mt-1.5 text-sm leading-none font-medium tabular-nums">
                {reading}
              </dd>
            </div>
          ))}
        </dl>
      </Reveal>

      {day && (
        <>
          {/* open: the curve's caption (the compact header carried it) */}
          <Reveal open={expanded}>
            <div
              className="border-border flex items-baseline justify-between border-t px-5 pt-3 text-xs tabular-nums"
              aria-live="polite"
            >
              <span className="text-foreground font-medium">
                {weekday(day.date, dayIndex)}
                <span className="text-muted-foreground font-normal">
                  <span className="mx-1.5 opacity-40">·</span>
                  {day.condition}
                </span>
              </span>
              <span>
                {value}
                <span className="text-muted-foreground">
                  <span className="mx-1.5 opacity-40">·</span>
                  {detail}
                </span>
              </span>
            </div>
          </Reveal>

          {/* the curve — the constant */}
          {hasCurve && (
            <>
              <TemperatureCurve day={day} hover={hover} onHover={setHover} />
              <div className="text-muted-foreground text-2xs flex items-center justify-between px-5 pb-2 tabular-nums">
                <span className="flex items-center gap-1">
                  <HugeiconsIcon
                    icon={SunriseIcon}

                    className="size-3"
                    aria-hidden="true"
                  />
                  <span className="sr-only">{t('weatherCard.sunrise')}</span>
                  {hourMinute(day.sunrise)}
                </span>
                <span className="flex items-center gap-1">
                  <HugeiconsIcon
                    icon={SunsetIcon}

                    className="size-3"
                    aria-hidden="true"
                  />
                  <span className="sr-only">{t('weatherCard.sunset')}</span>
                  {hourMinute(day.sunset)}
                </span>
              </div>
            </>
          )}

          <Morph active={expanded ? 1 : 0}>
            {/* compact: the segmented days */}
            <div
              role="tablist"
              className="border-border bg-muted/40 flex border-t p-1"
            >
              {forecast.slice(0, COMPACT_DAYS).map((f, i) => {
                const c = conditionOf(f.weatherCode)
                const selected = i === dayIndex
                return (
                  <button
                    key={f.date}
                    type="button"
                    role="tab"
                    aria-selected={selected}
                    onClick={() => setDayIndex(i)}
                    className={cn(
                      'flex flex-1 items-center justify-center gap-2 rounded-md px-2 py-1.5 text-xs transition-[background-color,color,box-shadow,transform] duration-150 ease-out active:scale-[0.98]',
                      selected
                        ? 'bg-card text-foreground shadow-xs'
                        : 'text-muted-foreground hover:text-foreground'
                    )}
                  >
                    <span>{weekday(f.date, i)}</span>
                    <HugeiconsIcon
                      icon={c.Icon}
                      className={cn('size-3.5', c.tint)}
                      strokeWidth={1.75}
                    />
                    <span className="tabular-nums">
                      {f.maxTempC}°
                      <span className="opacity-60">/{f.minTempC}°</span>
                    </span>
                  </button>
                )
              })}
            </div>

            {/* open: the forecast as range bars, and the selector */}
            <div className="border-border border-t px-3 py-2">
              {forecast.map((f, i) => {
                const c = conditionOf(f.weatherCode)
                const lo = Number(f.minTempC)
                const hi = Number(f.maxTempC)
                const left = ((lo - scale.lo) / scale.span) * 100
                const width = ((hi - lo) / scale.span) * 100
                const selected = i === dayIndex
                return (
                  <button
                    key={f.date}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => setDayIndex(i)}
                    className={cn(
                      'grid w-full grid-cols-[3rem_1.25rem_2.25rem_1fr_2.25rem] items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs',
                      'transition-[background-color,transform] duration-150 ease-out active:scale-[0.99]',
                      selected ? 'bg-muted' : 'hover:bg-muted/50'
                    )}
                  >
                    <span className="text-foreground">
                      {weekday(f.date, i)}
                    </span>
                    <HugeiconsIcon
                      icon={c.Icon}
                      className={cn('size-4', c.tint)}
                      strokeWidth={1.75}
                    />
                    <span className="text-muted-foreground text-right tabular-nums">
                      {lo}°
                    </span>
                    <span className="bg-muted-foreground/15 relative h-1 rounded-full">
                      {/* the selected day's bar takes the curve's colour */}
                      <span
                        className={cn(
                          'absolute inset-y-0 rounded-full transition-colors duration-150 ease-out',
                          selected ? 'bg-primary' : 'bg-foreground/50'
                        )}
                        style={{
                          left: `${left}%`,
                          width: `${Math.max(width, 4)}%`
                        }}
                      />
                    </span>
                    <span className="text-foreground text-right font-medium tabular-nums">
                      {hi}°
                    </span>
                  </button>
                )
              })}
            </div>
          </Morph>
        </>
      )}

      {/* the toggle — last, in the same place in both states */}
      <button
        type="button"
        aria-expanded={expanded}
        onClick={toggle}
        data-testid={TEST_IDS.weatherCard.details}
        className="border-border text-muted-foreground hover:text-foreground hover:bg-muted/50 flex w-full items-center justify-center gap-1 border-t py-1.5 text-xs transition-[color,background-color,transform] duration-150 ease-out active:scale-[0.99]"
      >
        {expanded ? t('weatherCard.less') : t('weatherCard.details')}
        <HugeiconsIcon
          icon={ArrowDown01Icon}

          className={cn(
            'size-3.5 transition-transform duration-200 ease-out',
            expanded && 'rotate-180'
          )}
        />
      </button>
    </div>
  )
}
