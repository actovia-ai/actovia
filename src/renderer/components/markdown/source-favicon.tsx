import { faviconUrl } from '@actovia/shared/constants/external-urls'
import { useState } from 'react'

import { cn } from '@/lib/utils'

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
      className={cn('size-4 shrink-0 rounded-sm', className)}
      onError={() => {
        if (src !== googleFallback) setSrc(googleFallback)
      }}
    />
  )
}
