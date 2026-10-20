import { ErrorCode } from '@actovia/shared/constants/error-codes'
import {
  ConfigurationError,
  ServiceError,
  ValidationError
} from '@actovia/shared/errors/app-error'
import { Hono } from 'hono'

import { logger } from '../../logger'
import { fetchPublicHttps } from '../../net/safe-fetch'
import { Variables } from '../types'

/**
 * `GET /api/v1/maps/photo?name=<places/…/photos/…>&maxWidth=<px>` — a Google
 * Places photo, fetched here with the user's key so the key never leaves the
 * main process (the map-itinerary card used to build
 * `places.googleapis.com/…/media?key=…` URLs in the renderer, which kept the
 * key in plaintext on `GET /api/v1/settings`).
 *
 * `name` must be a Places photo resource name (what `map_itinerary` returns in
 * `photoNames`); the request goes only to the fixed Places host through
 * `fetchPublicHttps()` (https only, public addresses only, pinned, redirects
 * re-checked — the media endpoint answers with a redirect to
 * `lh3.googleusercontent.com`). Neither the key nor the upstream URL appears
 * in an error or a log line.
 *
 * Mounted under `/api/v1`, so a paired device (actovia-ios) reaches it over the
 * LAN with its token, and the lock gate applies.
 */
const maps = new Hono<{ Variables: Variables }>()

const PLACES_HOST = 'https://places.googleapis.com/v1/'
const PHOTO_NAME = /^places\/[\w-]{1,256}\/photos\/[\w-]{1,2048}$/u
const DEFAULT_WIDTH = 800
const MAX_WIDTH = 4800
const MAX_BYTES = 10 * 1024 * 1024

export function isPlacePhotoName(name: string): boolean {
  return PHOTO_NAME.test(name)
}

function widthOf(raw: string | undefined): number {
  if (raw === undefined || raw === '') return DEFAULT_WIDTH
  if (!/^\d{1,4}$/u.test(raw)) {
    throw new ValidationError(ErrorCode.VALIDATION_FAILED, 'Invalid maxWidth')
  }
  const n = Number(raw)
  if (n < 1 || n > MAX_WIDTH) {
    throw new ValidationError(ErrorCode.VALIDATION_FAILED, 'Invalid maxWidth')
  }
  return n
}

maps.get('/photo', async (c) => {
  const name = c.req.query('name') ?? ''
  if (!isPlacePhotoName(name)) {
    throw new ValidationError(
      ErrorCode.VALIDATION_FAILED,
      'Invalid Places photo name'
    )
  }
  const width = widthOf(c.req.query('maxWidth'))
  const key = c.get('settings')?.googleCloud?.googleApiKey
  if (!key) {
    throw new ConfigurationError(
      ErrorCode.CONFIG_MISSING_API_KEY,
      'No Google API key is set'
    )
  }
  const url = `${PLACES_HOST}${name}/media?maxWidthPx=${width}&key=${encodeURIComponent(key)}`
  let photo: { bytes: Buffer; contentType: string | null }
  try {
    photo = await fetchPublicHttps(url, {
      maxBytes: MAX_BYTES,
      timeoutMs: 20_000,
      signal: c.req.raw.signal
    })
  } catch (error) {
    // The message of a safe-fetch error never carries the URL (or the key),
    // and a stack holds no more than the message and code positions.
    logger.warn('maps', 'Places photo fetch failed', {
      error: error instanceof Error ? error : 'unknown'
    })
    throw new ServiceError(
      ErrorCode.SERVICE_UNAVAILABLE,
      'Places photo unavailable'
    )
  }
  const type = photo.contentType?.split(';')[0]?.trim().toLowerCase() ?? ''
  if (!type.startsWith('image/')) {
    throw new ServiceError(
      ErrorCode.SERVICE_UNAVAILABLE,
      'Places photo unavailable'
    )
  }
  return new Response(new Uint8Array(photo.bytes), {
    headers: {
      'Content-Type': type,
      'Content-Length': String(photo.bytes.length),
      'Cache-Control': 'private, max-age=86400',
      'X-Content-Type-Options': 'nosniff'
    }
  })
})

export default maps
