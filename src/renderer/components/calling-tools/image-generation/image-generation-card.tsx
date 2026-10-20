import { TEST_IDS } from '@actovia/shared/constants/test-ids'
import type {
  ChatToolResultMessage,
  ImageGenerationDetails
} from '@actovia/shared/types/chat'
import { memo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  ImageGeneration,
  type ImageGenerationStatus
} from '@/components/calling-tools/image-generation/image-generation-loading'
import { ZoomableAttachment } from '@/components/chat/attachment-frame'
import { useSettings } from '@/hooks/use-settings'
import { imageSrcOf } from '@/lib/generated-image'

export { imageSrcOf }

// Placeholders shown while a call runs, one per image the settings ask for.
const MAX_PLACEHOLDERS = 4

/** Pending → generating; an error result → error; any other → complete. */
export function imageGenerationStatus(
  result?: ChatToolResultMessage
): ImageGenerationStatus {
  if (!result) return 'generating'
  return result.isError ? 'error' : 'complete'
}

/**
 * `1024x1536` → an aspect ratio to reserve and a badge to show. `auto`, empty
 * or anything unparsable → a square with no badge.
 */
export function parseImageSize(size: string | null | undefined): {
  aspectRatio: string
  resolution?: string
} {
  const match = /^(\d+)x(\d+)$/u.exec(size ?? '')
  if (!match) return { aspectRatio: '1 / 1' }
  const [, w, h] = match
  return { aspectRatio: `${w} / ${h}`, resolution: `${w} × ${h}` }
}

function imagesOf(result: ChatToolResultMessage | undefined) {
  if (!result || result.isError) return []
  const details = result.details as ImageGenerationDetails | null | undefined
  return Array.isArray(details?.images) ? details.images : []
}

/** One frame; a finished image that fails to load says so in place. */
function Frame({
  status,
  prompt,
  url,
  alt,
  aspectRatio,
  resolution
}: {
  status: ImageGenerationStatus
  prompt: string
  url?: string
  alt: string
  aspectRatio: string
  resolution?: string
}) {
  const { t } = useTranslation('chat')
  const [failed, setFailed] = useState(false)
  // A result with no usable image (an expired DALL·E link, a row saved before
  // base64 results were kept) is not an image: say so instead of a blank box.
  const unavailable = status === 'complete' && (!url || failed)

  return (
    <ImageGeneration
      data-testid={TEST_IDS.imageGeneration.card}
      status={unavailable ? 'error' : status}
      statusText={
        unavailable ? t('imageGeneration.status.unavailable') : undefined
      }
      prompt={prompt || undefined}
      aspectRatio={aspectRatio}
      resolution={resolution}
      className="w-52"
    >
      {url && !failed ? (
        <ZoomableAttachment
          attachment={{ url, kind: 'image' }}
          // Fills the frame as the zoom did when it was the frame's child.
          className="[&>[data-rmiz]]:size-full"
          // Under the size badge, which holds the corner.
          buttonClassName={resolution ? 'top-9 right-2' : undefined}
        >
          <img src={url} alt={alt} onError={() => setFailed(true)} />
        </ZoomableAttachment>
      ) : null}
    </ImageGeneration>
  )
}

/**
 * An `image_generation` call from the moment it is made: a dither field
 * while it runs, the image resolving in the same frame when it lands, the
 * error state when the tool failed (no retry — a call cannot be re-run on
 * its own; regenerating the answer is the retry). The finished image lives
 * here, with its zoom, and nowhere else.
 *
 * Memoized on its props: `prompt` is a string and `result` keeps its
 * identity across stream frames, so a settled card never re-renders.
 */
export const ImageGenerationCard = memo(function ImageGenerationCard({
  prompt,
  result
}: {
  prompt: string
  result?: ChatToolResultMessage
}) {
  const { t } = useTranslation('chat')
  const { data: settings } = useSettings()
  const status = imageGenerationStatus(result)
  const images = imagesOf(result)
  const details = result?.details as ImageGenerationDetails | null | undefined
  // The size the call asked for; while it runs (and for rows saved before it
  // was recorded) the size the settings will ask for.
  const { aspectRatio, resolution } = parseImageSize(
    details?.size ?? settings?.image?.size
  )

  const frames: Array<{ url?: string; alt?: string }> =
    status === 'complete'
      ? images.length > 0
        ? images.map((image) => ({
            url: imageSrcOf(image),
            alt: image.revisedPrompt
          }))
        : [{}]
      : status === 'error'
        ? [{}]
        : Array.from(
            {
              length: Math.min(
                Math.max(settings?.image?.generatedCounts ?? 1, 1),
                MAX_PLACEHOLDERS
              )
            },
            () => ({})
          )

  return (
    <section className="mb-4 flex flex-wrap gap-3">
      {frames.map((frame, i) => (
        <Frame
          // Generated images have no id of their own, and the first frame
          // must stay the same element from placeholder to image so it
          // resolves in place rather than being swapped.
          // react-doctor/no-array-index-as-key: see above.
          key={i}
          status={status}
          prompt={prompt}
          url={frame.url}
          alt={frame.alt || prompt || t('imageGeneration.generatedImageAlt')}
          aspectRatio={aspectRatio}
          resolution={resolution}
        />
      ))}
    </section>
  )
})
