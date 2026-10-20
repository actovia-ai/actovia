import { TEST_IDS } from '@actovia/shared/constants/test-ids'
import { PlayIcon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useTranslation } from 'react-i18next'

import { LazyLoadImage } from '@/components/markdown/lazy-load-image'
import { SourceFavicon } from '@/components/markdown/source-favicon'

import type { GalleryVideo } from './collect-gallery-videos'

/** Compact view count: 1234 → "1.2K", 4_500_000 → "4.5M". */
function formatViews(n: number): string {
  if (n < 1000) return `${n}`
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}K`
  return `${(n / 1_000_000).toFixed(n < 10_000_000 ? 1 : 0)}M`
}

export function VideoCards({ videos }: { videos: GalleryVideo[] }) {
  const { t } = useTranslation('webSearch')
  if (videos.length === 0) return null

  return (
    <div className="my-3 flex gap-3 overflow-x-auto pb-1">
      {videos.map((video) => (
        <a
          key={video.url}
          href={video.url}
          target="_blank"
          rel="noopener noreferrer"
          data-testid={TEST_IDS.video.card}
          className="w-52 shrink-0"
        >
          <div className="relative aspect-video overflow-hidden rounded-xl">
            <LazyLoadImage
              src={video.thumbnailUrl}
              alt={video.title}
              className="size-full"
            />
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="flex size-10 items-center justify-center rounded-full bg-black/60 text-white">
                <HugeiconsIcon
                  icon={PlayIcon}

                  size={18}
                  className="translate-x-px fill-current"
                />
              </span>
            </div>
            {video.duration && (
              <span className="absolute right-1.5 bottom-1.5 rounded bg-black/70 px-1.5 py-0.5 text-xs font-medium text-white">
                {video.duration}
              </span>
            )}
          </div>
          <div className="mt-1.5 line-clamp-2 text-sm font-medium">
            {video.title}
          </div>
          <div className="text-muted-foreground mt-1 flex items-center gap-1.5 text-xs">
            <SourceFavicon link={video.url} className="size-3.5" />
            {(video.creator || video.source) && (
              <span className="truncate">{video.creator || video.source}</span>
            )}
            {video.views != null && video.views > 0 && (
              <span className="shrink-0">
                · {t('videoCard.views', { count: formatViews(video.views) })}
              </span>
            )}
          </div>
        </a>
      ))}
    </div>
  )
}
