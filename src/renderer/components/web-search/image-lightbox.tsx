import { TEST_IDS } from '@actovia/shared/constants/test-ids'
import type { AttachmentRequest } from '@actovia/shared/types/attachment-actions'
import {
  Cancel01Icon,
  ArrowLeft01Icon,
  ArrowRight01Icon
} from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useHotkeys } from '@tanstack/react-hotkeys'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'

import {
  AttachmentDownloadButton,
  useAttachmentContextMenu
} from '@/components/chat/attachment-frame'
import { LazyLoadImage } from '@/components/markdown/lazy-load-image'
import { SourceFavicon } from '@/components/markdown/source-favicon'
import { cn } from '@/lib/utils'

import type { GalleryImage } from './collect-gallery-images'

// Dots only stay legible up to a handful; Brave caps image media at 8 anyway.
const MAX_DOTS = 8

/** A search image to save: the copy on screen, named after its title. */
export function galleryAttachment(image: GalleryImage): AttachmentRequest {
  return { url: image.thumbnailUrl, name: image.title, kind: 'image' }
}

/**
 * The stage image: the copy Brave fetched, never the site's own file — which
 * may refuse a hotlink, be gone, or not answer (owner, 2026-09-30). Loaded as
 * the grid's are (`LazyLoadImage`: a skeleton, then a fade), shown whole.
 */
function LightboxImage({ image }: { image: GalleryImage }) {
  return (
    <div className="relative flex min-h-0 min-w-0 flex-1 items-center justify-center self-stretch">
      <LazyLoadImage
        src={image.thumbnailUrl}
        alt={image.title}
        className="bg-transparent"
        skeletonClassName="rounded-lg"
        imgClassName="object-contain"
      />
    </div>
  )
}

function NavButton({
  direction,
  onClick,
  testId
}: {
  direction: 'prev' | 'next'
  onClick: () => void
  testId: string
}) {
  const { t } = useTranslation('webSearch')
  const Icon = direction === 'prev' ? ArrowLeft01Icon : ArrowRight01Icon
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={testId}
      aria-label={
        direction === 'prev'
          ? t('imageLightbox.previousImage')
          : t('imageLightbox.nextImage')
      }
      className={cn(
        'bg-background/70 text-foreground ring-border hover:bg-background absolute top-1/2 flex size-11 -translate-y-1/2 items-center justify-center rounded-full shadow-md ring-1 backdrop-blur transition',
        direction === 'prev' ? 'left-4' : 'right-4'
      )}
    >
      <HugeiconsIcon icon={Icon} size={22} />
    </button>
  )
}

export function ImageLightbox({
  images,
  index,
  onIndexChange,
  onClose
}: {
  images: GalleryImage[]
  index: number
  onIndexChange: (next: number) => void
  onClose: () => void
}) {
  const { t } = useTranslation(['common', 'webSearch'])
  const atStart = index <= 0
  const atEnd = index >= images.length - 1

  // Same semantics as the window listener this replaced: fires wherever focus
  // is (the composer behind the overlay may still hold it), and never swallows
  // the event.
  useHotkeys(
    [
      { hotkey: 'Escape', callback: () => onClose() },
      {
        hotkey: 'ArrowLeft',
        callback: () => onIndexChange(index - 1),
        options: { enabled: index > 0 }
      },
      {
        hotkey: 'ArrowRight',
        callback: () => onIndexChange(index + 1),
        options: { enabled: index < images.length - 1 }
      }
    ],
    {
      conflictBehavior: 'allow',
      ignoreInputs: false,
      preventDefault: false,
      stopPropagation: false
    }
  )

  const current = images[index]
  const onStageContextMenu = useAttachmentContextMenu(
    current ? galleryAttachment(current) : null
  )
  if (!current) return null

  const closeOnBackdrop = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onClose()
  }

  return createPortal(
    <div
      className="bg-background/95 animate-in fade-in fixed inset-0 z-[100] flex flex-col backdrop-blur-xl duration-150 ease-out"
      onClick={closeOnBackdrop}
    >
      <div className="flex h-12 shrink-0 items-center px-3">
        <button
          type="button"
          onClick={onClose}
          data-testid={TEST_IDS.gallery.lightboxClose}
          aria-label={t('action.close')}
          className="text-muted-foreground hover:bg-foreground/10 hover:text-foreground flex size-8 items-center justify-center rounded-full transition"
        >
          <HugeiconsIcon icon={Cancel01Icon} size={18} />
        </button>
        <AttachmentDownloadButton
          attachment={galleryAttachment(current)}
          testId={TEST_IDS.gallery.lightboxDownload}
          className="ml-auto size-8"
        />
      </div>

      <div
        className="relative flex min-h-0 flex-1 items-center justify-center px-4 sm:px-20"
        onClick={closeOnBackdrop}
      >
        {!atStart && (
          <NavButton
            direction="prev"
            onClick={() => onIndexChange(index - 1)}
            testId={TEST_IDS.gallery.lightboxPrev}
          />
        )}

        {/* `contents`: the stage image keeps its place in the flex row. */}
        <div className="contents" onContextMenu={onStageContextMenu}>
          <LightboxImage key={current.url} image={current} />
        </div>

        {!atEnd && (
          <NavButton
            direction="next"
            onClick={() => onIndexChange(index + 1)}
            testId={TEST_IDS.gallery.lightboxNext}
          />
        )}
      </div>

      <div className="flex shrink-0 flex-col items-center gap-3 px-4 pt-2 pb-6">
        {images.length > 1 &&
          (images.length <= MAX_DOTS ? (
            <div className="flex items-center gap-1.5">
              {images.map((img, i) => (
                <button
                  key={img.url}
                  type="button"
                  onClick={() => onIndexChange(i)}
                  data-testid={TEST_IDS.gallery.lightboxDot}
                  aria-label={t('webSearch:imageLightbox.goToImage', {
                    index: i + 1
                  })}
                  aria-current={i === index || undefined}
                  className={cn(
                    'h-1.5 rounded-full transition-[width,background-color]',
                    i === index
                      ? 'bg-foreground w-5'
                      : 'bg-foreground/25 hover:bg-foreground/50 w-1.5'
                  )}
                />
              ))}
            </div>
          ) : (
            <div className="bg-foreground/8 text-muted-foreground rounded-full px-2.5 py-1 text-xs tabular-nums">
              {index + 1} / {images.length}
            </div>
          ))}

        <a
          href={current.sourceUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-muted-foreground hover:text-foreground flex max-w-2xl items-center gap-2 text-sm"
        >
          <SourceFavicon link={current.sourceUrl} className="size-4" />
          <span className="truncate">{current.title}</span>
        </a>
      </div>
    </div>,
    document.body
  )
}
