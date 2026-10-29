import { TEST_IDS } from '@actovia/shared/constants/test-ids'
import { Album02Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useState } from 'react'

import { AttachmentFrame } from '@/components/chat/attachment-frame'
import { LazyLoadImage } from '@/components/markdown/lazy-load-image'

import type { GalleryImage } from './collect-gallery-images'
import { galleryAttachment, ImageLightbox } from './image-lightbox'

const MAX_THUMBS = 3

export function ImageGallery({ images }: { images: GalleryImage[] }) {
  const [openAt, setOpenAt] = useState<number | null>(null)
  if (images.length === 0) return null

  const thumbs = images.slice(0, MAX_THUMBS)
  const hasMore = images.length > MAX_THUMBS

  return (
    // ChatGPT's row (ISSUE-294): three tall tiles, the picture left as it is
    // and the count of the rest on a small pill in the last one's corner.
    <div className="my-4">
      <div className="flex gap-1.5">
        {thumbs.map((img, i) => {
          const isLastWithMore = i === MAX_THUMBS - 1 && hasMore
          return (
            // The copy Brave fetched is what is shown, so it is what is saved:
            // the site's own file may refuse a hotlink, be gone, or not answer.
            <AttachmentFrame
              key={img.url}
              attachment={galleryAttachment(img)}
              className="h-52 flex-1"
            >
              <button
                type="button"
                onClick={() => setOpenAt(i)}
                data-testid={TEST_IDS.gallery.thumbnail}
                className="relative size-full overflow-hidden rounded-xl transition-[filter] duration-150 ease-out hover:brightness-95"
              >
                <LazyLoadImage
                  src={img.thumbnailUrl}
                  alt={img.title}
                  className="size-full"
                />
                {isLastWithMore && (
                  <span className="absolute bottom-2.5 left-2.5 flex items-center gap-1 rounded-full bg-black/45 px-2 py-0.5 text-xs font-medium text-white tabular-nums backdrop-blur-sm">
                    <HugeiconsIcon icon={Album02Icon} size={14} />
                    {images.length}
                  </span>
                )}
              </button>
            </AttachmentFrame>
          )
        })}
      </div>

      {openAt !== null && (
        <ImageLightbox
          images={images}
          index={openAt}
          onIndexChange={setOpenAt}
          onClose={() => setOpenAt(null)}
        />
      )}
    </div>
  )
}
