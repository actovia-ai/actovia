import type { ToolNotice } from '@actovia/shared/types/chat'
import {
  Tick02Icon,
  Copy01Icon,
  LinkSquare02Icon,
  InformationCircleIcon,
  Alert02Icon
} from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useHotkey } from '@tanstack/react-hotkeys'
import { APIProvider, Map } from '@vis.gl/react-google-maps'
import { useTheme } from 'next-themes'
import { memo, useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useClipboard } from '@/hooks/use-clipboard'
import { useMapsJsKey } from '@/hooks/use-maps-key'
import { cn } from '@/lib/utils'

import { DayLayer, FocusedPlaceContext } from './day-layer'
import { PlaceDetail } from './place-detail'
import type { ItineraryDay, MapItineraryDetails } from './types'

const MODE_TO_GMAPS_PARAM: Record<
  NonNullable<ItineraryDay['routeMode']>,
  string
> = {
  walking: 'walking',
  driving: 'driving',
  transit: 'transit'
}

// Map static props hoisted to module scope so they don't allocate fresh
// objects on every render — saves React from comparing identity-different
// but value-equal objects, and makes it obvious these are inert.
const MAP_DEFAULT_CENTER = { lat: 0, lng: 0 }
const MAP_DEFAULT_ZOOM = 2
const MAP_LIBRARIES: ['geometry'] = ['geometry']
const MAP_ID = 'actovia-itinerary'

/** Build a Google Maps deep-link that opens the day's route with all
 *  waypoints in order. */
function buildGoogleMapsUrl(day: ItineraryDay): string | null {
  const places = day.places
  if (places.length === 0) return null
  if (places.length === 1) {
    const p = places[0]
    return `https://www.google.com/maps/search/?api=1&query=${p.lat},${p.lng}`
  }
  const origin = places[0]
  // Two places or more here, so there is a last one; `at()` cannot know.
  const destination = places.at(-1) ?? origin
  const waypoints = places.slice(1, -1)
  const url = new URL('https://www.google.com/maps/dir/')
  url.searchParams.set('api', '1')
  url.searchParams.set('origin', `${origin.lat},${origin.lng}`)
  url.searchParams.set('destination', `${destination.lat},${destination.lng}`)
  if (waypoints.length > 0) {
    url.searchParams.set(
      'waypoints',
      waypoints.map((p) => `${p.lat},${p.lng}`).join('|')
    )
  }
  url.searchParams.set(
    'travelmode',
    MODE_TO_GMAPS_PARAM[day.routeMode ?? 'walking']
  )
  return url.toString()
}

/** Markdown summary of a day for the Copy button — pastes into another
 *  chat / notes app preserving structure. */
function buildDayMarkdown(day: ItineraryDay): string {
  const header = `## ${day.label}${day.title ? ` — ${day.title}` : ''}`
  const summary = day.summary ? `\n${day.summary}\n` : ''
  const places = day.places
    .map((p, i) => {
      const lines: string[] = []
      lines.push(`${i + 1}. **${p.name}**`)
      const meta: string[] = []
      if (p.type) meta.push(p.type)
      if (p.rating !== undefined) meta.push(`★ ${p.rating.toFixed(1)}`)
      if (p.timeLabel) meta.push(p.timeLabel)
      if (meta.length > 0) lines.push(`   ${meta.join(' · ')}`)
      if (p.note) lines.push(`   ${p.note}`)
      if (p.address) lines.push(`   ${p.address}`)
      if (p.phone) lines.push(`   ${p.phone}`)
      if (p.websiteUri) lines.push(`   ${p.websiteUri}`)
      lines.push(
        `   ${p.googleMapsUri ?? `https://www.google.com/maps/search/?api=1&query=${p.lat},${p.lng}`}`
      )
      return lines.join('\n')
    })
    .join('\n\n')
  return `${header}${summary}\n${places}`
}

/** Inner Map subtree, isolated and memoized so interactive parent state
 *  (focused pin, copy-button confirm flash, settings query revalidation) never
 *  reaches the map. Its whole prop set is stable for the life of the card:
 *  `apiKey`/`colorScheme` are primitives, `places` is a slice of the frozen
 *  tool result, `onMarkerClick` is a `useCallback([])`. Focus flows to
 *  `DayLayer` through `FocusedPlaceContext` (see day-layer.tsx), so a pin
 *  click re-renders only that layer, not `<APIProvider>` / `<Map>`. */
