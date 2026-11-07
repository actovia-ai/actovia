import type { AnswerHead } from '@actovia/shared/utils/interactive-answer'
import {
  CheckmarkCircle01Icon,
  CancelCircleIcon,
  CheckListIcon
} from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useTranslation } from 'react-i18next'

/** The head of an answer's card: what it answered, by the block's title. */
export function AnswerTitle({ head }: { head: AnswerHead }) {
  const { t } = useTranslation('chat')
  const Icon =
    head.block === 'ask'
      ? CheckListIcon
      : head.decision === 'reject'
        ? CancelCircleIcon
        : CheckmarkCircle01Icon
  return (
    <p className="mb-1 flex items-start gap-1.5 text-sm font-medium">
      <HugeiconsIcon
        icon={Icon}

        aria-hidden
        className="text-primary-ink mt-0.5 size-4 shrink-0"
      />
      <span data-slot="answer-title" className="min-w-0">
        {head.title || t('interactive.answer.title')}
      </span>
    </p>
  )
}
