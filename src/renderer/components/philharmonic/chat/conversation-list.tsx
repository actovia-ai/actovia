import {
  SearchIcon,
  Delete02Icon,
  EditIcon,
  DashboardSquare01Icon,
  UserGroupIcon
} from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { differenceInCalendarDays, isToday, isYesterday } from 'date-fns'
import { useMemo, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'

import { WorkspaceSwitcher } from '@/components/app/workspace-switcher'
import { PhilharmonicEmptyState } from '@/components/philharmonic/empty-state'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@/components/ui/alert-dialog'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger
} from '@/components/ui/context-menu'
import { Input } from '@/components/ui/input'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput
} from '@/components/ui/input-group'
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
import { NavFooter } from '@/layouts/chat-layout/nav-footer'
import { SIDEBAR_ON_MATERIAL } from '@/layouts/shared/sidebar-material'
import { makeFormatters } from '@/lib/format'
import { i18n } from '@/lib/i18n'
import { plainText } from '@/lib/plain-text'
import { cn } from '@/lib/utils'
import type { AgentData, ConversationData } from '@/stores/philharmonic'

import { hueStyle, pickHue } from '../lib/hue'
import { NewGroupButton } from './new-group-button'

export type ConfigPage = 'workforce' | 'dashboard'

export function DeleteGroupDescription({ title }: { title: string }) {
  return (
    <Trans
      ns="philharmonic"
      i18nKey="chat.conversationList.deleteDialog.description"
      values={{ title }}
    >
      <span className="bg-muted rounded-sm px-1.5 py-0.5 text-xs">{title}</span>{' '}
      and all its messages, tasks, and executions will be permanently removed.
    </Trans>
  )
}

const fmt = () => makeFormatters(i18n.resolvedLanguage ?? i18n.language ?? 'en')

/** Smart timestamp, in the user's locale: the time today, 'Yesterday', the day's name within the week, else the date. */
function smartTime(iso: string): string {
  try {
    const d = new Date(iso)
    if (isToday(d))
      return fmt().dateTime(d, { hour: 'numeric', minute: '2-digit' })
    if (isYesterday(d)) return i18n.t('philharmonic:chat.dateLabels.yesterday')
    const diff = differenceInCalendarDays(new Date(), d)
    if (diff < 7) return fmt().dateTime(d, { weekday: 'short' })
    return fmt().dateTime(d, { month: 'numeric', day: 'numeric' })
  } catch {
    return ''
  }
}

/** The list's line under a group: who spoke last and what they said, as plain text. */
export function previewLine(
  latest: ConversationData['latestMessage'],
  agentsById: Record<string, AgentData>
): string {
  if (!latest) return ''
  // The PM writes Markdown; `**Line 77:**` and backticks read as noise here.
  const text = plainText(latest.content)
  if (latest.role === 'system') return text
  const senderLabel =
    latest.role === 'user'
      ? i18n.t('common:state.you')
      : latest.role === 'pm'
        ? i18n.t('philharmonic:chat.roles.pm')
        : latest.agentId
          ? (agentsById[latest.agentId]?.name ??
            i18n.t('philharmonic:chat.roles.employeeFallback'))
          : i18n.t('philharmonic:chat.roles.employeeFallback')
  return `${senderLabel}: ${text}`
}

