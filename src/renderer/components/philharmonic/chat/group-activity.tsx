import { TEST_IDS } from '@actovia/shared/constants/test-ids'
import { Tick02Icon, Alert02Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { MessageSpinner } from '@/components/chat/message-spinner'
import {
  Trace,
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceLine,
  TraceTitle
} from '@/components/ui/trace'
import { toolLabel } from '@/lib/tool-label'
import { getGroupToolResults } from '@/services/philharmonic-chat'

import { AgentCardView } from './agent-card'
import { BubbleMarkdown } from './bubble-markdown'
import type { BubbleModel } from './group-message-bubble'

/** Activity stays behind one disclosure. The collapsed row still shows liveness. */
export function GroupActivity({
  bubble,
  agentsById = {}
}: {
  bubble: BubbleModel
  agentsById?: Record<string, { name: string }>
}) {
  const { t } = useTranslation('philharmonic')
  const [expanded, setOpen] = useState(false)
  const open = expanded || bubble.agentCard?.state === 'blocked'
  const live = bubble.toolCards ?? []
  const last = live.at(-1)
  const label = (card: NonNullable<BubbleModel['toolCards']>[number]) =>
    card.toolName === 'delegateTask'
      ? `${t('chat.roles.pm')} → ${agentsById[String(card.args?.employeeId)]?.name ?? t('chat.roles.employeeFallback')}`
      : toolLabel(card.toolName)
  return (
    <Trace className="my-2">
      <TraceCollapsible open={open} onOpenChange={setOpen}>
        <TraceCollapsibleTrigger
          data-testid={
            bubble.streaming
              ? TEST_IDS.philharmonic.liveThinkingToggle
              : TEST_IDS.philharmonic.activityToggle
          }
        >
          <TraceLine
            status={bubble.streaming ? 'running' : undefined}
            className="text-xs"
          >
            {bubble.streaming && (
              <span className="-mb-3">
                <MessageSpinner />
              </span>
            )}
            <TraceTitle>{t('chat.decision.thinking')}</TraceTitle>
            {bubble.streaming && last && (
              <span className="text-muted-foreground max-w-48 truncate">
                {label(last)}
              </span>
            )}
          </TraceLine>
        </TraceCollapsibleTrigger>
        <TraceCollapsibleContent className="space-y-3 text-sm">
          {open && (
            <>
              {bubble.thinking && <BubbleMarkdown text={bubble.thinking} />}
              {bubble.streaming && bubble.text && (
                <BubbleMarkdown text={bubble.text} />
              )}
              {bubble.agentCard && (
                <AgentCardView
                  card={bubble.agentCard}
                  messageId={bubble.messageId}
                  superseded={bubble.agentCardSuperseded ?? false}
                />
              )}
              {live.map((card, index) => {
                const result = card.result as
                  | { error?: unknown; command?: string; stdout?: string }
                  | undefined
                return (
                  <details key={card.toolCallId ?? index} className="text-xs">
                    <summary className="text-muted-foreground flex cursor-pointer items-center gap-2 py-1">
                      <HugeiconsIcon
                        icon={result?.error ? Alert02Icon : Tick02Icon}
                        className="size-3.5 shrink-0"
                      />
                      <span>{label(card)}</span>
                      {card.phase === 'start' && (
                        <span className="shimmer">
                          {t('chat.activity.running')}
                        </span>
                      )}
                    </summary>
                    <pre className="bg-code mt-1 max-h-64 overflow-auto rounded-lg p-3 font-mono text-xs whitespace-pre-wrap">
                      {JSON.stringify(card.args ?? {}, null, 2)}
                      {card.result
                        ? `\n${typeof card.result === 'string' ? card.result : JSON.stringify(card.result, null, 2)}`
                        : ''}
                    </pre>
                  </details>
                )
              })}
              {!bubble.streaming &&
                bubble.role === 'employee' &&
                !bubble.agentCard &&
                bubble.conversationId && (
                  <SavedActivity
                    conversationId={bubble.conversationId}
                    messageId={bubble.messageId}
                  />
                )}
            </>
          )}
        </TraceCollapsibleContent>
      </TraceCollapsible>
    </Trace>
  )
}

function SavedActivity({
  conversationId,
  messageId
}: {
  conversationId: string
  messageId: string
}) {
  const { t } = useTranslation('philharmonic')
  const history = useQuery({
    queryKey: ['group-activity', conversationId, messageId],
    queryFn: () => getGroupToolResults(conversationId),
    staleTime: 30_000
  })
  if (history.isPending) return <MessageSpinner />
  if (history.isError)
    return (
      <button
        type="button"
        onClick={() => void history.refetch()}
        className="text-xs underline"
      >
        {t('chat.activity.retry')}
      </button>
    )
  return history.data
    .filter((r) => r.messageId === messageId)
    .map((row) => (
      <details key={row.id} className="text-xs">
        <summary className="text-muted-foreground cursor-pointer py-1">
          {toolLabel(String(row.payload?.toolName ?? ''))}
        </summary>
        <pre className="bg-code mt-1 max-h-64 overflow-auto rounded-lg p-3 font-mono text-xs whitespace-pre-wrap">
          {String(row.payload?.result ?? '')}
        </pre>
      </details>
    ))
}
