import { TEST_IDS } from '@actovia/shared/constants/test-ids'
import { isSameDay, isToday, isYesterday } from 'date-fns'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { SidebarTrigger, useSidebar } from '@/components/ui/sidebar'
import { useIsFullscreen } from '@/hooks/use-is-full-screen'
import { i18n } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import {
  getConversationMessages,
  interruptConversation,
  respondToConversation,
  sendConversationMessage
} from '@/services/philharmonic-chat'
import type {
  AgentData,
  ConversationData,
  ConversationMessageData,
  TeamData
} from '@/stores/philharmonic'

import { EmployeeAvatar } from '../employees/employee-avatar'
import { PhilharmonicEmptyState } from '../empty-state'
import { Composer } from './composer'
import { GroupMessageBubble } from './group-message-bubble'
import { mergeGroupMessages, type BubbleWithDate } from './merge-group-messages'
import { NewGroupButton } from './new-group-button'
import { PlanCard } from './plan-card'

function formatDayLabel(d: Date): string {
  if (isToday(d)) return i18n.t('philharmonic:chat.dateLabels.today')
  if (isYesterday(d)) return i18n.t('philharmonic:chat.dateLabels.yesterday')
  return makeFormatters(
    i18n.resolvedLanguage ?? i18n.language ?? 'en'
  ).dateTime(d, { dateStyle: 'long' })
}

import {
  Alert02Icon,
  HelpCircleIcon,
  UserGroupIcon
} from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'

import type { ConversationStream } from '@/hooks/use-conversation-stream'
import { makeFormatters } from '@/lib/format'

