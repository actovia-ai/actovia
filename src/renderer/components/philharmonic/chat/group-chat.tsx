import { TEST_IDS } from '@actovia/shared/constants/test-ids'
import { isSameDay, isToday, isYesterday } from 'date-fns'
import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { HeaderSidebarTrigger } from '@/components/app/update-ready'
import { MessageSpinner } from '@/components/chat/message-spinner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useSidebar } from '@/components/ui/sidebar'
import { useIsFullscreen } from '@/hooks/use-is-full-screen'
import { i18n } from '@/lib/i18n'
import { ROW_ENTER } from '@/lib/motion'
import { cn } from '@/lib/utils'
import {
  interruptConversation,
  respondToConversation,
  sendConversationMessage
} from '@/services/philharmonic-chat'
import type {
  AgentData,
  ConversationData,
  TeamData
} from '@/stores/philharmonic'

import { EmployeeAvatar } from '../employees/employee-avatar'
import { PhilharmonicEmptyState } from '../empty-state'
import { hueStyle, pickHue } from '../lib/hue'
import { Composer } from './composer'
import { GroupContextRing } from './group-context-ring'
import { useGroupHistory } from './group-history'
import { GroupMessageBubble } from './group-message-bubble'
import type { GroupPanelSection } from './group-resources-panel'
import { GroupResourcesPanel } from './group-resources-panel'
import { mergeGroupMessages, type BubbleWithDate } from './merge-group-messages'
import { NewGroupButton } from './new-group-button'
import { PlanCard } from './plan-card'

/**
 * A message that follows one from the same voice goes under it without the
 * avatar and the name again, as Grok's (and every messenger's) do.
 */
