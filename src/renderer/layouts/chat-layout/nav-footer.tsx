import {
  ACTOVIA_DOCS,
  ACTOVIA_RELEASES
} from '@actovia/shared/constants/external-urls'
import { TEST_IDS } from '@actovia/shared/constants/test-ids'
import {
  HelpCircleIcon,
  LockIcon,
  News01Icon,
  SettingsIcon,
  SmartPhone01Icon,
  UnfoldMoreIcon
} from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useAtomValue } from 'jotai'
import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation, useNavigate } from 'react-router'

import { AppsDialog } from '@/components/app/apps-dialog'
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
import { lockNow } from '@/lib/lock-ipc'
import { lockStatusAtom } from '@/stores/lock'

/** Opens a page in the browser; the window-open handler sends it out safely. */
const openInBrowser = (url: string) => {
  window.open(url, '_blank', 'noopener,noreferrer')
}

export function NavFooter({
  ...props
}: React.ComponentProps<typeof SidebarMenu>) {
  const { t } = useTranslation(['common', 'chat'])
  const navigate = useNavigate()
  const location = useLocation()
  const { data: settings } = useSettings()
  const lockStatus = useAtomValue(lockStatusAtom)
  const [appsOpen, setAppsOpen] = useState(false)

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
              <DropdownMenuItem
                data-testid={TEST_IDS.chatLayout.accountApps}
                onClick={() => setAppsOpen(true)}
              >
                <HugeiconsIcon icon={SmartPhone01Icon} />
                {t('chat:sidebar.account.apps')}
              </DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem onClick={() => openInBrowser(ACTOVIA_DOCS)}>
                <HugeiconsIcon icon={HelpCircleIcon} />
                {t('chat:sidebar.account.help')}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => openInBrowser(ACTOVIA_RELEASES)}>
                <HugeiconsIcon icon={News01Icon} />
                {t('chat:sidebar.account.whatsNew')}
              </DropdownMenuItem>
            </DropdownMenuGroup>
            {lockStatus?.hasPin && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  data-testid={TEST_IDS.chatLayout.accountLock}
                  onClick={() => void lockNow()}
                >
                  <HugeiconsIcon icon={LockIcon} />
                  {t('chat:sidebar.account.lock')}
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
        <AppsDialog open={appsOpen} onOpenChange={setAppsOpen} />
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
