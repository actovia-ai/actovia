import type { AgentCard } from '@exodus/shared/types/agents'
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
}

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

  if (isSystem) {
    return (
      <div className="flex justify-center py-2">
        <span className="bg-muted text-muted-foreground rounded-full px-3 py-0.5 text-xs">
          {bubble.text}
        </span>
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
    <span className="text-muted-foreground flex items-baseline gap-1.5 px-0.5 text-[11px]">
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
      className={cn('flex gap-2.5 px-1 py-1.5', isUser && 'flex-row-reverse')}
    >
      {isPm ? (
        <div className="bg-primary text-primary-foreground ring-accent flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold ring-[3px]">
          {t('philharmonic:chat.roles.pm')}
        </div>
      ) : isUser ? (
        <div className="bg-accent text-accent-foreground flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold">
          {t('state.you')}
        </div>
      ) : (
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
        {headerLine}
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
                'px-3.5 py-2.5 text-sm leading-relaxed',
                isUser
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-foreground'
              )}
              style={{
                borderRadius: isUser
                  ? '16px 6px 16px 16px'
                  : '6px 16px 16px 16px'
              }}
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

                    className="h-3.5 w-3.5 text-emerald-500"
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
