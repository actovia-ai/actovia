import { TEST_IDS } from '@actovia/shared/constants/test-ids'
import { Chatting01Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useTranslation } from 'react-i18next'
import { useLocation, useNavigate } from 'react-router'

import { MusicConductor } from '@/components/icons/music-conductor'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger
} from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

const WORKSPACES = [
  {
    id: 'chat',
    labelKey: 'sidebar.workspace.chat',
    icon: Chatting01Icon,
    path: '/',
    testId: TEST_IDS.chatLayout.workspaceChat
  },
  {
    id: 'philharmonic',
    labelKey: 'sidebar.workspace.philharmonic',
    icon: MusicConductor,
    path: '/philharmonic',
    testId: TEST_IDS.chatLayout.workspacePhilharmonic
  }
] as const

/**
 * Chat / Philharmonic at the right of the sidebar's top row (ISSUE-237,
 * after Claude's chat / code switch): shadcn's Tabs (ISSUE-266), icon-only,
 * the surface on show selected and the other one click (or arrow key) away.
 */
export function WorkspaceSwitcher({ className }: { className?: string }) {
  const { t } = useTranslation('chat')
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const active = pathname.startsWith('/philharmonic') ? 'philharmonic' : 'chat'

  return (
    <TooltipProvider>
      <Tabs
        value={active}
        onValueChange={(value) => {
          const target = WORKSPACES.find((w) => w.id === value)
          if (target && value !== active) navigate(target.path)
        }}
        className={cn('no-drag', className)}
      >
        <TabsList
          aria-label={t('sidebar.workspace.label')}
          data-testid={TEST_IDS.chatLayout.workspaceSwitcher}
          className="bg-sidebar-accent h-7! rounded-lg"
        >
          {WORKSPACES.map((w) => {
            const label = t(w.labelKey)
            return (
              <Tooltip key={w.id}>
                <TooltipTrigger
                  render={
                    <TabsTrigger
                      value={w.id}
                      aria-label={label}
                      data-testid={w.testId}
                      className="size-6 flex-none rounded-md px-0 data-active:shadow-xs"
                    />
                  }
                >
                  <HugeiconsIcon icon={w.icon} className="size-4" />
                </TooltipTrigger>
                <TooltipContent>{label}</TooltipContent>
              </Tooltip>
            )
          })}
        </TabsList>
      </Tabs>
    </TooltipProvider>
  )
}