const MapSurface = memo(function MapSurface({
  apiKey,
  colorScheme,
  places,
  onMarkerClick
}: {
  apiKey: string
  colorScheme: 'LIGHT' | 'DARK'
  places: ItineraryDay['places']
  onMarkerClick: (idx: number) => void
}) {
  return (
    <APIProvider apiKey={apiKey} libraries={MAP_LIBRARIES}>
      <Map
        defaultCenter={MAP_DEFAULT_CENTER}
        defaultZoom={MAP_DEFAULT_ZOOM}
        gestureHandling="greedy"
        disableDefaultUI={true}
        // `disableDefaultUI` doesn't cover the keyboard-shortcuts pill — that's
        // a separate option. (The "Terms" / "Report a map error" / Google
        // attribution is required by the Maps Platform ToS and has no hide flag.)
        keyboardShortcuts={false}
        mapId={MAP_ID}
        colorScheme={colorScheme}
        className="h-full w-full"
      >
        {/* No `key` — a day switch changes `places`, and DayLayer's effects
            already refit bounds and rebuild the polyline on that dep; keying
            forced a full teardown/rebuild of every marker instead. */}
        <DayLayer places={places} onMarkerClick={onMarkerClick} />
      </Map>
    </APIProvider>
  )
})

/** Non-fatal degradation banner — e.g. Places enrichment couldn't run, so the
 *  map renders from the LLM's coordinates but ratings/photos/hours are missing. */
function ItineraryNotice({ notice }: { notice: ToolNotice }) {
  const isInfo = notice.level === 'info'
  const Icon = isInfo ? InformationCircleIcon : Alert02Icon
  return (
    <div
      className={cn(
        'flex items-start gap-2 border-b px-3 py-2 text-xs',
        isInfo
          ? 'border-border/60 bg-muted/40 text-muted-foreground'
          : 'border-amber-500/20 bg-amber-500/10 text-amber-700 dark:text-amber-400'
      )}
    >
      <HugeiconsIcon
        icon={Icon}

        className="mt-px size-3.5 shrink-0"
      />
      <span>{notice.message}</span>
    </div>
  )
}

