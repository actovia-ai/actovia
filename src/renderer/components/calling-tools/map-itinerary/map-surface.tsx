import { APIProvider, Map } from '@vis.gl/react-google-maps'
import { memo } from 'react'

import { DayLayer } from './day-layer'
import type { ItineraryDay } from './types'

// Map static props hoisted to module scope so they don't allocate fresh
// objects on every render — saves React from comparing identity-different
// but value-equal objects, and makes it obvious these are inert.
const MAP_DEFAULT_CENTER = { lat: 0, lng: 0 }
const MAP_DEFAULT_ZOOM = 2
const MAP_LIBRARIES: ['geometry'] = ['geometry']
const MAP_ID = 'actovia-itinerary'

/** Inner Map subtree, isolated and memoized so interactive parent state
 *  (focused pin, copy-button confirm flash, settings query revalidation) never
 *  reaches the map. Its whole prop set is stable for the life of the card:
 *  `apiKey`/`colorScheme` are primitives, `places` is a slice of the frozen
 *  tool result, `onMarkerClick` is a `useCallback([])`. Focus flows to
 *  `DayLayer` through `FocusedPlaceContext` (see day-layer.tsx), so a pin
 *  click re-renders only that layer, not `<APIProvider>` / `<Map>`. */
export const MapSurface = memo(function MapSurface({
  apiKey,
  colorScheme,
  places,
  onMarkerClick,
  fullscreen = false
}: {
  apiKey: string
  colorScheme: 'LIGHT' | 'DARK'
  places: ItineraryDay['places']
  onMarkerClick: (idx: number) => void
  /** The full-screen view: Google's zoom buttons, and the place card in a
   *  column beside the map rather than over it. */
  fullscreen?: boolean
}) {
  return (
    <APIProvider apiKey={apiKey} libraries={MAP_LIBRARIES}>
      <Map
        defaultCenter={MAP_DEFAULT_CENTER}
        defaultZoom={MAP_DEFAULT_ZOOM}
        gestureHandling="greedy"
        disableDefaultUI={true}
        zoomControl={fullscreen}
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
        <DayLayer
          places={places}
          onMarkerClick={onMarkerClick}
          overlaysPanel={!fullscreen}
        />
      </Map>
    </APIProvider>
  )
})
