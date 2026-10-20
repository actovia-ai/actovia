import { TEST_IDS } from '@actovia/shared/constants/test-ids'
import {
  ComputerIcon,
  MultiplicationSignCircleIcon
} from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { sileo } from 'sileo'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { abortComputerUse, answerComputerUse } from '@/services/computer-use'

/**
 * The shape `ComputerUseCard` receives as `toolResult` — `messages-calling-tools`
 * unwraps `details` before passing it in. It is either a live `SessionUpdate`
 * frame streamed via `onUpdate` (`{ step, action?, thumbnail?, awaitingHuman?,
 * sessionId }`) or the terminal result (`{ sessionId, outcome, steps, summary }`).
 * Every field is optional so a half-populated frame renders without guards.
 */
interface ComputerUseDetails {
  step?: number
  action?: string
  thumbnail?: string
  awaitingHuman?: { question: string }
  outcome?: 'success' | 'failed' | 'aborted' | 'abandoned' | 'stuck'
  sessionId?: string
  steps?: number
  summary?: string
  error?: string
}

const OUTCOME_TONE: Record<string, string> = {
  success: 'text-green-500',
  failed: 'text-destructive',
  aborted: 'text-muted-foreground',
  abandoned: 'text-muted-foreground',
  stuck: 'text-yellow-600 dark:text-yellow-400'
}

export function ComputerUseCard({
  toolResult,
  isStreaming
}: {
  toolResult: ComputerUseDetails | null | undefined
  /**
   * Whether the run this call belongs to is still streaming. A call with no
   * `outcome`/`error` is "running" only while that holds — once the run has
   * ended (Stop, or the stream otherwise closing) with the call still
   * unresolved, pi-agent-core never delivers its terminal event (see
   * `image_generation`'s same rule in CLAUDE.md), so the card must say
   * "stopped" on its own rather than show "running…" forever.
   */
  isStreaming: boolean
}) {
  const { t } = useTranslation('chat')
  const details = toolResult ?? {}
  const [answer, setAnswer] = useState('')
  const pending = !details.outcome && !details.error
  const running = pending && isStreaming
  const stopped = pending && !isStreaming

  const stop = () => {
    abortComputerUse().catch(() => {
      sileo.error({
        title: t('computerUseCard.stopFailedTitle'),
        description: t('computerUseCard.stopFailedDescription')
      })
    })
  }

  const sendAnswer = () => {
    if (!details.sessionId) return
    answerComputerUse(details.sessionId, answer.trim() || '(done)').catch(
      () => {
        sileo.error({
          title: t('computerUseCard.answerFailedTitle'),
          description: t('computerUseCard.answerFailedDescription')
        })
      }
    )
    setAnswer('')
  }

  const headerRight = details.error
    ? t('computerUseCard.error')
    : details.outcome
      ? t(`computerUseCard.outcome.${details.outcome}`)
      : stopped
        ? t('approval.stopped')
        : typeof details.step === 'number'
          ? t('computerUseCard.stepBadge', { step: details.step })
          : t('computerUseCard.running')

  return (
    <div className="overflow-hidden rounded-lg border text-xs">
      {/* Header */}
      <div className="bg-muted/60 flex items-center gap-2 border-b px-3 py-2">
        <HugeiconsIcon
          icon={ComputerIcon}

          className="text-muted-foreground size-3.5 shrink-0"
        />
        <span className="text-foreground/80 flex-1 truncate font-medium">
          {t('computerUseCard.title')}
        </span>
        <span
          className={cn(
            'shrink-0',
            details.outcome
              ? (OUTCOME_TONE[details.outcome] ?? 'text-muted-foreground')
              : 'text-muted-foreground'
          )}
        >
          {headerRight}
        </span>
      </div>

      <div className="flex flex-col gap-2 px-3 py-2">
        {/* Current / last step + action */}
        {typeof details.step === 'number' && (
          <div className="text-foreground/90">
            {details.action
              ? t('computerUseCard.stepWithAction', {
                  step: details.step,
                  action: details.action
                })
              : t('computerUseCard.stepNoAction', { step: details.step })}
          </div>
        )}

        {/* Optional thumbnail of the target window */}
        {details.thumbnail && (
          <div className="bg-muted/40 max-h-40 w-fit overflow-hidden rounded border">
            <img
              src={`data:image/png;base64,${details.thumbnail}`}
              alt={t('computerUseCard.targetWindowAlt', {
                step: details.step ?? '?'
              })}
              className="max-h-40 w-auto object-contain"
            />
          </div>
        )}

        {/* Inline askHuman prompt — only while the session can still act on
            an answer; once the run has stopped, replying would do nothing. */}
        {details.awaitingHuman && running && (
          <div className="border-primary/30 bg-primary/5 flex flex-col gap-2 rounded-md border p-2">
            <p className="text-foreground/90">
              {details.awaitingHuman.question}
            </p>
            {details.sessionId ? (
              <div className="flex items-center gap-2">
                <Input
                  value={answer}
                  onChange={(e) => setAnswer(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') sendAnswer()
                  }}
                  placeholder={t('computerUseCard.replyPlaceholder')}
                  className="h-7 flex-1 text-xs"
                />
                <Button
                  size="xs"
                  variant="secondary"
                  data-testid={TEST_IDS.computerUse.continueButton}
                  onClick={sendAnswer}
                >
                  {t('computerUseCard.doneContinue')}
                </Button>
              </div>
            ) : (
              <p className="text-muted-foreground">
                {t('computerUseCard.waitingForReply')}
              </p>
            )}
          </div>
        )}

        {/* Stop control while the session is live */}
        {running && (
          <div>
            <Button
              size="xs"
              variant="destructive"
              data-testid={TEST_IDS.computerUse.stopButton}
              onClick={stop}
            >
              <HugeiconsIcon icon={MultiplicationSignCircleIcon} />
              {t('computerUseCard.stop')}
            </Button>
          </div>
        )}

        {/* Terminal summary */}
        {!running && (
          <>
            {details.summary && (
              <p className="text-foreground/90">{details.summary}</p>
            )}
            {details.error && (
              <p className="text-destructive">{details.error}</p>
            )}
            {details.sessionId && (
              <p className="text-muted-foreground/60 text-2xs">
                {t('computerUseCard.session', {
                  sessionId: details.sessionId
                })}
              </p>
            )}
          </>
        )}
      </div>
    </div>
  )
}
