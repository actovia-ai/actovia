/** Shared place + day shapes for the map-itinerary card.
 *  Mirrors the server-side schema in
 *  `src/main/lib/ai/calling-tools/map-itinerary.ts` — keep them in sync. */
import { BASE_URL } from '@actovia/shared/constants/systems'
import type { ToolNotice } from '@actovia/shared/types/chat'

export type ItineraryReview = {
  author?: string
  authorPhotoUrl?: string
  rating?: number
  text?: string
  relativeTime?: string
}

export type ItineraryPlace = {
  // LLM-provided
  name: string
  lat: number
  lng: number
  type?: string
  timeLabel?: string
  note?: string
  // Places-API-enriched (any may be absent if enrichment failed)
  rating?: number
  reviewCount?: number
  phone?: string
  websiteUri?: string
  googleMapsUri?: string
  address?: string
  openNow?: boolean
  openingHours?: string[]
  /** Photo reference paths from Places API (`places/…/photos/…`). The
   *  renderer loads each through `GET /api/v1/maps/photo`, which adds the
   *  user's key in the main process (`buildPlacePhotoUrl`). */
  photoNames?: string[]
  reviews?: ItineraryReview[]
}

export type ItineraryDay = {
  label: string
  title?: string
  summary?: string
  routeMode?: 'walking' | 'driving' | 'transit'
  places: ItineraryPlace[]
}

export type MapItineraryDetails = {
  type: 'mapItinerary'
  title?: string
  days: ItineraryDay[]
  /** Set when Places enrichment failed for a user-fixable reason (expired /
   *  invalid key, API disabled, no billing, quota). Rendered as a banner on
   *  the card; also toasted once while streaming. */
  notice?: ToolNotice
}

/** The URL of a Places photo through Actovia's own proxy
 *  (`GET /api/v1/maps/photo`): the main process adds the user's key, so the
 *  key never reaches the renderer or an `<img src>`. `null` without a name. */
export function buildPlacePhotoUrl(
  photoName: string | undefined,
  maxWidthPx = 800
): string | null {
  if (!photoName) return null
  const query = new URLSearchParams({
    name: photoName,
    maxWidth: String(maxWidthPx)
  })
  return `${BASE_URL}/api/v1/maps/photo?${query.toString()}`
}
