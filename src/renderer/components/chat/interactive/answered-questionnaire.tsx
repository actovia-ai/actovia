import type { AskBlock } from '@actovia/shared/types/interactive'
import {
  BLANK_ANSWER,
  readPicks
} from '@actovia/shared/utils/interactive-answer'
import { Tick02Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'

import { StaticChoice } from '@/components/chat/interactive/static-choice'
import { cn } from '@/lib/utils'

const CARD = 'bg-card text-card-foreground rounded-2xl border p-4'

export function AnsweredQuestionnaire({
  block,
  body,
  takeFocus
}: {
  block: AskBlock
  body: string
  /** Just answered from this block: the summary takes the form's focus. */
  takeFocus: boolean
}) {
  const { t } = useTranslation('chat')
  const picks = readPicks(block, body)
  const summary = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (takeFocus) summary.current?.focus()
  }, [takeFocus])
  // What a screen reader names the frozen block by: its title, that it is
  // answered, then each question and what was picked.
  const answers = block.questions.map((question) => {
    const pick = picks[question.id]
    const chosen = [
      ...(pick?.options ?? []),
      ...(question.other && pick?.other ? [t('interactive.other')] : [])
    ]
    const answer = chosen.length > 0 ? chosen.join(', ') : BLANK_ANSWER
    return `${question.text} ${answer}`
  })
  const label = `${block.title} — ${t('interactive.answered')}. ${answers.join('; ')}`
  return (
    <div
      ref={summary}
      role="group"
      aria-label={label}
      tabIndex={-1}
      data-interactive="ask"
      data-state="answered"
      className={cn(CARD, 'outline-none')}
    >
      <p className="text-sm font-semibold text-pretty">{block.title}</p>
      {/*
        The questionnaire as it was asked, every question at once with what
        was picked checked, taking no input: as on the phone, rather than a
        summary in a shape of its own (owner, 2026-10-08). Plain blocks, not
        lists: the answer's Markdown numbers and indents every list it holds.
      */}
      <div className="mt-3 flex flex-col gap-4">
        {block.questions.map((question, i) => {
          const pick = picks[question.id]
          const type = question.type === 'multi' ? 'checkbox' : 'radio'
          return (
            <div key={question.id} role="group" aria-label={question.text}>
              <p className="mb-3 text-sm font-semibold text-pretty">
                {block.questions.length > 1
                  ? `${i + 1}. ${question.text}`
                  : question.text}
              </p>
              <div className="grid min-w-0 gap-1.5">
                {question.options.map((option) => (
                  <StaticChoice
                    key={option}
                    type={type}
                    checked={pick?.options.includes(option) ?? false}
                  >
                    {option}
                  </StaticChoice>
                ))}
                {question.other && (
                  <StaticChoice type={type} checked={pick?.other ?? false}>
                    {t('interactive.other')}
                  </StaticChoice>
                )}
              </div>
            </div>
          )
        })}
      </div>
      <p className="text-muted-foreground mt-3! mb-0! flex items-center gap-1.5 text-xs">
        <HugeiconsIcon
          icon={Tick02Icon}

          aria-hidden
          className="size-3.5"
        />
        {t('interactive.answered')}
      </p>
    </div>
  )
}