function continuesFrom(
  prev: BubbleWithDate | null,
  b: BubbleWithDate
): boolean {
  if (!prev || prev.role === 'system' || b.role === 'system') return false
  if (prev.role !== b.role) return false
  return b.role !== 'employee' || prev.agentId === b.agentId
}

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
  panelOpen,
  onOpenPanel,
  onClosePanel,
  onCreateGroup
}: {
  conversation: ConversationData
  agentsById: Record<string, AgentData>
  teamsById: Record<string, TeamData>
  members: AgentData[]
  /** Aggregated SSE stream, hoisted from the container so the Monitor sees
   * the same busy state. */
  stream: ConversationStream
  panelOpen: boolean
  onOpenPanel: () => void
  onClosePanel: () => void
  onCreateGroup: () => void
}) {
  const { t } = useTranslation('philharmonic')
  const conversationId = conversation.id
  const { open: sidebarOpen } = useSidebar()
  const isFullscreen = useIsFullscreen()
  const {
    bubbles,
    askUser,
    error,
    revision,
    plan,
    pmRunning,
    agentCards,
    questionStatus
  } = stream
  const [answer, setAnswer] = useState('')
  const [sending, setSending] = useState(false)
  const [panelSection, setPanelSection] = useState<GroupPanelSection>('monitor')
  const scrollRef = useRef<HTMLDivElement>(null)
  const followTranscriptRef = useRef(true)

  const history = useGroupHistory(conversationId, revision)

  const merged: BubbleWithDate[] = useMemo(
    () =>
      mergeGroupMessages({
        conversationId,
        history,
        bubbles,
        agentCards,
        questionStatus
      }),
    [history, bubbles, conversationId, agentCards, questionStatus]
  )

  useLayoutEffect(() => {
    followTranscriptRef.current = true
    setPanelSection('monitor')
  }, [conversationId])

  const openPanel = (section: GroupPanelSection) => {
    if (panelOpen && panelSection === section) {
      onClosePanel()
      return
    }
    setPanelSection(section)
    onOpenPanel()
  }

  useLayoutEffect(() => {
    const element = scrollRef.current
    if (element && followTranscriptRef.current)
      element.scrollTop = element.scrollHeight
  }, [merged])

  const memberCount = conversation.memberAgentIds?.length ?? members.length
  const visibleMembers = members.slice(0, 3)
  const primaryTeam = visibleMembers[0]?.teamId
    ? (teamsById[visibleMembers[0].teamId]?.name ?? null)
    : null

  return (
    <div className="flex h-full min-w-0">
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Chat's bar (the content header of `chat-layout`): 44 px, no rule —
          the transcript fades into the bar's colour under it — and the sidebar
          toggle with New group only once the sidebar is away. */}
        <header
          className={cn(
            'draggable bg-card/80 relative z-10 flex h-11 shrink-0 items-center gap-1 pt-0.5 pr-3 backdrop-blur-sm transition-[padding] duration-200 ease-out',
            'after:pointer-events-none after:absolute after:inset-x-0 after:top-full after:h-5 after:bg-linear-to-b after:from-card after:to-transparent',
            sidebarOpen ? 'pl-1' : isFullscreen ? 'pl-4' : 'pl-23'
          )}
        >
          {!sidebarOpen && (
            <>
              <HeaderSidebarTrigger />
              <NewGroupButton onCreate={onCreateGroup} />
            </>
          )}
          {/* Grok's bar (ISSUE-272): the group's avatar and its name, nothing
            under it; who is in it is the button at the right end. */}
          <div className="flex min-w-0 flex-1 items-center gap-2 pl-2">
            <span
              className="flex size-6 shrink-0 items-center justify-center rounded-full text-xs"
              style={hueStyle(pickHue(conversation.id))}
            >
              {conversation.icon ?? '💬'}
            </span>
            {/* Renamed from the sidebar's menu, as a chat is. */}
            <h1 className="text-foreground truncate text-sm font-medium">
              {conversation.title}
            </h1>
          </div>
          <GroupContextRing
            conversationId={conversationId}
            revision={revision}
            onOpenPanel={openPanel}
          />
          <Button
            variant="ghost"
            size="sm"
            aria-label={t('chat.groupChat.toggleMembersAria')}
            title={
              t('chat.groupChat.memberCount', { count: memberCount }) +
              (primaryTeam ? ` · ${primaryTeam}` : '')
            }
            data-testid={TEST_IDS.philharmonic.membersToggle}
            onClick={() => openPanel('monitor')}
            className={cn(
              'no-drag text-muted-foreground hover:text-foreground h-8 shrink-0 gap-1.5 rounded-full px-1.5',
              panelOpen &&
                panelSection === 'monitor' &&
                'bg-accent text-foreground'
            )}
          >
            {visibleMembers.length > 0 ? (
              <span className="flex">
                {visibleMembers.map((m, i) => (
                  <EmployeeAvatar
                    key={m.id}
                    seed={m.avatarSeed}
                    style={m.avatarStyle}
                    size={22}
                    className={cn(i > 0 && 'ring-card -ml-1.5 ring-2')}
                  />
                ))}
              </span>
            ) : (
              <HugeiconsIcon icon={UserGroupIcon} />
            )}
            <span className="text-xs tabular-nums">{memberCount}</span>
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
          {plan && plan.steps.length > 0 && (
            <div className="absolute inset-x-0 top-0 z-20 px-4 pt-2">
              <div className="mx-auto w-full max-w-3xl">
                <PlanCard plan={plan} agentsById={agentsById} />
              </div>
            </div>
          )}
          <div
            ref={scrollRef}
            onScroll={(event) => {
              const element = event.currentTarget
              followTranscriptRef.current =
                element.scrollHeight -
                  element.clientHeight -
                  element.scrollTop <
                96
            }}
            className={cn(
              'flex-1 overflow-y-auto px-4 pb-40 [overflow-anchor:none]',
              plan?.steps.length ? 'pt-16' : 'pt-3'
            )}
          >
            {merged.length === 0 ? (
              <PhilharmonicEmptyState
                title={t('chat.groupChat.emptyState.title')}
                description={t('chat.groupChat.emptyState.description')}
              />
            ) : (
              <div className="mx-auto flex max-w-3xl flex-col">
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
                    <div
                      key={b.messageId}
                      className={b.streaming ? ROW_ENTER : undefined}
                    >
                      {showDay && curDate && (
                        <div className="text-muted-foreground my-4 text-center text-xs font-medium">
                          {formatDayLabel(curDate)}
                        </div>
                      )}
                      <GroupMessageBubble
                        bubble={b}
                        continued={!showDay && continuesFrom(prev, b)}
                        agentsById={agentsById}
                        teamsById={teamsById}
                      />
                    </div>
                  )
                })}
              </div>
            )}
            {(sending || pmRunning) &&
              !merged.some(
                (bubble) => bubble.role === 'pm' && bubble.streaming
              ) && (
                <div
                  className="mx-auto mt-5 max-w-3xl"
                  role="status"
                  aria-label={t('chat.decision.thinking')}
                >
                  <MessageSpinner />
                </div>
              )}
            {error && (
              <div className="text-destructive bg-destructive/10 mx-auto mt-2 flex max-w-3xl items-center gap-2 rounded-lg px-3 py-2 text-xs">
                <HugeiconsIcon
                  icon={Alert02Icon}

                  className="h-3.5 w-3.5 shrink-0"
                />
                <span>{error}</span>
              </div>
            )}
            {/* Only a question the server could not save: a saved one is a
              card in the transcript (question-card.tsx). */}
            {askUser && (
              <div className="border-border bg-muted mx-auto my-3 max-w-3xl rounded-xl border p-3">
                <div className="text-foreground mb-2 flex items-start gap-2 text-sm">
                  <HugeiconsIcon
                    icon={HelpCircleIcon}

                    className="text-primary mt-0.5 h-4 w-4 shrink-0"
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
                      await respondToConversation(
                        conversationId,
                        answer,
                        askUser.questionId
                      )
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
              groupTitle={conversation.title}
              onSend={async (text, attachments) => {
                setSending(true)
                try {
                  await sendConversationMessage(
                    conversationId,
                    text,
                    attachments
                  )
                } finally {
                  setSending(false)
                }
              }}
              busy={pmRunning}
              onStop={() => {
                interruptConversation(conversationId).catch(() => {})
              }}
            />
          </div>
        </div>
      </div>
      <GroupResourcesPanel
        key={conversationId}
        conversationId={conversationId}
        open={panelOpen}
        section={panelSection}
        onSectionChange={setPanelSection}
        onClose={onClosePanel}
        bubbles={merged}
        revision={revision}
        members={members}
        teamsById={teamsById}
        busyAgents={stream.busyAgents}
      />
    </div>
  )
}
