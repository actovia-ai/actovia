import type { AgentCard } from '@actovia/shared/types/agents'
import {
  Tick02Icon,
  Loading03Icon,
  Wrench01Icon
} from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { format } from 'date-fns'
import { useTranslation } from 'react-i18next'

import { ArtifactCard } from '@/components/calling-tools/artifact/artifact-card'
import { cn } from '@/lib/utils'
import type { AgentData, TeamData } from '@/stores/philharmonic'

import { EmployeeAvatar } from '../employees/employee-avatar'
import { AgentCardView } from './agent-card'
import { BubbleMarkdown } from './bubble-markdown'
import { DecisionProcess } from './decision-process'

interface ArtifactPart {
  artifactId: string
  title: string
  code: string
}

export interface BubbleModel {
  conversationId?: string
  messageId: string
  role: string // 'user' | 'pm' | 'employee' | 'system'
  agentId?: string | null
  text: string
  createdAt?: string
  toolCards?: Array<{
    toolName: string
    phase: 'start' | 'end'
    result?: unknown
  }>
  /** Image attachments displayed alongside the message body (user bubbles). */
  attachments?: Array<{
    name: string
    url: string
    contentType: string
  }>
  /** P1-7: rendered ArtifactCard(s) for the PM's final deliverable. */
  artifacts?: ArtifactPart[]
  /** A coding agent's run; shown in place of the text for employee messages. */
  agentCard?: AgentCard
  /** A newer step of the card's session follows it in the group. */
  agentCardSuperseded?: boolean
  /** The PM round this message closed; its decision process opens under it. */
  roundId?: string | null
  /** The round's counts, from the message's `{ kind: 'decision' }` part. */
  decision?: { delegations: number; waits: number }
}

/** Scroll the transcript to a message (an employee's report the PM read). */
const jumpToMessage = (messageId: string) =>
  document
    .querySelector(`[data-message-id="${CSS.escape(messageId)}"]`)
    ?.scrollIntoView({ behavior: 'smooth', block: 'center' })

