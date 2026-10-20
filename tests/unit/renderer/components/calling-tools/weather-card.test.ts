// @vitest-environment happy-dom
import type {
  WeatherForecastDay,
  WeatherResult
} from '@actovia/shared/types/weather'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      opts ? `${key}(${Object.values(opts).join(',')})` : key
  })
}))
vi.mock('@/lib/format', () => ({
  useFormat: () => ({
    dateTime: (d: Date, o?: Intl.DateTimeFormatOptions) =>
      new Intl.DateTimeFormat('en', o).format(d)
  })
}))

const { WeatherCard } =
  await import('@/components/calling-tools/weather/weather-card')

;(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

beforeAll(() => {
  // happy-dom lays nothing out: no ResizeObserver, no SVG path geometry.
  const g = globalThis as {
    ResizeObserver?: unknown
    SVGPathElement?: { prototype: { getTotalLength?: () => number } }
  }
  g.ResizeObserver ??= class {
    observe() {}
    disconnect() {}
  }
  if (g.SVGPathElement && !g.SVGPathElement.prototype.getTotalLength)
    g.SVGPathElement.prototype.getTotalLength = () => 300
})

function day(date: string, lo: number, hi: number): WeatherForecastDay {
  return {
    date,
    condition: 'Sunny',
    weatherCode: '0',
    maxTempC: String(hi),
    minTempC: String(lo),
    sunrise: `${date}T06:52`,
    sunset: `${date}T19:18`,
    hourly: Array.from({ length: 24 }, (_, i) => ({
      time: `${date}T${String(i).padStart(2, '0')}:00`,
      tempC: String(lo + Math.round(((hi - lo) * (i % 5)) / 4)),
      weatherCode: '0',
      condition: 'Sunny',
      rainChance: '0'
    }))
  }
}

const current: WeatherResult['current'] = {
  condition: 'Sunny',
  weatherCode: '0',
  tempC: '21',
  feelsLikeC: '21',
  humidity: '40',
  windKmph: '8',
  windDirDegree: '180',
  windDir: 'S',
  precipMM: '0.0',
  uvIndex: '5',
  visibility: '10',
  pressure: '1015',
  observedAt: '2026-09-23T12:00',
  isDay: true
}

async function mount(toolResult: WeatherResult) {
  const host = document.createElement('div')
  await act(async () =>
    createRoot(host).render(createElement(WeatherCard, { toolResult }))
  )
  const details = host.querySelector<HTMLButtonElement>(
    '[data-testid="weather-card.details"]'
  )!
  const readings = host.querySelector<HTMLElement>(
    '[data-testid="weather-card.readings"]'
  )!
  const click = async (el: Element) =>
    act(async () => {
      el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
  return { host, details, readings, click }
}

describe('WeatherCard', () => {
  it('renders compact — readings closed and inert, the three days as tabs', async () => {
    const { host, details, readings } = await mount({
      location: 'Oslo, Norway',
      current,
      forecast: [
        day('2026-09-22', 11, 22),
        day('2026-09-23', 10, 18),
        day('2026-09-24', 9, 14),
        day('2026-09-25', 8, 12)
      ]
    })
    expect(details.getAttribute('aria-expanded')).toBe('false')
    expect(details.textContent).toContain('weatherCard.details')
    // Closed: the readings section is a 0fr row nobody can reach.
    expect(readings.closest('[inert]')).not.toBeNull()
    expect(readings.closest('[data-open]')).toBeNull()
    // Three tabs, not four — the week waits behind Details.
    expect(host.querySelectorAll('[role="tab"]')).toHaveLength(3)
    expect(
      host.querySelector('[role="tab"][aria-selected="true"]')?.textContent
    ).toContain('weatherCard.today')
    // The curve is there for a day with hourly data.
    expect(host.querySelector('svg[viewBox="0 0 400 88"] path')).not.toBeNull()
  })

  it('opens on Details: readings reachable, every day a row, Less to close', async () => {
    const { host, details, readings, click } = await mount({
      location: 'Oslo, Norway',
      current,
      forecast: [
        day('2026-09-22', 11, 22),
        day('2026-09-23', 10, 18),
        day('2026-09-24', 9, 14),
        day('2026-09-25', 8, 12)
      ]
    })
    await click(details)
    expect(details.getAttribute('aria-expanded')).toBe('true')
    expect(details.textContent).toContain('weatherCard.less')
    expect(readings.closest('[inert]')).toBeNull()
    expect(readings.closest('[data-open]')).not.toBeNull()
    expect(readings.textContent).toContain('weatherCard.humidity')
    expect(readings.textContent).toContain('1015 hPa')
    const rows = host.querySelectorAll('button[aria-pressed]')
    expect(rows).toHaveLength(4)

    // Pick the fourth day, close: the compact control only holds three,
    // so the selection falls back to today.
    await click(rows[3])
    expect(rows[3].getAttribute('aria-pressed')).toBe('true')
    await click(details)
    expect(details.getAttribute('aria-expanded')).toBe('false')
    expect(
      host.querySelector('[role="tab"][aria-selected="true"]')?.textContent
    ).toContain('weatherCard.today')
  })

  it('survives a result with no forecast (the faux provider): now, readings, no curve', async () => {
    const { host, details, click } = await mount({
      location: 'Oslo',
      current,
      forecast: []
    })
    expect(host.textContent).toContain('21°')
    // The condition icons are SVGs too; the curve is the one with a viewBox.
    expect(host.querySelector('svg[viewBox="0 0 400 88"]')).toBeNull()
    expect(host.querySelectorAll('[role="tab"]')).toHaveLength(0)
    await click(details)
    expect(details.getAttribute('aria-expanded')).toBe('true')
    expect(host.textContent).toContain('weatherCard.humidity')
  })
})
