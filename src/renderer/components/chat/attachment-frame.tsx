import { TEST_IDS } from '@actovia/shared/constants/test-ids'
import type { AttachmentRequest } from '@actovia/shared/types/attachment-actions'
import { DownloadIcon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import type { MouseEvent, ReactElement, ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import Zoom from 'react-medium-image-zoom'

import { openAttachmentMenu, saveAttachment } from '@/lib/attachment-actions'
import { cn } from '@/lib/utils'

/**
 * The download control on an attachment: a small round button that shows on
 * hover, or when focus lands on it (it stays in the tab order while hidden,
 * so the keyboard can always reach it).
 */
export function AttachmentDownloadButton({
  attachment,
  className,
  testId = TEST_IDS.attachment.download
}: {
  attachment: AttachmentRequest
  className?: string
  testId?: string
}) {
  const { t } = useTranslation('common')
  return (
    <button
      type="button"
      data-testid={testId}
      aria-label={t('attachment.download')}
      title={t('attachment.download')}
      onClick={(event) => {
        // The image under it zooms on a click; this one is the button's.
        event.stopPropagation()
        void saveAttachment(attachment, t)
      }}
      className={cn(
        'bg-background/80 text-foreground ring-border hover:bg-background focus-visible:ring-ring flex size-7 items-center justify-center rounded-full shadow-sm ring-1 backdrop-blur transition-opacity duration-150 focus-visible:ring-2 focus-visible:outline-none',
        className
      )}
    >
      <HugeiconsIcon
        icon={DownloadIcon}

        size={14}
        aria-hidden
      />
    </button>
  )
}

/** Right-click on an attachment: the native menu, from the main process. */
export function useAttachmentContextMenu(attachment: AttachmentRequest | null) {
  const { t } = useTranslation('common')
  return (event: MouseEvent) => {
    if (!attachment) return
    event.preventDefault()
    event.stopPropagation()
    void openAttachmentMenu(attachment, t)
  }
}

/**
 * An attachment in the transcript: the native menu on right-click, and a
 * download button at its top-right corner on hover or focus.
 */
export function AttachmentFrame({
  attachment,
  className,
  buttonClassName,
  children
}: {
  attachment: AttachmentRequest
  className?: string
  /** Where the button sits, when the corner already holds something. */
  buttonClassName?: string
  children: ReactNode
}) {
  const onContextMenu = useAttachmentContextMenu(attachment)
  return (
    <div
      className={cn('group/attachment relative', className)}
      onContextMenu={onContextMenu}
    >
      {children}
      <AttachmentDownloadButton
        attachment={attachment}
        className={cn(
          'absolute top-1.5 right-1.5 opacity-0 group-focus-within/attachment:opacity-100 group-hover/attachment:opacity-100',
          buttonClassName
        )}
      />
    </div>
  )
}

/**
 * The zoomed view's toolbar: the library's own close button, and Download
 * beside it.
 */
export function ZoomToolbar({
  attachment,
  buttonUnzoom,
  img
}: {
  attachment: AttachmentRequest
  buttonUnzoom: ReactElement
  img: ReactElement | null
}) {
  const onContextMenu = useAttachmentContextMenu(attachment)
  return (
    <>
      {buttonUnzoom}
      <AttachmentDownloadButton
        attachment={attachment}
        testId={TEST_IDS.attachment.zoomDownload}
        // Beside the library's unzoom button (20px in, 40px wide).
        className="absolute top-5 right-17 z-[1] size-10"
      />
      <div className="contents" onContextMenu={onContextMenu}>
        {img}
      </div>
    </>
  )
}

/** A zoomable image attachment: `AttachmentFrame` around the zoom. */
export function ZoomableAttachment({
  attachment,
  className,
  buttonClassName,
  children
}: {
  attachment: AttachmentRequest
  className?: string
  buttonClassName?: string
  children: ReactNode
}) {
  return (
    <AttachmentFrame
      attachment={attachment}
      className={className}
      buttonClassName={buttonClassName}
    >
      <Zoom
        ZoomContent={({ buttonUnzoom, img }) => (
          <ZoomToolbar
            attachment={attachment}
            buttonUnzoom={buttonUnzoom}
            img={img}
          />
        )}
      >
        {children}
      </Zoom>
    </AttachmentFrame>
  )
}
