import { TEST_IDS } from '@actovia/shared/constants/test-ids'
import { UnfoldMoreIcon, SettingsIcon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation, useNavigate } from 'react-router'

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem
} from '@/components/ui/sidebar'
import { useSettings } from '@/hooks/use-settings'

export function NavFooter({
  ...props
}: React.ComponentProps<typeof SidebarMenu>) {
  const { t } = useTranslation('common')
  const navigate = useNavigate()
  const location = useLocation()
  const { data: settings } = useSettings()

  const onSettings = location.pathname.includes('settings')
  const nickname = settings?.personality?.nickname?.trim() || 'You'
  const initial = nickname.slice(0, 1).toUpperCase()

  return (
    <SidebarMenu {...props}>
      <SidebarMenuItem>
        <DropdownMenu>
          {/* The trigger renders as the menu button itself: one <button>,
              never a button inside a button. */}
          <DropdownMenuTrigger
            render={
              <SidebarMenuButton
                size="lg"
                isActive={onSettings}
                data-testid={TEST_IDS.chatLayout.account}
                className="data-popup-open:bg-sidebar-accent data-popup-open:text-sidebar-accent-foreground"
              />
            }
          >
            <Avatar size="sm">
              <AvatarImage
                src={settings?.userAvatar ?? undefined}
                alt={nickname}
              />
              <AvatarFallback className="rounded-full">
                {initial}
              </AvatarFallback>
            </Avatar>
            <div className="text-ui grid flex-1 text-left leading-tight">
              <span className="truncate font-medium">{nickname}</span>
              <span className="truncate text-xs">{t('state.runOnLocal')}</span>
            </div>
            <HugeiconsIcon icon={UnfoldMoreIcon} className="ml-auto size-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="min-w-56 rounded-lg"
            side="right"
            align="end"
            sideOffset={4}
          >
            <DropdownMenuGroup>
              <DropdownMenuLabel className="p-0 font-normal">
                <div className="text-ui flex items-center gap-2 px-1 py-1.5 text-left">
                  <Avatar className="h-8 w-8">
                    <AvatarImage
                      src={settings?.userAvatar ?? undefined}
                      alt={nickname}
                    />
                    <AvatarFallback className="rounded-full">
                      {initial}
                    </AvatarFallback>
                  </Avatar>
                  <div className="text-ui grid flex-1 text-left leading-tight">
                    <span className="truncate font-medium">{nickname}</span>
                    <span className="truncate text-xs">
                      {t('state.runOnLocal')}
                    </span>
                  </div>
                </div>
              </DropdownMenuLabel>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem
                data-testid={TEST_IDS.chatLayout.accountSettings}
                onClick={() => navigate('/settings')}
              >
                <HugeiconsIcon icon={SettingsIcon} />
                {t('nav.settings')}
              </DropdownMenuItem>
            </DropdownMenuGroup>
            {/* Future account-menu items (online/offline mode switch, sign
                out) once those features exist — Actovia is local-first with
                no external auth today (see CLAUDE.md), so there's nothing
                to wire these to yet. */}
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
