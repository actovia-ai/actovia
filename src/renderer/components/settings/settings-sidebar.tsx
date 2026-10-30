import { TEST_IDS } from '@actovia/shared/constants/test-ids'
import { ArrowLeft02Icon, SearchIcon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { ComponentProps, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem
} from '@/components/ui/sidebar'
import { useIsFullscreen } from '@/hooks/use-is-full-screen'
import { useSettingsTab } from '@/hooks/use-settings-tab'
import { cn } from '@/lib/utils'

import { InputGroup, InputGroupInput, InputGroupAddon } from '../ui/input-group'
import { menus, NAV_TITLE_KEYS } from './settings-menu'

export function SettingsSidebar({ ...props }: ComponentProps<typeof Sidebar>) {
  const { t } = useTranslation('settings')
  const [active, setActive] = useSettingsTab()
  const [query, setQuery] = useState('')
  const navigate = useNavigate()
  const isFullscreen = useIsFullscreen()

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return menus.navMain

    return menus.navMain
      .map((group) => ({
        label: group.label,
        items: group.items.filter((item) =>
          t(NAV_TITLE_KEYS[item.title]).toLowerCase().includes(q)
        )
      }))
      .filter((group) => group.items.length > 0)
  }, [query, t])

  return (
    <Sidebar {...props} collapsible="none" className="select-none">
      <SidebarHeader
        className={cn('draggable shrink-0', isFullscreen ? 'pt-2' : 'pt-11')}
      >
        <Button
          variant="ghost"
          onClick={() => navigate(-1)}
          className="no-drag justify-start"
        >
          <HugeiconsIcon icon={ArrowLeft02Icon} />
          {t('common.backToApp')}
        </Button>

        <InputGroup className="no-drag">
          <InputGroupInput
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('common.searchPlaceholder')}
          />
          <InputGroupAddon align="inline-start">
            <HugeiconsIcon icon={SearchIcon} />
          </InputGroupAddon>
        </InputGroup>
      </SidebarHeader>
      <SidebarContent>
        {groups.map((group) => (
          <SidebarGroup key={group.label}>
            {group.label && (
              <SidebarGroupLabel>{t(group.label)}</SidebarGroupLabel>
            )}
            <SidebarMenu className="gap-0.5">
              {group.items.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton
                    data-testid={TEST_IDS.settings.navItem}
                    data-tab={item.title}
                    isActive={item.title === active}
                    onClick={() => setActive(item.title)}
                  >
                    {item.icon && <HugeiconsIcon icon={item.icon} />}
                    {t(NAV_TITLE_KEYS[item.title])}
                    {'experimental' in item && item.experimental && (
                      <Badge variant="outline" className="ml-auto">
                        {t('nav.experimental')}
                      </Badge>
                    )}
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroup>
        ))}
      </SidebarContent>
    </Sidebar>
  )
}
