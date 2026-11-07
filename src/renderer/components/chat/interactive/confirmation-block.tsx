import type { ConfirmBlock } from '@actovia/shared/types/interactive'
import { composeConfirmAnswer } from '@actovia/shared/utils/interactive-answer'
import { Tick02Icon, Cancel01Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import ReactMarkdown, { type Components } from 'react-markdown'

import { RemoteImage } from '@/components/markdown/remote-image'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { remarkPluginsStable } from '@/lib/markdown-plugins'

import { answerLabels } from './answer-labels'
import type { BlockProps } from './questionnaire-block'

const detailsComponents: Components = {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- the hast node is not an attribute
  img: ({ node, src, ...rest }) => (
    <RemoteImage {...rest} src={typeof src === 'string' ? src : undefined} />
  )
}

export function ConfirmationBlock({
  block,
  runId,
  answered,
  canSubmit,
  submit
}: BlockProps<ConfirmBlock>) {
  const { t } = useTranslation('chat')
  const [note, setNote] = useState('')
  // Sent from here: once the chat holds the answer the buttons are gone, and
  // focus goes to the decision rather than to the page.
  const [sent, setSent] = useState(false)
  const outcome = useRef<HTMLParagraphElement>(null)
  const decision = answered?.head.decision ?? null
  const state = answered ? (decision ?? 'answered') : 'open'

  useEffect(() => {
    if (sent && answered) outcome.current?.focus()
  }, [sent, answered])

  const send = (approved: boolean) => {
    if (!canSubmit) return
    setSent(true)
    submit(composeConfirmAnswer(block, runId, approved, note, answerLabels(t)))
  }

  return (
    <div
      data-interactive="confirm"
      data-state={state}
      className="bg-card text-card-foreground rounded-2xl border p-4"
    >
      <p className="text-sm font-semibold text-pretty">{block.title}</p>
      {block.details && (
        <section className="markdown text-muted-foreground mt-1.5 text-sm">
          <ReactMarkdown
            remarkPlugins={remarkPluginsStable}
            components={detailsComponents}
          >
            {block.details}
          </ReactMarkdown>
        </section>
      )}
      {answered ? (
        <p
          ref={outcome}
          tabIndex={-1}
          className="mt-3 flex items-center gap-1.5 text-sm font-medium outline-none"
        >
          {decision === 'reject' ? (
            <HugeiconsIcon
              icon={Cancel01Icon}

              aria-hidden
              className="text-muted-foreground size-4"
            />
          ) : (
            <HugeiconsIcon
              icon={Tick02Icon}

              aria-hidden
              className="text-primary-ink size-4"
            />
          )}
          {decision === 'approve' && t('interactive.approved')}
          {decision === 'reject' && t('interactive.rejected')}
          {decision === null && t('interactive.answered')}
        </p>
      ) : (
        <>
          <label className="mt-3 flex flex-col gap-1.5">
            <span className="text-muted-foreground text-xs">
              {block.note || t('interactive.noteDefault')}
            </span>
            <Textarea
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder={t('interactive.notePlaceholder')}
              rows={2}
            />
          </label>
          <div className="mt-3 flex flex-wrap justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={!canSubmit}
              onClick={() => send(false)}
            >
              {block.reject || t('interactive.reject')}
            </Button>
            <Button
              type="button"
              disabled={!canSubmit}
              onClick={() => send(true)}
            >
              {block.approve || t('interactive.approve')}
            </Button>
          </div>
        </>
      )}
    </div>
  )
}
