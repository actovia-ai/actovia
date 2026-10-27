import { TEST_IDS } from '@actovia/shared/constants/test-ids'
import { SearchIcon, PencilEdit02Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useSetAtom } from 'jotai'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'

import { WorkspaceSwitcher } from '@/components/app/workspace-switcher'
import { HistoryArrows } from '@/components/chat/header/history-arrows'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarTrigger
} from '@/components/ui/sidebar'
import { useIsFullscreen } from '@/hooks/use-is-full-screen'
import { MOD_KEY } from '@/hooks/use-keyboard-shortcuts'
import { SIDEBAR_ON_MATERIAL } from '@/layouts/shared/sidebar-material'
import { cn } from '@/lib/utils'
import { isSearchChatsVisibleAtom } from '@/stores/chat'

import { NavFooter } from './nav-footer'
import { NavHistories } from './nav-histories'

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const { t } = useTranslation('chat')
  const isFullscreen = useIsFullscreen()
  const navigate = useNavigate()
  const setIsSearchChatsVisible = useSetAtom(isSearchChatsVisibleAtom)

  return (
    <Sidebar
      collapsible="none"
      className={cn('text-foreground h-full w-full', SIDEBAR_ON_MATERIAL)}
      {...props}
    >
      <SidebarHeader className="draggable gap-2 pt-2.25">
        {/* The title bar's row: the sidebar toggle to the right of the traffic
            lights, where Notes and ChatGPT keep it, and the history arrows
            beside it (as Claude's) — at the same spot they take in the content
            header once the sidebar is away, so nothing jumps; in fullscreen
            the lights are gone and they move to the edge. */}
        <div
          className={cn(
            'flex h-7 items-center gap-1 transition-[padding] duration-200 ease-out',
            isFullscreen ? 'pl-2' : 'pl-21'
          )}
        >
          <SidebarTrigger className="no-drag text-muted-foreground hover:text-foreground" />
          <HistoryArrows />
        </div>
        <div className="flex items-center px-1">
          <WorkspaceSwitcher />
        </div>
        <SidebarMenu className="no-drag gap-0.5">
          <SidebarMenuItem>
            <SidebarMenuButton
              data-testid={TEST_IDS.chatLayout.newChat}
              onClick={() => navigate('/')}
            >
              <HugeiconsIcon icon={PencilEdit02Icon} />
              <span>{t('sidebar.newChat')}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton
              data-testid={TEST_IDS.chatLayout.searchButton}
              onClick={() => setIsSearchChatsVisible(true)}
            >
              <HugeiconsIcon icon={SearchIcon} />
              <span className="flex-1">{t('sidebar.searchChats')}</span>
              <span className="text-muted-foreground text-xs tracking-wide">
                {MOD_KEY}⇧F
              </span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent className="no-scrollbar">
        <NavHistories />
      </SidebarContent>
      <SidebarFooter>
        <NavFooter className="mt-auto" />
      </SidebarFooter>
    </Sidebar>
  )
}
