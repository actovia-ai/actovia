import {
  weatherClockHours,
  type WeatherForecastDay
} from '@actovia/shared/types/weather'
import { useEffect, useId, useMemo, useRef, useState } from 'react'

/**
 * A day's temperature as a curve through its 24 hourly slots. It draws in once per day
 * (explanation, not decoration — the shape of the day is the point), the
 * pointer scrubs it (no animation: it follows the hand; the card shows the
 * readout), and sunrise / sunset sit as ticks on the baseline. The curve is
 * drawn on the day's own range with a 6° floor, so a still day stays flat
 * instead of becoming full-height noise. Its colour is the colour tone's
 * accent (`primary`), the wash under it the same at 18%.
 */

const W = 400
const H = 88
// The text column's inset, so the curve's ends align with it.
const PAD_X = 18
const PAD_Y = 12
const MIN_SPAN = 6

function curveOf(day: WeatherForecastDay) {
  const temps = day.hourly.map((h) => Number(h.tempC))
  const lo = Math.min(...temps)
  const hi = Math.max(...temps)
  const span = Math.max(MIN_SPAN, hi - lo)
  // A day narrower than the floor sits in the middle of its band.
  const base = lo - (span - (hi - lo)) / 2
  const pts = temps.map((tc, i) => ({
    x: PAD_X + (i / (temps.length - 1)) * (W - PAD_X * 2),
    y: PAD_Y + (1 - (tc - base) / span) * (H - PAD_Y * 2)
  }))
  // Catmull-Rom → cubic Bézier: a soft curve through every slot.
  let d = `M ${pts[0].x} ${pts[0].y}`
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)]
    const p1 = pts[i]
    const p2 = pts[i + 1]
    const p3 = pts[Math.min(pts.length - 1, i + 2)]
    d += ` C ${p1.x + (p2.x - p0.x) / 6} ${p1.y + (p2.y - p0.y) / 6}, ${
      p2.x - (p3.x - p1.x) / 6
    } ${p2.y - (p3.y - p1.y) / 6}, ${p2.x} ${p2.y}`
  }
  return { d, pts }
}

/**
 * A clock → x across the day. The slots run from 0:00 to the day's last
 * slot (23:00), so that is the width.
 */
function timeToX(clock: string, lastHour: number): number {
  const h = weatherClockHours(clock)
  if (h === null) return PAD_X
  return PAD_X + (h / lastHour) * (W - PAD_X * 2)
}

/** A curve needs two points; a stub (the faux provider) may give none. */
export function canDrawCurve(day: WeatherForecastDay | undefined) {
  return day !== undefined && day.hourly.length >= 2
}

export function TemperatureCurve({
  day,
  hover,
  onHover
}: {
  day: WeatherForecastDay
  /** The hourly slot under the pointer, or none. */
  hover: number | null
  onHover: (index: number | null) => void
}) {
  const { d, pts } = useMemo(() => curveOf(day), [day])
  const lastHour = weatherClockHours(day.hourly.at(-1)!.time) ?? 23
  const gradId = useId()

  // Draw-in: dash offset from the measured length to 0, once per curve.
  const pathRef = useRef<SVGPathElement>(null)
  const [length, setLength] = useState(0)
  useEffect(() => {
    setLength(pathRef.current?.getTotalLength() ?? 0)
  }, [d])
  const [drawn, setDrawn] = useState(false)
  useEffect(() => {
    setDrawn(false)
    const f = requestAnimationFrame(() => setDrawn(true))
    return () => cancelAnimationFrame(f)
  }, [d])

  const active = hover === null ? null : pts[hover]

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="mt-1 block w-full touch-none select-none"
      style={{ height: H }}
      onPointerLeave={() => onHover(null)}
      onPointerMove={(e) => {
        const rect = e.currentTarget.getBoundingClientRect()
        const x = ((e.clientX - rect.left) / rect.width) * W
        const i = Math.round(((x - PAD_X) / (W - PAD_X * 2)) * (pts.length - 1))
        onHover(Math.max(0, Math.min(pts.length - 1, i)))
      }}
    >
      <defs>
        {/* `currentColor` on a stop resolves from the gradient's own
            inheritance chain, not from the path that paints with it — so
            the colour lives here */}
        <linearGradient
          id={gradId}
          x1="0"
          y1="0"
          x2="0"
          y2="1"
          className="text-primary-ink"
        >
          <stop offset="0" stopColor="currentColor" stopOpacity="0.18" />
          <stop offset="1" stopColor="currentColor" stopOpacity="0" />
        </linearGradient>
      </defs>
      {[day.sunrise, day.sunset].map((clock, i) => (
        <line
          key={i}
          x1={timeToX(clock, lastHour)}
          x2={timeToX(clock, lastHour)}
          y1={H - 6}
          y2={H}
          className="stroke-muted-foreground/50"
          strokeWidth={1}
        />
      ))}
      <path
        d={`${d} L ${pts.at(-1)!.x} ${H} L ${pts[0].x} ${H} Z`}
        fill={`url(#${gradId})`}
        className="transition-opacity duration-300 ease-out"
        style={{ opacity: drawn ? 1 : 0 }}
      />
      <path
        ref={pathRef}
        d={d}
        fill="none"
        className="stroke-primary-ink"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeDasharray={length || undefined}
        strokeDashoffset={drawn ? 0 : length}
        style={{
          transition: length
            ? 'stroke-dashoffset 300ms var(--ease-out)'
            : undefined
        }}
      />
      {active && (
        <>
          <line
            x1={active.x}
            x2={active.x}
            y1={PAD_Y - 6}
            y2={H - 8}
            className="stroke-border"
            strokeWidth={1}
          />
          <circle
            cx={active.x}
            cy={active.y}
            r={3.5}
            className="fill-card stroke-primary-ink"
            strokeWidth={1.5}
          />
        </>
      )}
    </svg>
  )
}
