import { TEST_IDS } from '@actovia/shared/constants/test-ids'
import type { StepsBlock as StepsBlockData } from '@actovia/shared/types/interactive'
import { useContext } from 'react'
import { useTranslation } from 'react-i18next'

import {
  RemoteImage,
  SearchThumbnailUrlsContext,
  thumbnailHref
} from '@/components/markdown/remote-image'

/**
 * A reply's illustrated steps (`actovia-steps`): a numbered list, each step
 * its text and, when its picture is one of the run's search thumbnails, that
 * picture — loaded on sight by `RemoteImage`, which admits the same URLs. A
 * picture that is anything else (an original, a URL the run never saw) is
 * dropped, never fetched, never a placeholder (spec 2026-10-07 §2.1).
 */
export function StepsBlock({ block }: { block: StepsBlockData }) {
  const { t } = useTranslation('chat')
  const thumbnails = useContext(SearchThumbnailUrlsContext)
  const title = block.title?.trim()
  return (
    <section
      data-interactive="steps"
      data-testid={TEST_IDS.chat.richBlocks.steps}
      className="bg-card text-card-foreground rounded-2xl border p-4"
    >
      {title && (
        <p className="mb-3 text-sm font-semibold text-pretty">{title}</p>
      )}
      <ol className="flex flex-col gap-3">
        {block.steps.map((step, i) => {
          const picture = step.image
            ? thumbnailHref(step.image, thumbnails)
            : null
          return (
            <li
              // Steps never reorder; the place is the identity.
              // eslint-disable-next-line react/no-array-index-key
              key={i}
              data-testid={TEST_IDS.chat.richBlocks.step}
              className="flex items-start gap-3"
            >
              <span
                aria-label={t('richBlocks.stepLabel', { number: i + 1 })}
                className="bg-muted text-muted-foreground mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold tabular-nums"
              >
                {i + 1}
              </span>
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                <p className="text-sm leading-6">{step.text}</p>
                {picture && (
                  <span
                    data-testid={TEST_IDS.chat.richBlocks.stepImage}
                    className="block max-w-72 overflow-hidden rounded-lg"
                  >
                    <RemoteImage src={picture} alt="" className="mb-0" />
                  </span>
                )}
              </div>
            </li>
          )
        })}
      </ol>
    </section>
  )
}
