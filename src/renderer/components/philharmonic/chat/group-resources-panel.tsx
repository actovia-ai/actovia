import { TEST_IDS } from '@actovia/shared/constants/test-ids'
import {
  File01Icon,
  Folder01Icon,
  ArrowDown01Icon
} from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useTranslation } from 'react-i18next'

import { SheetPanel } from '@/components/app/sheet-panel'
import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { toast } from '@/components/ui/toast'
import { useConversationProject } from '@/hooks/use-conversation-project'
import {
  groupArchiveFileUrl,
  revealGroupArchive
} from '@/services/philharmonic-chat'
import { revealConversationProjectFolder } from '@/services/projects'
import type { AgentData, TeamData } from '@/stores/philharmonic'

import { PhilharmonicEmptyState } from '../empty-state'
import { GroupContextSection } from './group-context-section'
import { GroupMembersPanel } from './group-members-panel'
import type { BubbleModel } from './group-message-bubble'

export type GroupPanelSection = 'monitor' | 'final-output'

export function GroupResourcesPanel({
  conversationId,
  open,
  section,
  onSectionChange,
  onClose,
  bubbles,
  revision,
  members,
  teamsById,
  busyAgents
}: {
  conversationId: string
  open: boolean
  section: GroupPanelSection
  onSectionChange: (section: GroupPanelSection) => void
  onClose: () => void
  bubbles: BubbleModel[]
  revision: number
  members: AgentData[]
  teamsById: Record<string, TeamData>
  busyAgents: ReadonlyMap<string, string>
}) {
  const { t } = useTranslation(['chat', 'common', 'philharmonic'])
  const project = useConversationProject(conversationId, open)
  const entries = [
    ...new Map(
      bubbles
        .flatMap((b) => b.archives ?? [])
        .map((entry) => [entry.path, entry])
    ).values()
  ]
  const report = (error: unknown) =>
    toast.add({
      type: 'error',
      title: t('philharmonic:agents.card.folderFailed'),
      description: String(error)
    })
  return (
    <SheetPanel
      open={open}
      onClose={onClose}
      data-testid={TEST_IDS.philharmonic.resourcesPanel}
    >
      <div className="flex h-12 shrink-0 items-center border-b pr-12 pl-3">
        <Tabs
          value={section}
          onValueChange={(value) => onSectionChange(value as GroupPanelSection)}
          className="min-w-0 flex-1"
        >
          <TabsList className="w-full">
            {(['monitor', 'final-output'] as const).map((tab) => (
              <TabsTrigger
                key={tab}
                value={tab}
                data-testid={TEST_IDS.philharmonic.resourcesTab}
                data-section={tab}
              >
                {t(
                  `philharmonic:chat.resourcesPanel.${tab === 'monitor' ? 'monitor' : 'finalOutput'}`
                )}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>
      {open &&
        (section === 'monitor' ? (
          <div className="min-h-0 flex-1 overflow-y-auto">
            <section className="px-3 pt-3 pb-4">
              <h2 className="px-3 text-sm font-semibold">
                {t('chat:panel.context.tab')}
              </h2>
              <GroupContextSection
                conversationId={conversationId}
                revision={revision}
              />
            </section>
            <div className="border-t">
              <GroupMembersPanel
                members={members}
                teamsById={teamsById}
                busyAgents={busyAgents}
                embedded
              />
            </div>
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="min-h-0 flex-1 overflow-y-auto p-3">
              {entries.length === 0 ? (
                <PhilharmonicEmptyState
                  title={t('philharmonic:chat.archive.emptyTitle')}
                  description={t('philharmonic:chat.archive.emptyDescription')}
                />
              ) : (
                <div className="divide-y">
                  {entries.map((entry) => (
                    <article
                      key={entry.path}
                      data-testid={TEST_IDS.philharmonic.finalOutputItem}
                      className="flex items-start gap-3 py-4"
                    >
                      <HugeiconsIcon
                        icon={entry.directory ? Folder01Icon : File01Icon}
                        className="text-muted-foreground mt-1 size-5 shrink-0"
                      />
                      <div className="min-w-0 flex-1">
                        <h3 className="text-sm font-medium">{entry.title}</h3>
                        <p className="text-muted-foreground mt-1 text-xs break-all">
                          {entry.path}
                        </p>
                        <div className="mt-2 flex flex-wrap gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() =>
                              void revealGroupArchive(
                                conversationId,
                                entry.path
                              ).catch(report)
                            }
                          >
                            {t('philharmonic:chat.archive.reveal')}
                          </Button>
                          {
                            <Button
                              size="sm"
                              variant="ghost"
                              render={
                                <a
                                  href={groupArchiveFileUrl(
                                    conversationId,
                                    entry.path
                                  )}
                                  download
                                />
                              }
                            >
                              <HugeiconsIcon
                                icon={ArrowDown01Icon}
                                className="size-3.5"
                              />
                              {t('common:attachment.download')}
                            </Button>
                          }
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </div>
            {project.data?.project && (
              <div className="border-t p-3">
                <Button
                  variant="ghost"
                  className="w-full justify-start"
                  data-testid={TEST_IDS.philharmonic.resourcesMenu}
                  onClick={() =>
                    void revealConversationProjectFolder(conversationId).catch(
                      report
                    )
                  }
                >
                  <HugeiconsIcon icon={Folder01Icon} className="size-4" />
                  <span
                    data-testid={TEST_IDS.philharmonic.finalOutputFolder}
                    className="truncate"
                  >
                    {project.data.project.name}
                  </span>
                </Button>
              </div>
            )}
          </div>
        ))}
    </SheetPanel>
  )
}
