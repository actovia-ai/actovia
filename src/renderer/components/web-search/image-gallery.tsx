import { TEST_IDS } from '@actovia/shared/constants/test-ids'
import { Add01Icon } from '@hugeicons/core-free-icons'
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
    <div className="my-3">
      <div className="flex gap-2">
        {thumbs.map((img, i) => {
          const isLastWithMore = i === MAX_THUMBS - 1 && hasMore
          return (
            // The copy Brave fetched is what is shown, so it is what is saved:
            // the site's own file may refuse a hotlink, be gone, or not answer.
            <AttachmentFrame
              key={img.url}
              attachment={galleryAttachment(img)}
              className="h-36 flex-1"
            >
              <button
                type="button"
                onClick={() => setOpenAt(i)}
                data-testid={TEST_IDS.gallery.thumbnail}
                className="relative size-full overflow-hidden rounded-xl"
              >
                <LazyLoadImage
                  src={img.thumbnailUrl}
                  alt={img.title}
                  className="size-full"
                />
                {isLastWithMore && (
                  <div className="absolute inset-0 flex items-center justify-center gap-0.5 bg-black/50 text-sm font-medium text-white">
                    <HugeiconsIcon icon={Add01Icon} size={16} /> {images.length}
                  </div>
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
