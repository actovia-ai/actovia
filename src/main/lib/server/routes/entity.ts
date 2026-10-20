import { ErrorCode } from '@actovia/shared/constants/error-codes'
import { ServiceError, ValidationError } from '@actovia/shared/errors/app-error'
import type { EntitySummary } from '@actovia/shared/types/entity'
import {
  isWikipediaLang,
  isWikipediaTitle
} from '@actovia/shared/utils/entity-link'
import { Hono } from 'hono'

import { logger } from '../../logger'
import { fetchPublicHttps } from '../../net/safe-fetch'
import { Variables } from '../types'

/**
 * `GET /api/v1/entity/:title?lang=xx` — Wikipedia's summary of an article,
 * for the panel a reply's `[name](entity:Title)` link opens (actovia-ios spec
 * 2026-10-07 §2.2). Fetched here through `fetchPublicHttps()` (https only,
 * public addresses only, pinned) so a paired phone needs no network but its
 * computer's, and the answer is kept a day. Tried in the app's language
 * first, then English; an article neither has is `{ extract: null }` with a
 * 200 — "nothing found" is an answer, not a failure. The upstream URL never
 * appears in an error or a log line.
 */
const entity = new Hono<{ Variables: Variables }>()

const TTL_MS = 24 * 60 * 60 * 1000
const CACHE_MAX = 500
const MAX_BYTES = 512 * 1024
// Wikimedia's API policy asks every client for a User-Agent that names it
// and says where to find its maker.
const USER_AGENT =
  'Actovia/1 (https://github.com/actovia-ai/actovia) entity-panel'

interface WikipediaSummary {
  title?: string
  extract?: string
  description?: string
  thumbnail?: { source?: string; width?: number; height?: number }
  content_urls?: { desktop?: { page?: string } }
  lang?: string
}

const cache = new Map<string, { at: number; summary: EntitySummary }>()

/** For tests: the day's memory emptied. */
export function clearEntityCache(): void {
  cache.clear()
}

/** Wikipedia's answer as the panel's: the fields it draws, the rest dropped. */
export function summaryOf(
  json: WikipediaSummary,
  lang: string,
  askedTitle: string
): EntitySummary {
  const thumb = json.thumbnail
  const hasThumb =
    typeof thumb?.source === 'string' &&
    thumb.source.startsWith('https://') &&
    typeof thumb.width === 'number' &&
    typeof thumb.height === 'number' &&
    thumb.width > 0 &&
    thumb.height > 0
  const page = json.content_urls?.desktop?.page
  return {
    title: json.title ?? askedTitle.replaceAll('_', ' '),
    extract: json.extract?.trim() || null,
    description: json.description ?? null,
    thumbnail: hasThumb
      ? { source: thumb.source!, width: thumb.width!, height: thumb.height! }
      : null,
    url: typeof page === 'string' && page.startsWith('https://') ? page : null,
    lang: json.lang ?? lang
  }
}

/** The article's summary in `lang`, or null when Wikipedia has no such page (its 404). */
async function lookup(
  lang: string,
  title: string,
  signal: AbortSignal
): Promise<EntitySummary | null> {
  const url = `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`
  let fetched: { bytes: Buffer; contentType: string | null }
  try {
    fetched = await fetchPublicHttps(url, {
      maxBytes: MAX_BYTES,
      timeoutMs: 15_000,
      signal,
      headers: { Accept: 'application/json', 'User-Agent': USER_AGENT }
    })
  } catch (error) {
    if (error instanceof Error && error.message === 'HTTP 404') return null
    throw error
  }
  const json = JSON.parse(fetched.bytes.toString('utf8')) as WikipediaSummary
  return summaryOf(json, lang, title)
}

function remember(key: string, summary: EntitySummary): void {
  if (cache.size >= CACHE_MAX) {
    const oldest = cache.keys().next().value
    if (oldest !== undefined) cache.delete(oldest)
  }
  cache.set(key, { at: Date.now(), summary })
}

entity.get('/:title', async (c) => {
  const title = c.req.param('title')
  if (!isWikipediaTitle(title)) {
    throw new ValidationError(
      ErrorCode.VALIDATION_FAILED,
      'Invalid entity title'
    )
  }
  const lang = c.req.query('lang') ?? 'en'
  if (!isWikipediaLang(lang)) {
    throw new ValidationError(ErrorCode.VALIDATION_FAILED, 'Invalid lang')
  }
  const key = `${lang}/${title}`
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < TTL_MS) return c.json(hit.summary)
  const signal = c.req.raw.signal
  let summary: EntitySummary
  try {
    const found =
      (await lookup(lang, title, signal)) ??
      (lang === 'en' ? null : await lookup('en', title, signal))
    summary = found ?? {
      title: title.replaceAll('_', ' '),
      extract: null,
      description: null,
      thumbnail: null,
      url: null,
      lang
    }
  } catch (error) {
    // A safe-fetch error's message never carries the URL.
    logger.warn('entity', 'Wikipedia summary fetch failed', {
      error: error instanceof Error ? error : 'unknown'
    })
    throw new ServiceError(
      ErrorCode.SERVICE_UNAVAILABLE,
      'Entity summary unavailable'
    )
  }
  remember(key, summary)
  return c.json(summary)
})

export default entity
