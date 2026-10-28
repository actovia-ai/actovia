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
import { SIDEBAR_FIELD, SIDEBAR_SOLID } from '@/layouts/shared/sidebar-material'
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
    <Sidebar
      {...props}
      collapsible="none"
      className={cn('text-foreground select-none', SIDEBAR_SOLID)}
    >
      <SidebarHeader
        className={cn(
          'draggable shrink-0 gap-2 px-3 pb-2',
          isFullscreen ? 'pt-2' : 'pt-11'
        )}
      >
        <Button
          variant="ghost"
          onClick={() => navigate(-1)}
          className="no-drag text-muted-foreground flex justify-start gap-2"
        >
          <HugeiconsIcon icon={ArrowLeft02Icon} />
          {t('common.backToApp')}
        </Button>

        <InputGroup
          className={cn(
            'no-drag',
            // On the solid, deeper sidebar the primitive's `bg-input/50`
            // washes into it (ISSUE-269), and `bg-background` stood out as
            // white in light: the field is the sidebar's own colour a step
            // lighter than the panel, with a hairline. Dark keeps the input.
            `${SIDEBAR_FIELD} dark:bg-input/50 dark:border-transparent`,
            // drop the primitive's default focus-visible ring + border-ring
            'has-[[data-slot=input-group-control]:focus-visible]:border-transparent has-[[data-slot=input-group-control]:focus-visible]:ring-0'
          )}
        >
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
      <SidebarContent className="no-scrollbar gap-1 px-1 pb-2">
        {groups.map((group) => (
          <SidebarGroup key={group.label} className="gap-0.5 py-1">
            {group.label && (
              <SidebarGroupLabel className="text-muted-foreground/70 text-2xs px-2 font-medium tracking-wider uppercase">
                {t(group.label)}
              </SidebarGroupLabel>
            )}
            <SidebarMenu className="gap-0.5">
              {group.items.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton
                    isActive={item.title === active}
                    onClick={() => setActive(item.title)}
                  >
                    {item.icon && <HugeiconsIcon icon={item.icon} />}
                    {t(NAV_TITLE_KEYS[item.title])}
                    {'experimental' in item && item.experimental && (
                      <Badge
                        variant="outline"
                        // A chip on the solid sidebar, active row included:
                        // filled, or its light border ghosts on the row —
                        // the field's fill in light, the page's in dark.
                        className={cn(
                          'text-2xs ml-auto font-normal',
                          SIDEBAR_FIELD,
                          'dark:bg-background'
                        )}
                      >
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
