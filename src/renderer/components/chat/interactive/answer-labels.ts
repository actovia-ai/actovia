import type { AnswerLabels } from '@actovia/shared/utils/interactive-answer'
import type { TFunction } from 'i18next'

/** The words this client writes an answer with, in the user's language. */
export function answerLabels(t: TFunction<'chat'>): AnswerLabels {
  return {
    other: t('interactive.answer.other'),
    addition: t('interactive.answer.addition'),
    note: t('interactive.answer.note'),
    approved: t('interactive.approved'),
    rejected: t('interactive.rejected')
  }
}
