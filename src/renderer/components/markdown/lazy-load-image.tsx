import { ImageNotFound01Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  type HTMLAttributeReferrerPolicy,
  type ReactNode,
  useState
} from 'react'

import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

/**
 * Every image fetched from the network (owner's rule, 2026-09-30): a
 * skeleton while it loads, a fade in, an icon — or the caller's `fallback` —
 * when it fails. Tiny glyphs (favicons, flags) and local `data:` / bundled
 * images are drawn directly.
 */
export function LazyLoadImage({
  src,
  alt,
  className,
  skeletonClassName,
  imgClassName,
  loadingClassName,
  referrerPolicy,
  fallback,
  onError
}: {
  src: string
  alt: string
  /** The box. Sized by the caller: `size-full` by default, for a tile. */
  className?: string
  skeletonClassName?: string
  /** On the image itself: a lightbox shows it whole (`object-contain`)
   *  where a grid tile crops it (`object-cover`, the default). */
  imgClassName?: string
  /** On the box until the image is in: room for the skeleton when the box
   *  takes the picture's own size (a Markdown image). */
  loadingClassName?: string
  /** Some hosts refuse an app's Referer: Google's avatars, news sites. */
  referrerPolicy?: HTMLAttributeReferrerPolicy
  /** Drawn instead of the default icon when the image fails. */
  fallback?: ReactNode
  /** Told when the image fails, for a caller that would rather show nothing at all. */
  onError?: () => void
}) {
  const [isLoaded, setIsLoaded] = useState(false)
  const [hasError, setHasError] = useState(false)

  if (hasError && fallback !== undefined) return <>{fallback}</>

  return (
    <div
      className={cn(
        'relative flex size-full items-center justify-center overflow-hidden',
        className,
        !isLoaded && !hasError && loadingClassName
      )}
    >
      {!isLoaded && !hasError && (
        <Skeleton
          className={cn(
            'absolute top-0 left-0 size-full rounded-none',
            skeletonClassName
          )}
        />
      )}

      {!hasError && (
        <img
          src={src}
          alt={alt}
          loading="lazy"
          referrerPolicy={referrerPolicy}
          onLoad={() => setIsLoaded(true)}
          onError={() => {
            setHasError(true)
            setIsLoaded(true)
            onError?.()
          }}
          className={cn(
            'size-full object-cover transition-opacity duration-700',
            isLoaded ? 'opacity-100' : 'opacity-0',
            imgClassName
          )}
        />
      )}

      {hasError && (
        <div className="bg-accent text-card flex size-full flex-col items-center justify-center">
          {/* A third of the box, at most 48px: a 32px map pin no longer
              holds a 48px icon. */}
          <HugeiconsIcon
            icon={ImageNotFound01Icon}

            className="size-1/3 max-h-12 max-w-12"
          />
        </div>
      )}
    </div>
  )
}
