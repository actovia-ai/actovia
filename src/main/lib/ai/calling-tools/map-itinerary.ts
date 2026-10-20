import { TOOL_NAMES } from '@actovia/shared/constants/tool-names'
import type { ToolNotice } from '@actovia/shared/types/chat'
import type { AgentTool } from '@earendil-works/pi-agent-core'
import { Type } from '@earendil-works/pi-ai'
import { v1 } from '@googlemaps/places'

import { Settings } from '../../db/schema'
import { logger } from '../../logger'

/**
 * `map_itinerary` is the single map-rendering tool: lookups, A→B routes, and
 * full multi-day itineraries collapse into one interactive card with tabs,
 * a shared map, and pin-driven detail overlays. The legacy `googleMapsPlaces`
 * / `googleMapsRouting` tools were removed; this tool internally calls the
 * Places API to enrich each LLM-supplied place with real data (rating,
 * reviews, photos, phone, website, opening hours), so we don't depend on
 * the LLM hallucinating those fields.
 *
 * Enrichment flow:
 *   LLM provides   → name + approximate lat/lng (+ optional context)
 *   Server enriches → Places SearchText biased ±500m around the LLM coords,
 *                     takes the top match, merges fields over LLM data
 *   Renderer        → builds photo URLs from photoNames using the user's
 *                     own Google API key (same key used for the embedded map)
 *
 * One Places call per place; runs in parallel and uses Promise.allSettled
 * so a single 404 doesn't fail the whole turn — we just keep the LLM data
 * for that one place.
 */
const placeSchema = Type.Object({
  name: Type.String({
    description:
      'Place name as the user would recognize it (e.g. "Café Central", "Musikverein 金色大厅"). Mixed languages are fine.'
  }),
  lat: Type.Number({ description: 'Latitude in decimal degrees.' }),
  lng: Type.Number({ description: 'Longitude in decimal degrees.' }),
  type: Type.Optional(
    Type.String({
      description:
        'Short category label like "Museum", "Café", "Park", "Concert Hall". Single-word noun preferred. The Places API will override this with its own primaryTypeDisplayName when available.'
    })
  ),
  timeLabel: Type.Optional(
    Type.String({
      description:
        'Optional human-readable time of visit, e.g. "10:00 AM", "Lunch", "After dinner". Free-form. NOT enriched by Places — supply this yourself.'
    })
  ),
  note: Type.Optional(
    Type.String({
      description:
        'One- or two-sentence rationale specific to this stop (why visit, what to do there). Avoid generic descriptions. Renders under a "Notes" header in the detail card. NOT enriched — this is the only narrative you provide.'
    })
  )
})

const daySchema = Type.Object({
  label: Type.String({
    description:
      'Short tab label, 6 chars or fewer recommended. Examples: "Day 1", "周一", "Morning". This is what shows in the tab strip.'
  }),
  title: Type.Optional(
    Type.String({
      description:
        'Headline for this day in the side panel — e.g. "Inner-city composer trail + Musikverein". Keep under ~40 chars.'
    })
  ),
  summary: Type.Optional(
    Type.String({
      description:
        'One- or two-sentence overview of the day. Renders below the title in the side panel.'
    })
  ),
  // Accept any string here so the LLM can emit "WALK"/"DRIVE"/"walking"/etc.
  // without tripping schema validation; normalize in execute(). The original
  // strict literal union failed against the routing tool's enum-like
  // "WALK"/"DRIVE" the model picked up by analogy.
  routeMode: Type.Optional(
    Type.String({
      description:
        'Travel mode used to draw the route line and to deep-link Google Maps. Accepts (case-insensitive): "walking" (default), "driving", "transit". WALK/DRIVE/TRANSIT also accepted as aliases.'
    })
  ),
  places: Type.Array(placeSchema, {
    description:
      'Stops in visit order. The route line connects them in sequence; the first place is start, last is end.'
  })
})

const mapItinerarySchema = Type.Object({
  title: Type.Optional(
    Type.String({
      description:
        'Optional overall trip title shown above the tabs (e.g. "维也纳 3 日音乐之旅"). Omit for single-day plans.'
    })
  ),
  days: Type.Array(daySchema, {
    description:
      'One or more days. Use a single day with a single place for a lookup, a single day with two places for a route, or one day per day for a multi-day plan.'
  })
})

type EnrichedReview = {
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
  // Places-API-enriched (any of these may be undefined if enrichment failed)
  rating?: number
  reviewCount?: number
  phone?: string
  websiteUri?: string
  googleMapsUri?: string
  address?: string
  openNow?: boolean
  openingHours?: string[]
  /** Photo reference paths from Places API (e.g. "places/XYZ/photos/ABC").
   *  The renderer constructs full URLs by prepending the Places API base
   *  and appending the user's Google API key — keeps the key out of any
   *  potentially-cached server response. */
  photoNames?: string[]
  reviews?: EnrichedReview[]
}

