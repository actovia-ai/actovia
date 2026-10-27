import { TEST_IDS } from '@actovia/shared/constants/test-ids'
import { Message01Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useTranslation } from 'react-i18next'
import { useLocation, useNavigate } from 'react-router'

import { MusicConductor } from '@/components/icons/music-conductor'
import { Button } from '@/components/ui/button'
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
    icon: Message01Icon,
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
 * Chat / Philharmonic as a pair of icon buttons at the right of the sidebar's
 * top row (ISSUE-237, after Claude's chat / code switch): the surface on show
 * is pressed, the other is one click away — no menu to open.
 */
export function WorkspaceSwitcher({ className }: { className?: string }) {
  const { t } = useTranslation('chat')
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const active = pathname.startsWith('/philharmonic') ? 'philharmonic' : 'chat'

  return (
    <TooltipProvider>
      <div
        role="group"
        aria-label={t('sidebar.workspace.label')}
        data-testid={TEST_IDS.chatLayout.workspaceSwitcher}
        className={cn(
          'no-drag bg-sidebar-accent flex items-center gap-0.5 rounded-lg p-0.5',
          className
        )}
      >
        {WORKSPACES.map((w) => {
          const pressed = w.id === active
          const label = t(w.labelKey)
          return (
            <Tooltip key={w.id}>
              <TooltipTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={label}
                    aria-pressed={pressed}
                    data-testid={w.testId}
                    onClick={() => {
                      if (!pressed) navigate(w.path)
                    }}
                    className={cn(
                      'size-6.5 rounded-md',
                      pressed
                        ? 'bg-background text-foreground hover:bg-background shadow-xs'
                        : 'text-muted-foreground hover:text-foreground hover:bg-transparent'
                    )}
                  />
                }
              >
                <HugeiconsIcon icon={w.icon} className="size-4" />
              </TooltipTrigger>
              <TooltipContent>{label}</TooltipContent>
            </Tooltip>
          )
        })}
      </div>
    </TooltipProvider>
  )
}
