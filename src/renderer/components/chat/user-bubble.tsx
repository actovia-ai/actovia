import { splitHealth } from '@exodus/shared/utils/health-context'
import { splitAnswer } from '@exodus/shared/utils/interactive-answer'
import { splitQuoted } from '@exodus/shared/utils/quoted-text'
import { memo, useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ErrorBoundary } from '@/components/app/card-error-boundary'
import { HealthContextCard } from '@/components/chat/health/health-context-card'
import { AnswerTitle } from '@/components/chat/interactive/answer-title'
import Markdown from '@/components/markdown/markdown'
import { cn } from '@/lib/utils'

/** The bubble's line: `text-base` (1rem) at `leading-relaxed` (1.625). */
const LINE_REM = 1 * 1.625
/** A message taller than this many lines is shown clipped to them. */
const CAP_LINES = 10
const CAP_REM = LINE_REM * CAP_LINES

/**
 * Whether content `height` px tall is clipped by a cap of `cap` px. A pixel of
 * slack: subpixel layout can put a message of exactly the cap a fraction over.
 */
export function collapses(height: number, cap: number): boolean {
  return height - cap > 1
}

function capPx(): number {
  const root = parseFloat(getComputedStyle(document.documentElement).fontSize)
  return CAP_REM * (Number.isFinite(root) && root > 0 ? root : 16)
}

/**
 * What the user said, as Markdown — pasted headings, lists and code read as
 * they were meant; prose looks as it always did (its soft line breaks kept,
 * at the bubble's size and leading). A message that was asked about a
 * selection opens with it as a markdown quote (`composeQuoted`): drawn as the
 * quote it is, small and to the side of a rule, over the question. One asked
 * from the phone's Health workspace opens with the numbers it was about
 * (`splitHealth`), before any quote: drawn as a card of chips. One that
 * answers a questionnaire or a confirmation opens with its answer fence
 * (`splitAnswer`): drawn as a card — the block's title, then the answers,
 * quieter.
 *
 * A long message is clipped to `CAP_LINES` lines under a fade, with "Show
 * more" below it; opened, it stays open. Whether it is long is measured — the
 * content's height against the cap — never guessed from its length.
 * `data-askable`: text in here can be asked about in turn (`SelectionAsk`).
 */
export const UserBubble = memo(function UserBubble({ text }: { text: string }) {
  const { t } = useTranslation('chat')
  const { answer, body: answered } = splitAnswer(text)
  const health = splitHealth(answered)
  const { quote, body } = splitQuoted(health.body)

  const contentRef = useRef<HTMLDivElement>(null)
  const [tall, setTall] = useState(false)
  const [expanded, setExpanded] = useState(false)

  useLayoutEffect(() => {
    const el = contentRef.current
    if (!el || expanded) return
    const measure = () => setTall(collapses(el.scrollHeight, capPx()))
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    // The content's own box stops at the cap; what grows is inside it.
    for (const child of Array.from(el.children)) observer.observe(child)
    return () => observer.disconnect()
  }, [expanded, text])

  const clipped = tall && !expanded

  return (
    <div
      data-askable=""
      data-answer={answer?.block}
      className="bg-bubble text-foreground max-w-[75%] rounded-2xl rounded-br-sm px-4 py-2.5 text-base leading-relaxed wrap-break-word"
    >
      <div
        ref={contentRef}
        data-clipped={clipped ? '' : undefined}
        style={expanded ? undefined : { maxHeight: `${CAP_REM}rem` }}
        className={cn('relative', !expanded && 'overflow-hidden')}
      >
        {answer !== null && <AnswerTitle head={answer} />}
        {health.json !== null && <HealthContextCard json={health.json} />}
        {quote !== null && (
          <blockquote
            title={quote}
            className="border-primary-ink/40 text-muted-foreground line-clamp-3 border-l-2 pl-2.5 text-sm leading-normal whitespace-pre-wrap not-last:mb-1.5"
          >
            {quote}
          </blockquote>
        )}
        {/* Inline code's chip is `muted`, which neutral's bubble already is. */}
        {body !== '' && (
          <div
            className={cn(
              '[&_.markdown_:not(pre)>code]:bg-foreground/7 [&_.markdown]:leading-relaxed [&_.markdown_p]:whitespace-pre-wrap',
              // An answer's lines are quieter than its title.
              answer !== null && 'text-muted-foreground text-sm'
            )}
          >
            <ErrorBoundary
              scope="markdown"
              fallback={<p className="whitespace-pre-wrap">{body}</p>}
            >
              <Markdown src={body} />
            </ErrorBoundary>
          </div>
        )}
        {clipped && (
          <div
            aria-hidden
            className="from-bubble pointer-events-none absolute inset-x-0 bottom-0 h-12 bg-linear-to-t to-transparent"
          />
        )}
      </div>
      {clipped && (
        <button
          type="button"
          aria-expanded={false}
          onClick={() => setExpanded(true)}
          className="text-muted-foreground hover:text-foreground focus-visible:ring-ring mt-1 rounded-sm text-sm font-medium transition-colors outline-none focus-visible:ring-2"
        >
          {t('messageList.showMore')}
        </button>
      )}
    </div>
  )
})
