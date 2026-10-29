import { TEST_IDS } from '@actovia/shared/constants/test-ids'
import { MessageAdd01Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useState
} from 'react'
import { useTranslation } from 'react-i18next'

import { SheetPanel } from '@/components/app/sheet-panel'
import {
  ConfigPage,
  ConversationList
} from '@/components/philharmonic/chat/conversation-list'
import { GroupChat } from '@/components/philharmonic/chat/group-chat'
import { GroupMembersPanel } from '@/components/philharmonic/chat/group-members-panel'
import { WorkforcePage } from '@/components/philharmonic/workforce/workforce-page'
import { Button } from '@/components/ui/button'
import { SidebarInset } from '@/components/ui/sidebar'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { toast } from '@/components/ui/toast'
import { useConversationStream } from '@/hooks/use-conversation-stream'
import type { PhilharmonicPage } from '@/layouts/philharmonic-layout'
import {
  PhilharmonicHeaderSlot,
  PhilharmonicSlottedHeader
} from '@/layouts/philharmonic-layout/philharmonic-content-header'
import { ResizableSidebarShell } from '@/layouts/shared/resizable-sidebar'
import { getAgents, getTeams } from '@/services/philharmonic'
import {
  createConversation,
  deleteConversation,
  getConversations,
  updateConversation
} from '@/services/philharmonic-chat'
import type {
  AgentData,
  ConversationData,
  TeamData
} from '@/stores/philharmonic'

const ScheduleTab = lazy(() =>
  import('@/components/philharmonic/schedule/schedule-tab').then((m) => ({
    default: m.ScheduleTab
  }))
)