export type MapItineraryDetails = {
  type: 'mapItinerary'
  title?: string
  days: Array<{
    label: string
    title?: string
    summary?: string
    routeMode?: 'walking' | 'driving' | 'transit'
    places: ItineraryPlace[]
  }>
  /** Set when Places enrichment failed for a reason the user can fix
   *  (expired/invalid key, API disabled, no billing, quota). The map still
   *  renders from the LLM's data; the card + a toast explain what's missing. */
  notice?: ToolNotice
}

/**
 * Classify a Places enrichment rejection. Returns a short, user-facing reason
 * for the failures worth surfacing — the ones fixable in Settings → Google
 * Cloud — or `null` for transient failures (timeouts, 5xx, no match), which
 * we swallow silently since the map still renders.
 */
export function classifyPlacesFailure(reason: unknown): string | null {
  const msg = String(
    reason instanceof Error ? reason.message : reason
  ).toLowerCase()
  if (/api key expired|renew the api key/.test(msg)) {
    return 'the Google API key has expired'
  }
  if (/api_key_invalid|api key not valid|invalid api key/.test(msg)) {
    return 'the Google API key is invalid'
  }
  if (
    /service_disabled|has not been used in project|is disabled|not enabled/.test(
      msg
    )
  ) {
    return 'the Places API is not enabled for this Google Cloud project'
  }
  if (/billing/.test(msg)) {
    return 'the Google Cloud project has no active billing account'
  }
  if (/permission_denied|permission denied|forbidden|\b403\b/.test(msg)) {
    return 'the Google API key lacks permission for the Places API'
  }
  if (/unauthenticated|unauthorized|\b401\b/.test(msg)) {
    return 'the Google API key was rejected'
  }
  if (/resource_exhausted|quota|rate limit|\b429\b/.test(msg)) {
    return 'the Places API quota has been exceeded'
  }
  return null
}

function normalizeRouteMode(
  value: string | undefined
): 'walking' | 'driving' | 'transit' | undefined {
  if (!value) return undefined
  const lower = value.toLowerCase()
  if (lower === 'walking' || lower === 'walk') return 'walking'
  if (lower === 'driving' || lower === 'drive') return 'driving'
  if (lower === 'transit') return 'transit'
  return undefined
}

/** Fields we ask the Places API to return — narrow to what the renderer
 *  uses, since billing is per-field-class on the v1 API. */
const PLACES_FIELD_MASK = [
  'places.id',
  'places.displayName',
  'places.formattedAddress',
  'places.location',
  'places.rating',
  'places.userRatingCount',
  'places.internationalPhoneNumber',
  'places.websiteUri',
  'places.googleMapsUri',
  'places.primaryTypeDisplayName',
  'places.regularOpeningHours.openNow',
  'places.regularOpeningHours.weekdayDescriptions',
  'places.photos.name',
  'places.reviews.authorAttribution',
  'places.reviews.rating',
  'places.reviews.text',
  'places.reviews.relativePublishTimeDescription'
].join(',')

/** Single Places SearchText call biased to the LLM's coordinates. The
 *  500m radius is tight enough that a same-name place in another city
 *  won't win, loose enough to absorb the LLM's coordinate inaccuracy. */
async function enrichPlace(
  client: v1.PlacesClient,
  place: { name: string; lat: number; lng: number }
): Promise<Partial<ItineraryPlace>> {
  const response = await client.searchText(
    {
      textQuery: place.name,
      locationBias: {
        circle: {
          center: { latitude: place.lat, longitude: place.lng },
          radius: 500
        }
      },
      maxResultCount: 1
    },
    {
      otherArgs: {
        headers: { 'X-Goog-FieldMask': PLACES_FIELD_MASK }
      }
    }
  )
  const top = response[0]?.places?.[0]
  if (!top) return {}

  const reviews: EnrichedReview[] = (top.reviews ?? [])
    .slice(0, 3)
    .map((r) => ({
      author: r.authorAttribution?.displayName ?? undefined,
      authorPhotoUrl: r.authorAttribution?.photoUri ?? undefined,
      rating: r.rating ?? undefined,
      text: r.text?.text ?? undefined,
      relativeTime: r.relativePublishTimeDescription ?? undefined
    }))
    .filter((r) => r.text || r.author)

  return {
    rating: top.rating ?? undefined,
    reviewCount: top.userRatingCount ?? undefined,
    phone: top.internationalPhoneNumber ?? undefined,
    websiteUri: top.websiteUri ?? undefined,
    googleMapsUri: top.googleMapsUri ?? undefined,
    address: top.formattedAddress ?? undefined,
    type: top.primaryTypeDisplayName?.text ?? undefined,
    openNow: top.regularOpeningHours?.openNow ?? undefined,
    openingHours: top.regularOpeningHours?.weekdayDescriptions ?? undefined,
    photoNames: (top.photos ?? [])
      .slice(0, 4)
      .map((p) => p.name ?? '')
      .filter(Boolean),
    reviews: reviews.length > 0 ? reviews : undefined
  }
}