function MapItineraryCardImpl({
  toolResult
}: {
  toolResult: MapItineraryDetails
}) {
  const { t } = useTranslation('chat')
  const apiKey = useMapsJsKey()
  const { copied, handleCopy } = useClipboard()
  const { resolvedTheme } = useTheme()

  const [activeDayIdx, setActiveDayIdx] = useState(0)
  // Default to the first place of the first day so the detail card is
  // visible from initial render — matches the reference design.
  const [focusedPlaceIdx, setFocusedPlaceIdx] = useState<number | null>(0)

  const activeDay = toolResult.days[activeDayIdx] ?? toolResult.days[0]

  const onSelectDay = useCallback((idx: number) => {
    setActiveDayIdx(idx)
    // Reset to the first place of the new day (not null) so the detail
    // card stays open as the user tabs through days.
    setFocusedPlaceIdx(0)
  }, [])

  const onPrev = useCallback(() => {
    if (!activeDay) return
    setFocusedPlaceIdx((prev) => {
      const total = activeDay.places.length
      if (total === 0) return null
      const current = prev ?? 0
      return (current - 1 + total) % total
    })
  }, [activeDay])

  const onNext = useCallback(() => {
    if (!activeDay) return
    setFocusedPlaceIdx((prev) => {
      const total = activeDay.places.length
      if (total === 0) return null
      const current = prev ?? -1
      return (current + 1) % total
    })
  }, [activeDay])

  // Esc dismisses the detail card.
  useHotkey('Escape', () => setFocusedPlaceIdx(null), {
    enabled: focusedPlaceIdx != null,
    conflictBehavior: 'allow',
    preventDefault: false,
    stopPropagation: false
  })

  const onCopy = useCallback(() => {
    if (!activeDay) return
    handleCopy(buildDayMarkdown(activeDay))
  }, [activeDay, handleCopy])

  const onMarkerClick = useCallback((i: number) => setFocusedPlaceIdx(i), [])

  const gmapsUrl = useMemo(
    () => (activeDay ? buildGoogleMapsUrl(activeDay) : null),
    [activeDay]
  )

  const colorScheme = resolvedTheme === 'dark' ? 'DARK' : 'LIGHT'

  // Still asking the main process for the key: nothing yet, not "missing".
  if (apiKey === undefined) return null
  if (!apiKey) {
    return (
      <div className="border-border bg-muted/30 text-muted-foreground rounded-lg border p-4 text-sm">
        {t('mapItineraryCard.missingApiKey')}
      </div>
    )
  }

  if (!activeDay) return null

  const focusedPlace =
    focusedPlaceIdx == null ? null : activeDay.places[focusedPlaceIdx]
  const copyMarkdown = buildDayMarkdown(activeDay)

  return (
    <div className="border-border bg-card relative overflow-hidden rounded-2xl border shadow-sm">
      {toolResult.notice && <ItineraryNotice notice={toolResult.notice} />}
      <div className="relative h-120 w-full">
        <FocusedPlaceContext.Provider value={focusedPlaceIdx}>
          <MapSurface
            apiKey={apiKey}
            colorScheme={colorScheme}
            places={activeDay.places}
            onMarkerClick={onMarkerClick}
          />
        </FocusedPlaceContext.Provider>

        {/* Floating tab strip — only rendered for >1 day. */}
        {toolResult.days.length > 1 && (
          <div
            role="tablist"
            aria-label={t('mapItineraryCard.tabsAriaLabel')}
            className="bg-background/85 absolute top-3 left-3 z-10 flex gap-1 overflow-x-auto rounded-full p-1 shadow-md backdrop-blur"
          >
            {toolResult.days.map((day, i) => {
              const active = i === activeDayIdx
              return (
                <button
                  key={day.label}
                  role="tab"
                  aria-selected={active}
                  type="button"
                  onClick={() => onSelectDay(i)}
                  className={cn(
                    'shrink-0 rounded-full px-3 py-1 text-xs font-medium transition-colors',
                    active
                      ? 'bg-foreground text-background'
                      : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  {day.label}
                </button>
              )
            })}
          </div>
        )}

        {/* Per-day actions — only when no detail card is open. */}
        {!focusedPlace && (
          <div className="absolute top-3 right-3 z-10 flex items-center gap-1.5">
            {gmapsUrl && (
              <a
                href={gmapsUrl}
                target="_blank"
                rel="noopener noreferrer"
                title={t('mapItineraryCard.openRouteTitle')}
                className="bg-background/85 text-foreground hover:bg-background flex size-8 items-center justify-center rounded-full shadow-md backdrop-blur transition-colors"
              >
                <HugeiconsIcon
                  icon={LinkSquare02Icon}

                  size={14}
                />
              </a>
            )}
            <button
              type="button"
              onClick={onCopy}
              title={t('mapItineraryCard.copyMarkdownTitle')}
              className="bg-background/85 text-foreground hover:bg-background flex size-8 items-center justify-center rounded-full shadow-md backdrop-blur transition-colors"
            >
              {copied === copyMarkdown ? (
                <HugeiconsIcon icon={Tick02Icon} size={14} />
              ) : (
                <HugeiconsIcon icon={Copy01Icon} size={14} />
              )}
            </button>
          </div>
        )}

        {focusedPlace && focusedPlaceIdx != null && (
          <PlaceDetail
            place={focusedPlace}
            dayLabel={activeDay.label}
            index={focusedPlaceIdx}
            total={activeDay.places.length}
            onPrev={onPrev}
            onNext={onNext}
            onClose={() => setFocusedPlaceIdx(null)}
          />
        )}
      </div>
    </div>
  )
}

// Memoize the whole card so parent re-renders during streaming (the chat
// surface re-renders on every token) don't reach this subtree. Identity is
// NOT enough: the `done` frame and every history reload hand back a fresh,
// value-equal copy of the tool message (SSE is JSON), which would otherwise
// re-initialise the map once per turn end. Fall back to a value check — it
// only runs on the rare identity miss, and an itinerary payload is small.
export const MapItineraryCard = memo(MapItineraryCardImpl, (a, b) => {
  if (a.toolResult === b.toolResult) return true
  return JSON.stringify(a.toolResult) === JSON.stringify(b.toolResult)
})
