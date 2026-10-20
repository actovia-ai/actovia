import type { AskBlock, AskQuestion } from '@actovia/shared/types/interactive'
import {
  composeAskAnswer,
  type QuestionResponse
} from '@actovia/shared/utils/interactive-answer'
import { type FormEvent, type KeyboardEvent, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  Questionnaire,
  QuestionnaireActions,
  QuestionnaireChoice,
  QuestionnaireChoices,
  QuestionnaireError,
  QuestionnaireInput,
  QuestionnaireItem,
  QuestionnaireNext,
  QuestionnairePrevious,
  QuestionnaireSkip,
  QuestionnaireSubmit,
  QuestionnaireTitle
} from '@/components/ui/questionnaire'
import { Textarea } from '@/components/ui/textarea'

import { answerLabels } from './answer-labels'
import { AnsweredQuestionnaire } from './answered-questionnaire'
import type { Answered } from './interactive-context'

export interface BlockProps<B> {
  block: B
  /** The run whose reply holds the block: the answer's `ref`. */
  runId: string
  answered: Answered | null
  canSubmit: boolean
  submit: (text: string) => void
}

/** The value of a question's "Other…" choice. */
const OTHER = '__actovia_other__'

const CARD = 'bg-card text-card-foreground rounded-2xl border p-4'

const picksOther = (response: QuestionResponse | undefined) =>
  response !== undefined && response.other !== null

export function QuestionnaireBlock(props: BlockProps<AskBlock>) {
  // Sent from here: once the chat holds the answer the form is gone, and
  // focus goes to the summary that replaces it rather than to the page.
  const [sent, setSent] = useState(false)
  const { submit } = props
  return props.answered ? (
    <AnsweredQuestionnaire
      block={props.block}
      body={props.answered.body}
      takeFocus={sent}
    />
  ) : (
    <OpenQuestionnaire
      {...props}
      submit={(text) => {
        setSent(true)
        submit(text)
      }}
    />
  )
}

function OpenQuestionnaire({
  block,
  runId,
  canSubmit,
  submit
}: BlockProps<AskBlock>) {
  const { t } = useTranslation('chat')
  const [current, setCurrent] = useState(block.questions[0].id)
  const [responses, setResponses] = useState<Record<string, QuestionResponse>>(
    {}
  )
  const [note, setNote] = useState('')
  const index = Math.max(
    0,
    block.questions.findIndex((q) => q.id === current)
  )
  const onLast = index === block.questions.length - 1

  const respond = (
    question: AskQuestion,
    change: (response: QuestionResponse) => QuestionResponse
  ) =>
    setResponses((previous) => ({
      ...previous,
      [question.id]: change(
        previous[question.id] ?? { options: [], other: null }
      )
    }))

  const pick = (question: AskQuestion, value: string, checked: boolean) =>
    respond(question, (response) => {
      if (question.type === 'single') {
        if (!checked) return response
        return value === OTHER
          ? { options: [], other: response.other ?? '' }
          : { options: [value], other: null }
      }
      if (value === OTHER) {
        return { ...response, other: checked ? (response.other ?? '') : null }
      }
      return {
        ...response,
        options: checked
          ? [...response.options, value]
          : response.options.filter((o) => o !== value)
      }
    })

  // A skipped question is a blank: what was picked before Skip is dropped.
  const skip = (question: AskQuestion) =>
    setResponses((previous) => {
      const next = { ...previous }
      delete next[question.id]
      return next
    })

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!canSubmit) return
    submit(composeAskAnswer(block, runId, responses, note, answerLabels(t)))
  }

  // On the last question Enter submits (Cmd/Ctrl+Enter anywhere, Enter on a
  // choice): while nothing can be sent it does nothing, rather than a submit
  // that silently goes nowhere. Enter in the note is a new line still.
  const onKeyDown = (event: KeyboardEvent<HTMLFormElement>) => {
    if (canSubmit || !onLast || event.key !== 'Enter') return
    const modified = event.metaKey || event.ctrlKey
    if (modified || !(event.target instanceof HTMLTextAreaElement)) {
      event.preventDefault()
    }
  }

  return (
    <div data-interactive="ask" data-state="open" className={CARD}>
      <p className="text-sm font-semibold text-pretty">{block.title}</p>
      {block.questions.length > 1 && (
        <p
          aria-live="polite"
          className="text-muted-foreground text-2xs mt-1 font-medium tabular-nums"
        >
          {t('interactive.progress', {
            current: index + 1,
            total: block.questions.length
          })}
        </p>
      )}
      <Questionnaire
        item={current}
        onItemChange={setCurrent}
        onSubmit={onSubmit}
        onKeyDown={onKeyDown}
        className="mt-3"
      >
        {block.questions.map((question) => {
          const response = responses[question.id]
          return (
            <QuestionnaireItem
              key={question.id}
              name={question.id}
              multiple={question.type === 'multi'}
              onStatusChange={(status) => {
                if (status === 'skipped') skip(question)
              }}
            >
              <QuestionnaireTitle>{question.text}</QuestionnaireTitle>
              <QuestionnaireChoices>
                {question.options.map((option) => (
                  <QuestionnaireChoice
                    key={option}
                    value={option}
                    checked={response?.options.includes(option) ?? false}
                    onChange={(event) =>
                      pick(question, option, event.target.checked)
                    }
                  >
                    {option}
                  </QuestionnaireChoice>
                ))}
                {question.other && (
                  <QuestionnaireChoice
                    value={OTHER}
                    checked={picksOther(response)}
                    onChange={(event) =>
                      pick(question, OTHER, event.target.checked)
                    }
                  >
                    {t('interactive.other')}
                  </QuestionnaireChoice>
                )}
              </QuestionnaireChoices>
              {question.other && picksOther(response) && (
                <QuestionnaireInput
                  value={response?.other ?? ''}
                  onChange={(event) => {
                    const text = event.target.value
                    respond(question, (r) => ({ ...r, other: text }))
                  }}
                  placeholder={t('interactive.otherPlaceholder')}
                  aria-label={t('interactive.otherPlaceholder')}
                />
              )}
              <QuestionnaireError>
                {t('interactive.chooseOrSkip')}
              </QuestionnaireError>
            </QuestionnaireItem>
          )
        })}
        {onLast && (
          <label className="flex flex-col gap-1.5">
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
        )}
        <QuestionnaireActions>
          <QuestionnairePrevious>
            {t('interactive.previous')}
          </QuestionnairePrevious>
          {/* Skip on the last question submits: not while nothing can be sent. */}
          <QuestionnaireSkip disabled={onLast && !canSubmit}>
            {t('interactive.skip')}
          </QuestionnaireSkip>
          <QuestionnaireNext>{t('interactive.next')}</QuestionnaireNext>
          <QuestionnaireSubmit disabled={!canSubmit}>
            {block.submit || t('interactive.submit')}
          </QuestionnaireSubmit>
        </QuestionnaireActions>
      </Questionnaire>
    </div>
  )
}
