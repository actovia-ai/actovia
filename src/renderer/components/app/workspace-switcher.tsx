import { TEST_IDS } from '@actovia/shared/constants/test-ids'
import { ArrowDown01Icon, Tick02Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useTranslation } from 'react-i18next'
import { useLocation, useNavigate } from 'react-router'

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'

const WORKSPACES = [
  {
    id: 'chat',
    labelKey: 'sidebar.workspace.chat',
    descriptionKey: 'sidebar.workspace.chatDescription',
    path: '/',
    testId: TEST_IDS.chatLayout.workspaceChat
  },
  {
    id: 'philharmonic',
    labelKey: 'sidebar.workspace.philharmonic',
    descriptionKey: 'sidebar.workspace.philharmonicDescription',
    path: '/philharmonic',
    testId: TEST_IDS.chatLayout.workspacePhilharmonic
  }
] as const

/**
 * Chat / Philharmonic as the sidebar's title, ChatGPT's (its ChatGPT / Codex
 * menu): the surface on show and a chevron, opening to both surfaces — a line
 * on what each is for, a check on the one on show. The owner brought it back
 * on 2026-10-28 in place of ISSUE-237's icon switch at the top right.
 */
export function WorkspaceSwitcher({ className }: { className?: string }) {
  const { t } = useTranslation('chat')
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const active = pathname.startsWith('/philharmonic')
    ? WORKSPACES[1]
    : WORKSPACES[0]

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={t('sidebar.workspace.label')}
        data-testid={TEST_IDS.chatLayout.workspaceSwitcher}
        className={cn(
          'no-drag flex w-fit items-center gap-1 rounded-lg px-2 py-1 transition-colors',
          'hover:bg-sidebar-accent data-popup-open:bg-sidebar-accent focus-visible:outline-hidden',
          className
        )}
      >
        <span className="text-base font-semibold">{t(active.labelKey)}</span>
        <HugeiconsIcon
          icon={ArrowDown01Icon}
          className="text-muted-foreground size-4"
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="no-drag w-64">
        {WORKSPACES.map((w) => (
          <DropdownMenuItem
            key={w.id}
            data-testid={w.testId}
            aria-current={w.id === active.id ? 'page' : undefined}
            className="items-center gap-3 rounded-xl px-3 py-2"
            onClick={() => {
              if (w.id !== active.id) navigate(w.path)
            }}
          >
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="text-sm">{t(w.labelKey)}</span>
              <span className="text-muted-foreground text-xs">
                {t(w.descriptionKey)}
              </span>
            </span>
            {w.id === active.id && (
              <HugeiconsIcon icon={Tick02Icon} className="size-4" />
            )}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
