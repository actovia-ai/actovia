import { TEST_IDS } from '@exodus/shared/constants/test-ids'
import { TOOL_NAMES } from '@exodus/shared/constants/tool-names'
import {
  Tick02Icon,
  Clock01Icon,
  MultiplicationSignCircleIcon,
  StopIcon,
  Key01Icon
} from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { memo, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { StatusStrip } from '@/components/app/status-strip'
import { Button } from '@/components/ui/button'
import {
  type RunApproval,
  useDecideApproval,
  useRunApprovals
} from '@/hooks/use-approvals'
import { isTrustedActivation } from '@/lib/trusted-input'

const ICON = 'size-3.5 shrink-0'

/**
 * Allow once stays disabled this long after the card appears (as a browser's
 * permission prompt does), so a click already on its way — the user's, or one
 * staged in advance — cannot land on it the moment it shows.
 */
export const ALLOW_ENABLE_DELAY_MS = 600

/**
 * The summary, in full, in a scroll region — the card never CSS-truncates it
 * (`break-all` + `whitespace-pre-wrap`, no `truncate`): a client that clips
 * text can hide the part of a command that matters (see `approval.ts`'s
 * `sanitizeSummary`). A max height instead keeps a very long one from
 * pushing the rest of the transcript down; when the server itself cut the
 * text (`truncated`, past `EVENT_SUMMARY_MAX`), a note says how much.
 */
function ApprovalSummary({ approval }: { approval: RunApproval }) {
  const { t } = useTranslation('chat')
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <code className="bg-muted/60 text-2xs max-h-40 overflow-y-auto rounded-md px-2 py-1 font-mono break-all whitespace-pre-wrap">
        {approval.summary}
      </code>
      {approval.truncated ? (
        <p className="text-muted-foreground text-2xs">
          {t('approval.truncatedNote', { count: approval.hiddenChars ?? 0 })}
        </p>
      ) : null}
    </div>
  )
}

/**
 * The foot of a run whose tool call touched a secret outside Actovia (an SSH
 * key, cloud credentials, a `.env` elsewhere): what it wants to read, with
 * Allow once / Deny — at the foot rather than in the timeline, so it shows
 * even while the timeline is folded. Once settled, one quiet line says how.
 *
 * Subscribes to its own run's approvals only (`useRunApprovals` narrows with
 * `select`), and takes only strings and a boolean, so a streaming frame of
 * this or another run does not re-render it.
 *
 * `active` is whether the run still streams: a call still pending once it
 * does not was cut off by Stop (the server declines it; this client stopped
 * listening before it could say so).
 */
export const RunApprovals = memo(function RunApprovals({
  chatId,
  runId,
  active
}: {
  chatId: string
  runId: string
  active: boolean
}) {
  const approvals = useRunApprovals(chatId, runId)
  if (approvals.length === 0) return null
  return (
    <>
      {approvals.map((approval) => (
        <ApprovalCard
          key={approval.toolCallId}
          chatId={chatId}
          runId={runId}
          approval={approval}
          active={active}
        />
      ))}
    </>
  )
})

function ApprovalCard({
  chatId,
  runId,
  approval,
  active
}: {
  chatId: string
  runId: string
  approval: RunApproval
  active: boolean
}) {
  const { t } = useTranslation('chat')
  const decide = useDecideApproval(chatId)
  const [armed, setArmed] = useState(false)
  useEffect(() => {
    const timer = setTimeout(() => setArmed(true), ALLOW_ENABLE_DELAY_MS)
    return () => clearTimeout(timer)
  }, [])
  const state =
    approval.state === 'pending' && !active ? 'stopped' : approval.state
  const isCommand = approval.toolName === TOOL_NAMES.terminal

  if (state !== 'pending') {
    const settled = {
      allowed: {
        icon: <HugeiconsIcon icon={Tick02Icon} className={ICON} />,
        label: t('approval.allowed')
      },
      denied: {
        icon: (
          <HugeiconsIcon
            icon={MultiplicationSignCircleIcon}

            className={ICON}
          />
        ),
        label: t('approval.denied')
      },
      timed_out: {
        icon: <HugeiconsIcon icon={Clock01Icon} className={ICON} />,
        label: t('approval.timedOut')
      },
      stopped: {
        icon: <HugeiconsIcon icon={StopIcon} className={ICON} />,
        label: t('approval.stopped')
      },
      expired: {
        icon: <HugeiconsIcon icon={Clock01Icon} className={ICON} />,
        label: t('approval.expired')
      }
    }[state]
    return (
      <StatusStrip
        role="status"
        data-testid={TEST_IDS.chat.approval.state}
        data-state={state}
        icon={settled.icon}
      >
        <span className="shrink-0">{settled.label}</span>
        <ApprovalSummary approval={approval} />
      </StatusStrip>
    )
  }

  const answer = (decision: 'allow' | 'deny') =>
    decide.mutate({ runId, toolCallId: approval.toolCallId, decision })

  return (
    <StatusStrip
      role="group"
      aria-label={t('approval.title')}
      data-testid={TEST_IDS.chat.approval.card}
      icon={<HugeiconsIcon icon={Key01Icon} className={ICON} />}
      className="text-foreground"
      details={
        <div className="flex flex-col gap-2 pt-2 pl-5.5">
          <p className="text-muted-foreground">
            {isCommand ? t('approval.commandHint') : t('approval.fileHint')}
          </p>
          <ApprovalSummary approval={approval} />
          <div className="flex gap-2">
            <Button
              size="xs"
              data-testid={TEST_IDS.chat.approval.allow}
              disabled={decide.isPending || !armed}
              onClick={(event) => {
                // A script in the page (`el.click()`) never allows.
                if (!isTrustedActivation(event)) return
                answer('allow')
              }}
            >
              {t('approval.allow')}
            </Button>
            <Button
              size="xs"
              variant="outline"
              data-testid={TEST_IDS.chat.approval.deny}
              disabled={decide.isPending}
              onClick={() => answer('deny')}
            >
              {t('approval.deny')}
            </Button>
          </div>
        </div>
      }
    >
      <span className="font-medium">{t('approval.title')}</span>
    </StatusStrip>
  )
}
