// @vitest-environment happy-dom
// src/renderer/components/calling-tools/map-itinerary/ — the card's full
// screen (ISSUE-295, after ChatGPT's map view): the map beside a column that
// lists the day's places and opens on one; and the place card drawn in the
// theme's colours.
import { TEST_IDS } from '@actovia/shared/constants/test-ids'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

const t = (key: string, opts?: Record<string, unknown>) =>
  opts ? `${key}(${Object.values(opts).join(',')})` : key
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t }) }))
vi.mock('@/hooks/use-maps-key', () => ({ useMapsJsKey: () => 'k' }))
vi.mock('next-themes', () => ({ useTheme: () => ({ resolvedTheme: 'light' }) }))
// No Maps JS here: each map is a marker of its own, so the test counts them.
vi.mock('@vis.gl/react-google-maps', () => ({
  APIProvider: ({ children }: { children: unknown }) => children,
  Map: ({ zoomControl }: { zoomControl: boolean }) =>
    createElement('div', { 'data-map': zoomControl ? 'full' : 'card' }),
  AdvancedMarker: () => null,
  useMap: () => null
}))

const { MapItineraryCard } =
  await import('@/components/calling-tools/map-itinerary/itinerary-card')

;(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | null = null
let host: HTMLElement
afterEach(() => {
  act(() => root?.unmount())
  root = null
  host?.remove()
  document.body.innerHTML = ''
})

const place = (name: string, extra = {}) => ({
  name,
  lat: 48.2,
  lng: 16.37,
  type: 'Museum',
  rating: 4.6,
  ...extra
})

const result = {
  type: 'mapItinerary' as const,
  title: 'Vienna',
  days: [
    {
      label: 'Day 1',
      places: [
        place('Hofburg', {
          openNow: true,
          reviews: [{ author: 'A', text: 'x' }]
        }),
        place('Café Central')
      ]
    }
  ]
}

function render() {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  act(() =>
    root!.render(createElement(MapItineraryCard, { toolResult: result }))
  )
}

const byTestId = (id: string) =>
  document.querySelectorAll<HTMLElement>(`[data-testid="${id}"]`)

describe('MapItineraryCard full screen', () => {
  it("opens a second map beside the list of the day's places", async () => {
    render()
    expect(document.querySelectorAll('[data-map="full"]')).toHaveLength(0)
    await act(async () =>
      byTestId(TEST_IDS.mapItinerary.fullscreenButton)[0].click()
    )
    expect(document.querySelectorAll('[data-map="full"]')).toHaveLength(1)
    const rows = byTestId(TEST_IDS.mapItinerary.placeRow)
    expect([...rows].map((r) => r.textContent)).toEqual([
      expect.stringContaining('Hofburg'),
      expect.stringContaining('Café Central')
    ])
    expect(document.body.textContent).toContain(
      'mapItineraryCard.placeCount(2)'
    )
  })

  it('a row opens the place in the column, and back returns to the list', async () => {
    render()
    await act(async () =>
      byTestId(TEST_IDS.mapItinerary.fullscreenButton)[0].click()
    )
    await act(async () => byTestId(TEST_IDS.mapItinerary.placeRow)[1].click())
    expect(byTestId(TEST_IDS.mapItinerary.placeRow)).toHaveLength(0)
    const back = document.querySelector<HTMLElement>(
      '[aria-label="placeDetail.backToList"]'
    )!
    expect(back).not.toBeNull()
    await act(async () => back.click())
    expect(byTestId(TEST_IDS.mapItinerary.placeRow)).toHaveLength(2)
  })
})

describe('PlaceDetail on the card', () => {
  it("is drawn in the theme's colours, clear of the map's attribution", () => {
    render()
    const card = document.querySelector('.bg-popover')!
    expect(card.className).toContain('bottom-8')
    expect(document.body.innerHTML).not.toMatch(/amber|emerald/u)
    expect(card.querySelector('[data-slot="tabs-list"]')).not.toBeNull()
  })
})