export function GroupMessageBubble({
  bubble,
  agentsById,
  teamsById
}: {
  bubble: BubbleModel
  agentsById: Record<string, AgentData>
  teamsById: Record<string, TeamData>
}) {
  const { t } = useTranslation(['common', 'philharmonic'])
  const isUser = bubble.role === 'user'
  const isSystem = bubble.role === 'system'
  const isPm = bubble.role === 'pm'
  const agent = bubble.agentId ? agentsById[bubble.agentId] : undefined
  const team = agent?.teamId ? teamsById[agent.teamId] : undefined
  const name = isUser
    ? t('state.you')
    : isPm
      ? t('philharmonic:chat.roles.pm')
      : (agent?.name ?? t('philharmonic:chat.roles.employeeFallback'))

  const decisionProcess = bubble.roundId && bubble.conversationId && (
    <DecisionProcess
      conversationId={bubble.conversationId}
      roundId={bubble.roundId}
      bubbleText={bubble.text}
      counts={bubble.decision}
      agentOf={(id) => agentsById[id]}
      onJumpTo={jumpToMessage}
    />
  )

  if (isSystem) {
    return (
      <div
        data-message-id={bubble.messageId}
        className="flex flex-col items-center gap-1 py-2"
      >
        <span className="bg-muted text-muted-foreground rounded-full px-3 py-0.5 text-xs">
          {bubble.text}
        </span>
        {decisionProcess}
      </div>
    )
  }

  const time = bubble.createdAt
    ? (() => {
        try {
          return format(new Date(bubble.createdAt), 'HH:mm')
        } catch {
          return ''
        }
      })()
    : ''

  const headerLine = (
    <span className="text-muted-foreground text-2xs flex items-baseline gap-1.5 px-0.5">
      <span className="text-foreground font-medium">{name}</span>
      {team && (
        <span className="text-muted-foreground">
          · {team.icon ? `${team.icon} ` : ''}
          {team.name}
        </span>
      )}
      {time && <span>· {time}</span>}
    </span>
  )

  return (
    <div
      data-message-id={bubble.messageId}
      className={cn('flex gap-2.5 px-1 py-1.5', isUser && 'flex-row-reverse')}
    >
      {isPm ? (
        <div className="bg-primary text-primary-foreground ring-accent flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold ring-[3px]">
          {t('philharmonic:chat.roles.pm')}
        </div>
      ) : isUser ? null : (
        <EmployeeAvatar
          seed={agent?.avatarSeed ?? null}
          style={agent?.avatarStyle ?? null}
          size={36}
        />
      )}
      <div
        className={cn(
          'flex min-w-0 max-w-[78%] flex-col gap-1',
          isUser && 'items-end'
        )}
      >
        {/* Your own message is the bubble alone, as in Chat. */}
        {!isUser && headerLine}
        {bubble.attachments && bubble.attachments.length > 0 && (
          <div
            className={cn(
              'flex flex-wrap gap-2',
              isUser ? 'justify-end' : 'justify-start'
            )}
          >
            {bubble.attachments.flatMap((a, i) =>
              a.contentType.startsWith('image/')
                ? [
                    <a
                      key={`${a.url}-${i}`}
                      href={a.url}
                      target="_blank"
                      rel="noreferrer"
                      className="block"
                    >
                      <img
                        src={a.url}
                        alt={a.name}
                        className="bg-muted max-h-48 max-w-[12rem] rounded-lg object-cover"
                      />
                    </a>
                  ]
                : []
            )}
          </div>
        )}
        {bubble.role === 'employee' && bubble.agentCard ? (
          <AgentCardView
            card={bubble.agentCard}
            messageId={bubble.messageId}
            superseded={bubble.agentCardSuperseded ?? false}
          />
        ) : (
          bubble.text.length > 0 && (
            <div
              className={cn(
                'text-foreground px-4 py-2.5 text-sm leading-relaxed wrap-break-word',
                // The user's message is Chat's bubble (`--bubble`, the tone
                // far toward the page); the group's voices stay on muted.
                isUser
                  ? 'bg-bubble rounded-2xl rounded-br-sm'
                  : 'bg-muted rounded-2xl rounded-tl-sm'
              )}
            >
              <BubbleMarkdown text={bubble.text} />
            </div>
          )
        )}
        {bubble.artifacts &&
          bubble.artifacts.length > 0 &&
          bubble.conversationId && (
            <div className="flex flex-col gap-2">
              {bubble.artifacts.map((a) => (
                <ArtifactCard
                  key={a.artifactId}
                  chatId={bubble.conversationId!}
                  toolResult={{
                    type: 'artifact',
                    title: a.title,
                    code: a.code,
                    artifactId: a.artifactId
                  }}
                />
              ))}
            </div>
          )}
        {isPm && decisionProcess}
        {bubble.toolCards && bubble.toolCards.length > 0 && (
          <div className="flex flex-col gap-1.5">
            {bubble.toolCards.map((card) => (
              <div
                key={`${card.toolName}-${card.phase}`}
                className="border-border bg-card flex items-center gap-2.5 border px-3 py-2"
                style={{
                  borderRadius: '6px 14px 14px 14px'
                }}
              >
                <div className="bg-accent text-accent-foreground flex h-6 w-6 items-center justify-center rounded-md">
                  <HugeiconsIcon
                    icon={Wrench01Icon}

                    className="h-3.5 w-3.5"
                  />
                </div>
                <div className="text-foreground min-w-0 flex-1 text-xs font-semibold">
                  {card.toolName}
                </div>
                {card.phase === 'start' ? (
                  <HugeiconsIcon
                    icon={Loading03Icon}

                    className="text-muted-foreground h-3.5 w-3.5 animate-spin"
                  />
                ) : (
                  <HugeiconsIcon
                    icon={Tick02Icon}

                    className="text-muted-foreground h-3.5 w-3.5"
                  />
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