export function PhilharmonicContainer({
  activePage,
  groupId,
  onOpenPage,
  onOpenGroup
}: {
  activePage: PhilharmonicPage
  /** The group the path names; on a bare `/philharmonic`, the first group shows. */
  groupId: string | null
  onOpenPage: (p: Exclude<PhilharmonicPage, 'chat'>) => void
  onOpenGroup: (id: string | null, options?: { replace?: boolean }) => void
}) {
  const { t } = useTranslation('philharmonic')
  const [conversations, setConversations] = useState<ConversationData[]>([])
  const [employees, setEmployees] = useState<AgentData[]>([])
  const [teams, setTeams] = useState<TeamData[]>([])
  const [membersOpen, setMembersOpen] = useState(false)

  useEffect(() => {
    getConversations().then((cs) => {
      setConversations(cs)
    })
    getAgents().then(setEmployees)
    getTeams().then(setTeams)
  }, [])

  const agentsById = useMemo(
    () => Object.fromEntries(employees.map((e) => [e.id, e])),
    [employees]
  )
  const teamsById = useMemo(
    () => Object.fromEntries(teams.map((t) => [t.id, t])),
    [teams]
  )

  // The group on screen: the one the path names, else the first (a bare
  // `/philharmonic` is not redirected, so it never enters the history twice).
  const activeId = groupId ?? conversations[0]?.id ?? null

  const handleCreate = useCallback(async () => {
    const conv = await createConversation({
      title: t('container.newGroupDefaultTitle')
    })
    setConversations((p) => [{ ...conv, latestMessage: null }, ...p])
    onOpenGroup(conv.id)
  }, [onOpenGroup, t])

  const handleSelect = useCallback(
    (id: string) => {
      onOpenGroup(id)
    },
    [onOpenGroup]
  )

  const handleDelete = useCallback(
    async (id: string) => {
      try {
        await deleteConversation(id)
        setConversations((p) => p.filter((c) => c.id !== id))
        if (id === activeId) onOpenGroup(null, { replace: true })
        toast.add({ type: 'success', title: t('container.toast.groupDeleted') })
      } catch (err) {
        toast.add({
          type: 'error',
          title: t('container.toast.deleteGroupFailed'),
          description: err instanceof Error ? err.message : String(err)
        })
      }
    },
    [activeId, onOpenGroup, t]
  )

  const handleRename = useCallback(async (id: string, title: string) => {
    setConversations((p) => p.map((c) => (c.id === id ? { ...c, title } : c)))
    await updateConversation(id, { title })
  }, [])

  const handleNavigateConfig = useCallback(
    (page: ConfigPage) => onOpenPage(page),
    [onOpenPage]
  )

  const activeConv = conversations.find((c) => c.id === activeId)
  const members = (activeConv?.memberAgentIds ?? []).flatMap((id) => {
    const agent = agentsById[id]
    return agent ? [agent] : []
  }) as AgentData[]

  // Single SSE subscription per Group, hoisted here so the Members panel and
  // the chat both read from the same aggregated state.
  const stream = useConversationStream(activeId)

  // A member joins mid-round (`member_joined` bumps the revision): read the
  // groups again so the header and the Members panel list them.
  const { revision } = stream
  useEffect(() => {
    if (revision === 0) return
    void getConversations().then(setConversations)
  }, [revision])

  // Main column content varies by activePage; sidebar stays put on every page.
  const mainContent = (() => {
    if (activePage === 'workforce') return <WorkforcePage />
    if (activePage === 'dashboard')
      return (
        <Tabs
          defaultValue="schedule"
          className="flex h-full min-h-0 flex-col gap-0"
        >
          {/* The page's title and its tabs in the content bar, as Workforce's;
              each tab adds its own controls at the bar's right end. */}
          <PhilharmonicHeaderSlot>
            <div className="no-drag flex min-w-0 items-center gap-3 pl-2">
              <h1 className="truncate text-sm font-medium">
                {t('container.dashboardTitle')}
              </h1>
              <TabsList className="w-fit shrink-0">
                <TabsTrigger
                  value="schedule"
                  data-testid={TEST_IDS.schedule.tab}
                >
                  {t('container.tabs.schedule')}
                </TabsTrigger>
              </TabsList>
            </div>
            <div className="min-w-0 flex-1" />
          </PhilharmonicHeaderSlot>
          <TabsContent value="schedule" className="min-h-0 flex-1">
            <Suspense fallback={null}>
              <ScheduleTab conversations={conversations} />
            </Suspense>
          </TabsContent>
        </Tabs>
      )
    // chat
    if (activeConv) {
      return (
        <GroupChat
          conversation={activeConv}
          agentsById={agentsById}
          teamsById={teamsById}
          members={members}
          stream={stream}
          membersOpen={membersOpen}
          onToggleMembers={() => setMembersOpen((v) => !v)}
          onCreateGroup={handleCreate}
        />
      )
    }
    return (
      <div className="text-muted-foreground flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
        <HugeiconsIcon
          icon={MessageAdd01Icon}

          className="h-12 w-12 opacity-30"
        />
        <div className="text-foreground text-sm font-medium">
          {t('container.noGroupSelected.title')}
        </div>
        <div className="max-w-xs text-xs">
          {t('container.noGroupSelected.description')}
        </div>
        <Button size="sm" className="rounded-full" onClick={handleCreate}>
          {t('container.noGroupSelected.createButton')}
        </Button>
      </div>
    )
  })()

  // Members panel only appears alongside an active chat conversation.
  const showMembers = activePage === 'chat' && activeConv != null
  // On a group chat GroupChat renders its own chrome header (sidebar toggle +
  // conversation info + members toggle); everywhere else the layout supplies a
  // plain header bar.
  const groupChatOwnsHeader = showMembers

  return (
    <>
      <ResizableSidebarShell
        id="ph"
        sidebar={
          <ConversationList
            conversations={conversations}
            agentsById={agentsById}
            activeId={activeId}
            activePage={activePage}
            onSelect={handleSelect}
            onCreate={handleCreate}
            onDelete={handleDelete}
            onRename={handleRename}
            onNavigateConfig={handleNavigateConfig}
          />
        }
      >
        <SidebarInset className="flex h-full min-w-0 flex-col overflow-hidden">
          {groupChatOwnsHeader ? (
            <div className="min-h-0 flex-1 overflow-hidden">{mainContent}</div>
          ) : (
            <PhilharmonicSlottedHeader onCreateGroup={handleCreate}>
              <div className="min-h-0 flex-1 overflow-hidden">
                {mainContent}
              </div>
            </PhilharmonicSlottedHeader>
          )}
        </SidebarInset>
      </ResizableSidebarShell>

      <SheetPanel
        open={showMembers && membersOpen}
        onClose={() => setMembersOpen(false)}
      >
        {showMembers && (
          <GroupMembersPanel
            members={members}
            teamsById={teamsById}
            busyAgents={stream.busyAgents}
          />
        )}
      </SheetPanel>
    </>
  )
}