export function ConversationList({
  conversations,
  agentsById,
  activeId,
  activePage,
  onSelect,
  onCreate,
  onDelete,
  onRename,
  onNavigateConfig
}: {
  conversations: ConversationData[]
  agentsById: Record<string, AgentData>
  activeId: string | null
  activePage: 'chat' | ConfigPage
  onSelect: (id: string) => void
  onCreate: () => void
  onDelete: (id: string) => void | Promise<void>
  onRename: (id: string, title: string) => void | Promise<void>
  onNavigateConfig: (page: ConfigPage) => void
}) {
  const { t } = useTranslation(['common', 'philharmonic'])
  const configNav = useMemo(
    () => [
      {
        page: 'workforce' as const,
        label: t('philharmonic:chat.conversationList.configNav.workforce'),
        icon: UserGroupIcon
      },
      {
        page: 'dashboard' as const,
        label: t('philharmonic:chat.conversationList.configNav.dashboard'),
        icon: DashboardSquare01Icon
      }
    ],
    [t]
  )
  const [confirming, setConfirming] = useState<ConversationData | null>(null)
  // The group being renamed and the title typed so far; as Chat's sidebar
  // does it, from the row's menu, not in the group's header.
  const [renaming, setRenaming] = useState<{
    id: string
    title: string
  } | null>(null)
  const commitRename = () => {
    if (!renaming) return
    const title = renaming.title.trim()
    const before = conversations.find((c) => c.id === renaming.id)?.title
    setRenaming(null)
    if (title && title !== before) void onRename(renaming.id, title)
  }
  const [query, setQuery] = useState('')
  const isFullscreen = useIsFullscreen()

  const filtered = useMemo(() => {
    if (!query.trim()) return conversations
    const q = query.trim().toLowerCase()
    return conversations.filter((c) => {
      const inTitle = c.title.toLowerCase().includes(q)
      const inPreview =
        c.latestMessage?.content?.toLowerCase().includes(q) ?? false
      return inTitle || inPreview
    })
  }, [conversations, query])

  return (
    <Sidebar
      collapsible="none"
      className={cn('text-foreground h-full w-full', SIDEBAR_ON_MATERIAL)}
    >
      <SidebarHeader className="draggable gap-2 pt-2.25">
        {/* The title bar's row, as Chat's sidebar has it: the sidebar toggle
            to the right of the traffic lights and, where Chat has its history
            arrows, New group — the spot they take in the content header once
            the sidebar is away, so nothing jumps; in fullscreen the lights
            are gone and they move to the edge. */}
        <div
          className={cn(
            'flex h-7 items-center gap-1 transition-[padding] duration-200 ease-out',
            isFullscreen ? 'pl-2' : 'pl-21'
          )}
        >
          <SidebarTrigger className="no-drag text-muted-foreground hover:text-foreground" />
          <NewGroupButton onCreate={onCreate} />
        </div>
        <div className="flex items-center px-1">
          <WorkspaceSwitcher />
        </div>

        <div className="no-drag px-1">
          <InputGroup className="has-[[data-slot=input-group-control]:focus-visible]:border-transparent has-[[data-slot=input-group-control]:focus-visible]:ring-0">
            <InputGroupInput
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t(
                'philharmonic:chat.conversationList.searchPlaceholder'
              )}
            />
            <InputGroupAddon align="inline-start">
              <HugeiconsIcon icon={SearchIcon} />
            </InputGroupAddon>
          </InputGroup>
        </div>
      </SidebarHeader>

      <SidebarContent className="no-scrollbar px-1">
        {conversations.length === 0 ? (
          <PhilharmonicEmptyState
            avatars={[{ hue: 'lilac' }, { hue: 'mint' }, { hue: 'peach' }]}
            title={t('philharmonic:chat.conversationList.emptyState.title')}
            description={t(
              'philharmonic:chat.conversationList.emptyState.description'
            )}
            action={{
              label: t(
                'philharmonic:chat.conversationList.emptyState.createButton'
              ),
              onClick: onCreate
            }}
          />
        ) : filtered.length === 0 ? (
          <div className="text-muted-foreground flex h-full items-center justify-center px-4 text-center text-xs">
            {t('philharmonic:chat.conversationList.searchNoMatch', {
              query
            })}
          </div>
        ) : (
          <SidebarMenu className="gap-0.5">
            {filtered.map((c) => {
              const isActive = activePage === 'chat' && c.id === activeId
              const preview = previewLine(c.latestMessage, agentsById)
              return (
                <SidebarMenuItem key={c.id}>
                  <ContextMenu>
                    <ContextMenuTrigger>
                      <button
                        type="button"
                        onClick={() => onSelect(c.id)}
                        className={cn(
                          'flex w-full items-start gap-2.5 rounded-lg px-2 py-2 text-left transition-colors',
                          isActive
                            ? 'bg-sidebar-accent'
                            : 'hover:bg-sidebar-accent/60'
                        )}
                      >
                        <span
                          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-base"
                          style={hueStyle(pickHue(c.id))}
                        >
                          {c.icon ?? '💬'}
                        </span>
                        <span className="flex min-w-0 flex-1 flex-col gap-0.5 pt-0.5">
                          <span className="flex items-baseline justify-between gap-2">
                            <span className="text-ui truncate font-medium">
                              {c.title}
                            </span>
                            <span className="text-muted-foreground text-2xs shrink-0 tabular-nums">
                              {smartTime(c.lastMessageAt)}
                            </span>
                          </span>
                          <span className="text-muted-foreground truncate text-xs">
                            {preview ||
                              t(
                                'philharmonic:chat.conversationList.noMessagesYetPreview'
                              )}
                          </span>
                        </span>
                      </button>
                    </ContextMenuTrigger>
                    <ContextMenuContent>
                      <ContextMenuItem
                        onClick={() =>
                          setRenaming({ id: c.id, title: c.title })
                        }
                      >
                        <HugeiconsIcon
                          icon={EditIcon}
                          className="mr-1.5 h-3.5 w-3.5"
                        />
                        {t('philharmonic:chat.conversationList.rename')}
                      </ContextMenuItem>
                      <ContextMenuSeparator />
                      <ContextMenuItem
                        variant="destructive"
                        onClick={() => setConfirming(c)}
                      >
                        <HugeiconsIcon
                          icon={Delete02Icon}

                          className="mr-1.5 h-3.5 w-3.5"
                        />
                        {t('action.delete')}
                      </ContextMenuItem>
                    </ContextMenuContent>
                  </ContextMenu>
                </SidebarMenuItem>
              )
            })}
          </SidebarMenu>
        )}
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu className="gap-0.5">
          {configNav.map((item) => {
            const Icon = item.icon
            return (
              <SidebarMenuItem key={item.page}>
                <SidebarMenuButton
                  isActive={activePage === item.page}
                  onClick={() => onNavigateConfig(item.page)}
                >
                  <HugeiconsIcon icon={Icon} />
                  {item.label}
                </SidebarMenuButton>
              </SidebarMenuItem>
            )
          })}
        </SidebarMenu>
        {/* The account menu, as Chat's sidebar has it (ISSUE-276). */}
        <NavFooter />
      </SidebarFooter>

      <AlertDialog
        open={renaming !== null}
        onOpenChange={(o) => !o && setRenaming(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t('philharmonic:chat.conversationList.renameDialog.title')}
            </AlertDialogTitle>
          </AlertDialogHeader>
          <Input
            value={renaming?.title ?? ''}
            onChange={(e) =>
              setRenaming((r) => r && { ...r, title: e.target.value })
            }
            onKeyDown={(e) => {
              // An IME's Enter commits its composition, not the name.
              if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                e.preventDefault()
                commitRename()
              }
            }}
            autoFocus
          />
          <AlertDialogFooter>
            <AlertDialogCancel>{t('action.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              disabled={!renaming?.title.trim()}
              onClick={commitRename}
            >
              {t('action.save')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={confirming !== null}
        onOpenChange={(o) => !o && setConfirming(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t('philharmonic:chat.conversationList.deleteDialog.title')}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirming ? (
                <DeleteGroupDescription title={confirming.title} />
              ) : (
                ''
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('action.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={async () => {
                if (!confirming) return
                const id = confirming.id
                setConfirming(null)
                await onDelete(id)
              }}
            >
              {t('action.delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Sidebar>
  )
}
