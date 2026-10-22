import { faviconUrl } from '@actovia/shared/constants/external-urls'
import { useState } from 'react'

import { cn } from '@/lib/utils'

/**
 * What a favicon sits on. Many are a dark glyph on a transparent ground and
 * vanish on a dark surface, so in dark mode each gets a light disc behind it.
 */
export const FAVICON_BACKING = 'dark:bg-foreground/90 dark:p-px'

/**
 * Favicon that prefers the Brave-provided URL and falls back to the Google
 * favicon API on error (or when no Brave favicon is available).
 */
export function SourceFavicon({
  link,
  favicon,
  className
}: {
  link: string
  favicon?: string
  className?: string
}) {
  const googleFallback = (() => {
    try {
      return faviconUrl(new URL(link).origin)
    } catch {
      return faviconUrl(link)
    }
  })()
  const [src, setSrc] = useState(favicon || googleFallback)
  return (
    <img
      src={src}
      alt=""
      loading="lazy"
      className={cn('size-4 shrink-0 rounded-sm', FAVICON_BACKING, className)}
      onError={() => {
        if (src !== googleFallback) setSrc(googleFallback)
      }}
    />
  )
}
