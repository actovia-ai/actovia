import { TEST_IDS } from '@actovia/shared/constants/test-ids'
import { useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { SheetPanel } from '@/components/app/sheet-panel'
import {
  ActivitySection,
  FilesSection
} from '@/components/chat/panel/chat-panel'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { groupPanelItems } from '@/lib/group-panel-items'
import { getGroupToolResults } from '@/services/philharmonic-chat'
import type { AgentData, TeamData } from '@/stores/philharmonic'

import { GroupMembersPanel } from './group-members-panel'
import type { BubbleModel } from './group-message-bubble'

export function GroupResourcesPanel({
  conversationId,
  open,
  onClose,
  bubbles,
  revision,
  members,
  teamsById,
  busyAgents
}: {
  conversationId: string
  open: boolean
  onClose: () => void
  bubbles: BubbleModel[]
  revision: number
  members: AgentData[]
  teamsById: Record<string, TeamData>
  busyAgents: ReadonlyMap<string, string>
}) {
  const { t } = useTranslation(['chat', 'philharmonic'])
  const [section, setSection] = useState('members')
  const { data, isError } = useQuery({
    queryKey: ['group-tool-results', conversationId, revision],
    queryFn: () => getGroupToolResults(conversationId),
    enabled: open,
    refetchInterval: open ? 5000 : false
  })
  const items = useMemo(
    () => groupPanelItems(bubbles, data ?? []),
    [bubbles, data]
  )
  const jump = (messageId: string) =>
    document
      .querySelector<HTMLElement>(
        `[data-message-id="${CSS.escape(messageId)}"]`
      )
      ?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  return (
    <SheetPanel
      open={open}
      onClose={onClose}
      data-testid={TEST_IDS.philharmonic.resourcesPanel}
    >
      <div className="bg-background flex h-12 shrink-0 items-center border-b pr-12 pl-3">
        <Tabs
          value={section}
          onValueChange={(value) => setSection(String(value))}
          className="min-w-0 flex-1"
        >
          <TabsList className="w-full">
            {(['members', 'files', 'activity'] as const).map((tab) => (
              <TabsTrigger
                key={tab}
                value={tab}
                data-testid={TEST_IDS.philharmonic.resourcesTab}
                data-section={tab}
              >
                {tab === 'members'
                  ? t('philharmonic:chat.membersPanel.heading')
                  : t(`panel.${tab}`)}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>
      {open &&
        (section === 'members' ? (
          <GroupMembersPanel
            members={members}
            teamsById={teamsById}
            busyAgents={busyAgents}
          />
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            {isError && (
              <p className="text-destructive px-3 py-2 text-sm">
                {t('workspaceFile.readFailed')}
              </p>
            )}
            {section === 'files' ? (
              items.files.length ? (
                <FilesSection items={items} onNavigate={jump} />
              ) : (
                <p className="text-muted-foreground px-3 py-6 text-center text-sm">
                  {t('panel.empty')}
                </p>
              )
            ) : (
              <ActivitySection items={items} onNavigate={jump} />
            )}
          </div>
        ))}
    </SheetPanel>
  )
}