export const mapItinerary = (
  setting: Settings
): AgentTool<typeof mapItinerarySchema> => ({
  name: TOOL_NAMES.mapItinerary,
  label: 'Map Itinerary',
  description:
    'Build a trip plan or any map-based answer as a single interactive card with tabs (one tab per day or section), a shared map instance, and a clickable place list. ' +
    'USE WHEN: any answer that benefits from showing places on a map — single-stop lookups, A→B routes, day-by-day itineraries, sightseeing tours, multi-city trips. ' +
    'For a single place lookup, pass one day with one place. For a route, pass one day with two places (origin → destination). For a multi-day plan, pass one day per day. ' +
    'For each place provide name + lat/lng (your best estimate) + optional timeLabel + optional note. The server fetches real Google Places data (rating, reviews, photos, phone, website, opening hours) automatically — DO NOT include those fields yourself; you cannot fabricate them reliably.',
  parameters: mapItinerarySchema,
  execute: async (_toolCallId, payload, signal) => {
    if (signal?.aborted) throw new Error('Aborted')
    // Note: @googlemaps/places' CallOptions (google-gax) has no `signal`
    // field, so an in-flight Places lookup below can't be cancelled early —
    // only this initial check is honored.
    const apiKey = setting.googleCloud?.googleApiKey
    if (!apiKey) {
      throw new Error(
        'Map Itinerary requires a Google API Key. Please add it in Settings → Google Cloud.'
      )
    }

    const placesClient = new v1.PlacesClient({ apiKey })

    // Flatten places across days for one parallel batch, then re-zip back
    // into the day structure. Promise.allSettled so a single Places API
    // failure doesn't blow up the whole itinerary.
    const flat = payload.days.flatMap((d, dayIdx) =>
      d.places.map((p, placeIdx) => ({ dayIdx, placeIdx, place: p }))
    )
    const enrichments = await Promise.allSettled(
      flat.map(({ place }) => enrichPlace(placesClient, place))
    )

    type EnrichmentMap = Record<string, Partial<ItineraryPlace>>
    const byKey: EnrichmentMap = {}
    let placesFailureReason: string | null = null
    enrichments.forEach((settled, i) => {
      const { dayIdx, placeIdx } = flat[i]
      if (settled.status === 'fulfilled') {
        byKey[`${dayIdx}-${placeIdx}`] = settled.value
      } else {
        logger.warn('tools', 'Places enrichment failed for place', {
          placeName: flat[i].place.name,
          error: settled.reason
        })
        byKey[`${dayIdx}-${placeIdx}`] = {}
        placesFailureReason ??= classifyPlacesFailure(settled.reason)
      }
    })

    const notice: ToolNotice | undefined = placesFailureReason
      ? {
          level: 'warning',
          message: `Live place data is unavailable — ${placesFailureReason}. The map shows your stops, but ratings, photos, phone numbers, and opening hours are missing. Check your key in Settings → Google Cloud.`
        }
      : undefined

    const days: MapItineraryDetails['days'] = payload.days.map((d, dayIdx) => ({
      label: d.label,
      title: d.title,
      summary: d.summary,
      routeMode: normalizeRouteMode(d.routeMode as string | undefined),
      places: d.places.map((p, placeIdx) => {
        const enriched = byKey[`${dayIdx}-${placeIdx}`] ?? {}
        // LLM-provided fields stay; enriched fields fill gaps. The LLM's
        // `name` and lat/lng are authoritative (the LLM picked them; the
        // Places match is a best guess). Everything else prefers Places
        // data when present.
        return {
          name: p.name,
          lat: p.lat,
          lng: p.lng,
          type: enriched.type ?? p.type,
          timeLabel: p.timeLabel,
          note: p.note,
          rating: enriched.rating,
          reviewCount: enriched.reviewCount,
          phone: enriched.phone,
          websiteUri: enriched.websiteUri,
          googleMapsUri: enriched.googleMapsUri,
          address: enriched.address,
          openNow: enriched.openNow,
          openingHours: enriched.openingHours,
          photoNames: enriched.photoNames,
          reviews: enriched.reviews
        }
      })
    }))

    const details: MapItineraryDetails = {
      type: 'mapItinerary',
      title: payload.title,
      days,
      ...(notice && { notice })
    }
    return {
      content: [
        {
          type: 'text' as const,
          text:
            (payload.title ? `${payload.title}\n` : '') +
            days
              .map(
                (d) =>
                  `${d.label}${d.title ? `: ${d.title}` : ''} (${d.places.length} stop${d.places.length === 1 ? '' : 's'})`
              )
              .join('\n')
        }
      ],
      details
    }
  }
})