export function GroupChat({
  conversation,
  agentsById,
  teamsById,
  members,
  stream,
  membersOpen,
  onToggleMembers,
  onCreateGroup
}: {
  conversation: ConversationData
  agentsById: Record<string, AgentData>
  teamsById: Record<string, TeamData>
  members: AgentData[]
  /** Aggregated SSE stream, hoisted from the container so the Members panel
   * sees the same busy state. */
  stream: ConversationStream
  membersOpen: boolean
  onToggleMembers: () => void
  onCreateGroup: () => void
}) {
  const { t } = useTranslation('philharmonic')
  const conversationId = conversation.id
  const { open: sidebarOpen } = useSidebar()
  const isFullscreen = useIsFullscreen()
  const [history, setHistory] = useState<ConversationMessageData[]>([])
  const { bubbles, askUser, error, revision, plan, pmRunning, agentCards } =
    stream
  const [answer, setAnswer] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)

  const load = useCallback(() => {
    getConversationMessages(conversationId).then(setHistory)
  }, [conversationId])

  useEffect(() => load(), [load])
  useEffect(() => load(), [revision, load]) // refetch on each message_end

  const merged: BubbleWithDate[] = useMemo(
    () => mergeGroupMessages({ conversationId, history, bubbles, agentCards }),
    [history, bubbles, conversationId, agentCards]
  )

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [merged.length, bubbles])

  const memberCount = conversation.memberAgentIds?.length ?? members.length
  const visibleMembers = members.slice(0, 3)
  const overflow = Math.max(0, memberCount - 3)
  const primaryTeam = visibleMembers[0]?.teamId
    ? (teamsById[visibleMembers[0].teamId]?.name ?? null)
    : null

  return (
    <div className="flex h-full flex-col">
      {/* Chat's bar (the content header of `chat-layout`): 44 px, no rule —
          the transcript fades into the bar's colour under it — and the sidebar
          toggle with New group only once the sidebar is away. */}
      <header
        className={cn(
          'draggable bg-card/80 relative z-10 flex h-11 shrink-0 items-center gap-1 rounded-tl-xl pt-0.5 pr-3 backdrop-blur-sm transition-[padding] duration-200 ease-out',
          'after:pointer-events-none after:absolute after:inset-x-0 after:top-full after:h-5 after:bg-linear-to-b after:from-card after:to-transparent',
          sidebarOpen ? 'pl-1' : isFullscreen ? 'pl-4' : 'pl-23'
        )}
      >
        {!sidebarOpen && (
          <>
            <SidebarTrigger className="no-drag text-muted-foreground hover:text-foreground shrink-0" />
            <NewGroupButton onCreate={onCreateGroup} />
          </>
        )}
        <div className="no-drag flex min-w-0 flex-1 items-center gap-3 pl-2">
          {visibleMembers.length > 0 ? (
            <div className="flex">
              {visibleMembers.map((m, i) => (
                <EmployeeAvatar
                  key={m.id}
                  seed={m.avatarSeed}
                  style={m.avatarStyle}
                  size={30}
                  className={cn(i > 0 && '-ml-2 ring-2 ring-card')}
                />
              ))}
              {overflow > 0 && (
                <span className="bg-muted text-muted-foreground ring-card text-2xs -ml-2 flex h-[30px] w-[30px] items-center justify-center rounded-full font-semibold ring-2">
                  +{overflow}
                </span>
              )}
            </div>
          ) : (
            <span className="text-base">{conversation.icon ?? '💬'}</span>
          )}
          <div className="min-w-0">
            {/* Renamed from the sidebar's menu, as a chat is. */}
            <h1 className="text-foreground truncate text-sm font-semibold tracking-tight">
              {conversation.title}
            </h1>
            <div className="text-muted-foreground text-2xs">
              {t('chat.groupChat.memberCount', { count: memberCount })}
              {primaryTeam ? ` · ${primaryTeam}` : ''}
            </div>
          </div>
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t('chat.groupChat.toggleMembersAria')}
          data-testid={TEST_IDS.philharmonic.membersToggle}
          onClick={onToggleMembers}
          className={cn(
            'no-drag text-muted-foreground hover:text-foreground shrink-0 rounded-full',
            membersOpen && 'bg-accent text-foreground'
          )}
        >
          <HugeiconsIcon icon={UserGroupIcon} />
        </Button>
      </header>

      {/* As Chat's: the composer floats over the transcript, which scrolls its
          full height behind it and fades into the pane's colour above it.
          The conversation takes the colour tone back from the neutral page
          around it, as Chat's does (globals.css, "Where the tone stops"). */}
      <div
        data-tone-scope="tone"
        className="relative flex min-h-0 flex-1 flex-col"
      >
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 pt-3 pb-36">
          {plan && plan.steps.length > 0 && (
            <div className="mx-auto max-w-2xl">
              <PlanCard plan={plan} agentsById={agentsById} />
            </div>
          )}
          {merged.length === 0 ? (
            <PhilharmonicEmptyState
              avatars={[{ hue: 'lilac' }, { hue: 'mint' }, { hue: 'peach' }]}
              title={t('chat.groupChat.emptyState.title')}
              description={t('chat.groupChat.emptyState.description')}
            />
          ) : (
            <div className="mx-auto flex max-w-2xl flex-col gap-1">
              {merged.map((b, i) => {
                const prev = i > 0 ? merged[i - 1] : null
                // Use null when createdAt is absent (e.g. live streaming bubble) so
                // the day divider is skipped rather than using an unstable new Date().
                const curDate = b.createdAt ? new Date(b.createdAt) : null
                const prevDate = prev?.createdAt
                  ? new Date(prev.createdAt)
                  : null
                const showDay =
                  curDate !== null &&
                  (!prevDate || !isSameDay(curDate, prevDate))
                return (
                  <div key={b.messageId}>
                    {showDay && curDate && (
                      <div className="my-3 flex items-center gap-3">
                        <div className="border-border/60 flex-1 border-t" />
                        <span className="text-muted-foreground text-2xs tracking-wider uppercase">
                          {formatDayLabel(curDate)}
                        </span>
                        <div className="border-border/60 flex-1 border-t" />
                      </div>
                    )}
                    <GroupMessageBubble
                      bubble={b}
                      agentsById={agentsById}
                      teamsById={teamsById}
                    />
                  </div>
                )
              })}
            </div>
          )}
          {error && (
            <div className="text-destructive bg-destructive/10 mx-auto mt-2 flex max-w-2xl items-center gap-2 rounded-lg px-3 py-2 text-xs">
              <HugeiconsIcon
                icon={Alert02Icon}

                className="h-3.5 w-3.5 shrink-0"
              />
              <span>{error}</span>
            </div>
          )}
          {askUser && (
            <div className="border-border bg-muted mx-auto my-3 max-w-2xl rounded-xl border p-3">
              <div className="text-foreground mb-2 flex items-start gap-2 text-sm">
                <HugeiconsIcon
                  icon={HelpCircleIcon}

                  className="text-primary-ink mt-0.5 h-4 w-4 shrink-0"
                />
                <span>{askUser.question}</span>
              </div>
              <div className="flex gap-2">
                <Input
                  value={answer}
                  onChange={(e) => setAnswer(e.target.value)}
                  placeholder={t('chat.groupChat.askUser.replyPlaceholder')}
                  autoFocus
                  className="border-border bg-card rounded-lg"
                />
                <Button
                  onClick={async () => {
                    if (!answer.trim()) return
                    await respondToConversation(conversationId, answer)
                    setAnswer('')
                  }}
                >
                  {t('chat.groupChat.askUser.sendButton')}
                </Button>
              </div>
            </div>
          )}
        </div>
        <div className="from-card pointer-events-none absolute inset-x-0 bottom-0 z-20 bg-linear-to-t to-transparent pt-8 pb-6 [&>*]:pointer-events-auto">
          <Composer
            conversationId={conversationId}
            onSend={(text, attachments) =>
              sendConversationMessage(conversationId, text, attachments)
            }
            busy={pmRunning}
            onStop={() => {
              interruptConversation(conversationId).catch(() => {})
            }}
          />
        </div>
      </div>
    </div>
  )
}
