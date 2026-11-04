import type { AgentCard } from '@actovia/shared/types/agents'
import type { GroupQuestionStatus } from '@actovia/shared/types/philharmonic'
import { HugeiconsIcon } from '@hugeicons/react'
import { memo, type ComponentProps } from 'react'
import { useTranslation } from 'react-i18next'

import { MusicConductor } from '@/components/icons/music-conductor'
import { useFormat } from '@/lib/format'
import { isMotionReduced } from '@/lib/reduced-motion'
import { cn } from '@/lib/utils'
import type { AgentData, TeamData } from '@/stores/philharmonic'

import { EmployeeAvatar } from '../employees/employee-avatar'
import { BubbleMarkdown } from './bubble-markdown'
import { DecisionProcess } from './decision-process'
import { GroupActivity } from './group-activity'
import { QuestionCard } from './question-card'

interface ArtifactPart {
  artifactId: string
  title: string
  code: string
}

export interface BubbleModel {
  conversationId?: string
  messageId: string
  // 'user' | 'pm' | 'employee' | 'system'
  role: string
  agentId?: string | null
  text: string
  thinking?: string
  streaming?: boolean
  createdAt?: string
  toolCards?: Array<{
    toolName: string
    toolCallId?: string
    args?: Record<string, unknown>
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
  /** The PM explicitly closed this round as a final response. */
  finalOutput?: boolean
  archives?: Array<{ title: string; path: string; directory: boolean }>
  /** A coding agent's run; shown in place of the text for employee messages. */
  agentCard?: AgentCard
  /** A newer step of the card's session follows it in the group. */
  agentCardSuperseded?: boolean
  /** The PM round this message closed; its decision process opens under it. */
  roundId?: string | null
  /** The round's counts, from the message's `{ kind: 'decision' }` part. */
  decision?: { delegations: number; waits: number }
  /** The PM's question to the owner (`{ kind: 'question' }`): drawn as a card. */
  question?: {
    questionId: string
    options: string[]
    status: GroupQuestionStatus
  }
}

const jumpToMessage = (id: string) =>
  document
    .querySelector(`[data-message-id="${CSS.escape(id)}"]`)
    ?.scrollIntoView({
      behavior: isMotionReduced() ? 'instant' : 'smooth',
      block: 'center'
    })

function GroupMessageBubbleView({
  bubble,
  agentsById,
  teamsById,
  continued = false
}: {
  bubble: BubbleModel
  agentsById: Record<string, AgentData>
  teamsById: Record<string, TeamData>
  continued?: boolean
}) {
  const { t } = useTranslation(['common', 'philharmonic'])
  const { dateTime } = useFormat()
  const user = bubble.role === 'user'
  const pm = bubble.role === 'pm'
  const agent = bubble.agentId ? agentsById[bubble.agentId] : undefined
  const team = agent?.teamId ? teamsById[agent.teamId] : undefined
  const name = pm
    ? t('philharmonic:chat.roles.pm')
    : (agent?.name ?? t('philharmonic:chat.roles.employeeFallback'))
  if (bubble.role === 'system')
    return (
      <div
        data-message-id={bubble.messageId}
        className="text-muted-foreground py-3 text-center text-xs"
      >
        {bubble.text}
      </div>
    )
  const time = bubble.createdAt
    ? dateTime(new Date(bubble.createdAt), {
        hour: 'numeric',
        minute: '2-digit'
      })
    : ''
  return (
    <article
      data-message-id={bubble.messageId}
      className={cn(
        'flex min-w-0 flex-col',
        continued ? 'pt-2 pb-1' : 'pt-6 pb-2',
        user && 'items-end'
      )}
    >
      {!user && !continued && (
        <div className="text-muted-foreground mb-2 flex items-center gap-2 text-xs">
          {pm ? (
            <span className="bg-primary/10 text-primary flex size-7 shrink-0 items-center justify-center rounded-full">
              <HugeiconsIcon icon={MusicConductor} className="size-4" />
            </span>
          ) : (
            <EmployeeAvatar
              seed={agent?.avatarSeed ?? null}
              style={agent?.avatarStyle ?? null}
              size={28}
            />
          )}
          <span className="text-foreground font-medium">{name}</span>
          {!pm && <span>{t('philharmonic:chat.activity.toPm')}</span>}
          {team && <span className="truncate">{team.name}</span>}
          {time && (
            <time className="ml-auto shrink-0 tabular-nums">{time}</time>
          )}
        </div>
      )}
      {bubble.attachments?.length ? (
        <div className="mb-2 flex max-w-full flex-wrap justify-end gap-2">
          {bubble.attachments
            .filter((a) => a.contentType.startsWith('image/'))
            .map((a, i) => (
              <a key={i} href={a.url} target="_blank" rel="noreferrer">
                <img
                  src={a.url}
                  alt={a.name}
                  className="max-h-56 max-w-full rounded-xl object-contain"
                />
              </a>
            ))}
        </div>
      ) : null}
      {bubble.streaming ? (
        <GroupActivity bubble={bubble} agentsById={agentsById} />
      ) : pm && bubble.question && bubble.conversationId ? (
        <QuestionCard
          conversationId={bubble.conversationId}
          text={bubble.text}
          question={bubble.question}
        />
      ) : (
        <>
          {bubble.text && (
            <div
              className={cn(
                'min-w-0 max-w-full wrap-break-word',
                user
                  ? 'bg-bubble text-foreground w-fit max-w-[85%] rounded-[20px] px-4 py-2.5'
                  : 'w-full text-foreground'
              )}
            >
              <BubbleMarkdown text={bubble.text} />
            </div>
          )}
          {pm && bubble.roundId && bubble.conversationId ? (
            <DecisionProcess
              conversationId={bubble.conversationId}
              roundId={bubble.roundId}
              bubbleText={bubble.text}
              counts={bubble.decision}
              agentOf={(id) => agentsById[id]}
              onJumpTo={jumpToMessage}
            />
          ) : (
            !user && <GroupActivity bubble={bubble} agentsById={agentsById} />
          )}
        </>
      )}
    </article>
  )
}

function sameArray<T>(
  left: T[] | undefined,
  right: T[] | undefined,
  equal: (a: T, b: T) => boolean
): boolean {
  return (
    left === right ||
    (left !== undefined &&
      right !== undefined &&
      left.length === right.length &&
      left.every((item, index) => equal(item, right[index])))
  )
}

function sameBubble(a: BubbleModel, b: BubbleModel): boolean {
  return (
    a.conversationId === b.conversationId &&
    a.messageId === b.messageId &&
    a.role === b.role &&
    a.agentId === b.agentId &&
    a.text === b.text &&
    a.thinking === b.thinking &&
    a.streaming === b.streaming &&
    a.createdAt === b.createdAt &&
    a.agentCard === b.agentCard &&
    a.agentCardSuperseded === b.agentCardSuperseded &&
    a.roundId === b.roundId &&
    a.archives === b.archives &&
    a.decision?.delegations === b.decision?.delegations &&
    a.decision?.waits === b.decision?.waits &&
    a.question?.questionId === b.question?.questionId &&
    a.question?.status === b.question?.status &&
    sameArray(a.question?.options, b.question?.options, (x, y) => x === y) &&
    sameArray(
      a.attachments,
      b.attachments,
      (x, y) =>
        x.name === y.name && x.url === y.url && x.contentType === y.contentType
    ) &&
    sameArray(
      a.artifacts,
      b.artifacts,
      (x, y) =>
        x.artifactId === y.artifactId &&
        x.title === y.title &&
        x.code === y.code
    ) &&
    sameArray(a.toolCards, b.toolCards, (x, y) => x === y)
  )
}

function sameProps(
  a: ComponentProps<typeof GroupMessageBubbleView>,
  b: ComponentProps<typeof GroupMessageBubbleView>
): boolean {
  return (
    sameBubble(a.bubble, b.bubble) &&
    a.agentsById === b.agentsById &&
    a.teamsById === b.teamsById &&
    a.continued === b.continued
  )
}

export const GroupMessageBubble = memo(GroupMessageBubbleView, sameProps)
