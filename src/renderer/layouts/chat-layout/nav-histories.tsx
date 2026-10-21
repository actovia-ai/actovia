import { TEST_IDS } from '@actovia/shared/constants/test-ids'
import {
  ArrowRight01Icon,
  Copy01Icon,
  MoreHorizontalCircle01Icon,
  StarIcon,
  Delete02Icon,
  EditIcon
} from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useSetAtom } from 'jotai'
import { memo, useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useParams } from 'react-router'
import { sileo } from 'sileo'

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger
} from '@/components/ui/collapsible'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar
} from '@/components/ui/sidebar'
import { Skeleton } from '@/components/ui/skeleton'
import { useChatHistory, useUpdateChat } from '@/hooks/use-chat-history'
import { useClipboard } from '@/hooks/use-clipboard'
import {
  compactRelativeTime,
  parseLocalishCreatedAt
} from '@/lib/relative-time'
import { cn } from '@/lib/utils'
import { renamedChatTitleAtom, toBeDeletedChatAtom } from '@/stores/chat'
import type { Chat } from '@/types/db'

export function NavHistorySkeleton() {
  return (
    <section className="flex flex-col gap-3 p-2">
      <Skeleton className="bg-border m-2 h-4 w-20" />
      {Array.from({ length: 10 })
        .fill(0)
        .map((_, idx) => (
          <div key={idx} className="flex px-2">
            <Skeleton className="bg-border h-5 w-full" />
          </div>
        ))}
    </section>
  )
}

export const NavItems = memo(function NavItems({
  chat,
  className,
  onToggleFavorite
}: {
  chat: Chat
  className?: string
  onToggleFavorite: (chat: Chat) => void
}) {
  const { t } = useTranslation(['common', 'chat'])
  const { id } = useParams<{ id: string }>()
  const { isMobile } = useSidebar()
  const setRenamedChatTitle = useSetAtom(renamedChatTitleAtom)
  const setToBeDeletedChat = useSetAtom(toBeDeletedChatAtom)
  const { handleCopy } = useClipboard()

  // The id is what another chat is given to read this one: pasted into a
  // message, it lets the model look this conversation up (`lcm_describe`).
  const copyId = async () => {
    if (await handleCopy(chat.id)) {
      sileo.success({ title: t('chat:sidebar.history.idCopied') })
    }
  }

  return (
    <SidebarMenuItem className={cn(className, 'h-8')}>
      <SidebarMenuButton
        isActive={chat.id === id}
        render={<Link to={`/chat/${chat.id}`} />}
      >
        {/* pr-3 on top of the button's pr-8: room for the age ("11mo")
            that sits over the row's right edge. */}
        <span className="min-w-0 flex-1 truncate pr-3">{chat.title}</span>
      </SidebarMenuButton>
      {/* The row's age sits where the menu button does; the button takes its
          place on hover and while its menu is open (owner, 2026-10-08): the
          title keeps the width, and the right edge is never an empty band. */}
      <span className="text-muted-foreground pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 text-xs tabular-nums transition-opacity group-focus-within/menu-item:opacity-0 group-hover/menu-item:opacity-0 group-has-[[aria-expanded=true]]/menu-item:opacity-0">
        {compactRelativeTime(parseLocalishCreatedAt(chat.createdAt))}
      </span>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <SidebarMenuAction
              showOnHover
              data-testid={TEST_IDS.chatLayout.historyItemMenu}
            >
              <HugeiconsIcon icon={MoreHorizontalCircle01Icon} />
              <span className="sr-only">{t('chat:sidebar.history.more')}</span>
            </SidebarMenuAction>
          }
        />
        <DropdownMenuContent
          className="w-56 rounded-lg"
          side={isMobile ? 'bottom' : 'right'}
          align={isMobile ? 'end' : 'start'}
        >
          <DropdownMenuItem onClick={() => onToggleFavorite(chat)}>
            <HugeiconsIcon
              icon={StarIcon}

              className={cn('text-muted-foreground', {
                ['fill-yellow-500 text-yellow-500']: chat.favorite
              })}
            />
            <span>
              {chat.favorite
                ? t('chat:sidebar.history.unfavorite')
                : t('chat:sidebar.history.favoriteAction')}
            </span>
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => {
              setRenamedChatTitle({
                id: chat.id,
                title: chat.title,
                open: true
              })
            }}
          >
            <HugeiconsIcon
              icon={EditIcon}

              className="text-muted-foreground"
            />
            <span>{t('chat:sidebar.history.rename')}</span>
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={copyId}
            data-testid={TEST_IDS.chatLayout.copyChatId}
          >
            <HugeiconsIcon
              icon={Copy01Icon}

              className="text-muted-foreground"
            />
            <span>{t('chat:sidebar.history.copyId')}</span>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => setToBeDeletedChat(chat)}>
            <HugeiconsIcon
              icon={Delete02Icon}

              className="text-destructive"
            />
            <span className="text-destructive hover:text-destructive">
              {t('action.delete')}
            </span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </SidebarMenuItem>
  )
})

export function NavHistories() {
  const { t } = useTranslation('chat')
  const { data: history, isLoading } = useChatHistory()
  const { mutate: updateChat } = useUpdateChat()
  // `mutate` is stable, so the memoized rows do not re-render on this.
  const toggleFavorite = useCallback(
    (chat: Chat) => updateChat({ id: chat.id, favorite: !chat.favorite }),
    [updateChat]
  )

  // Each row shows its own relative age ("1d", "1w"…), so the sidebar no
  // longer buckets by date — just favourites, then everything else in the
  // API's newest-first order.
  const { favorite, chats } = useMemo(() => {
    const favorite: Chat[] = []
    const chats: Chat[] = []
    for (const chat of history ?? []) {
      ;(chat.favorite ? favorite : chats).push(chat)
    }
    return { favorite, chats }
  }, [history])

  if (isLoading) {
    return (
      <>
        <NavHistorySkeleton />
        <NavHistorySkeleton />
      </>
    )
  }

  if (!history?.length) {
    return (
      <SidebarGroup>
        <SidebarGroupContent>
          <div className="text-muted-foreground flex w-full flex-row items-center justify-center gap-2 px-2 text-sm">
            {t('sidebar.history.empty')}
          </div>
        </SidebarGroupContent>
      </SidebarGroup>
    )
  }

  return (
    <section>
      {favorite.length > 0 && (
        <SidebarGroup className="group-data-[collapsible=icon]:hidden">
          <SidebarMenu className="gap-1">
            <Collapsible defaultOpen>
              <SidebarGroupLabel className="text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground mb-1 text-sm">
                <CollapsibleTrigger className="group/trigger flex w-full items-center justify-between pl-0!">
                  <SidebarGroupLabel className="p-0">
                    {t('sidebar.history.favoritesGroup')}
                  </SidebarGroupLabel>
                  <HugeiconsIcon
                    icon={ArrowRight01Icon}

                    className="text-sidebar-foreground/50 h-4 w-4 transition-transform duration-200 group-data-panel-open/trigger:rotate-90"
                  />
                </CollapsibleTrigger>
              </SidebarGroupLabel>
              <CollapsibleContent>
                {favorite.map((chat) => (
                  <NavItems
                    chat={chat}
                    key={chat.id}
                    className="mb-1 last:mb-0"
                    onToggleFavorite={toggleFavorite}
                  />
                ))}
              </CollapsibleContent>
            </Collapsible>
          </SidebarMenu>
        </SidebarGroup>
      )}

      {chats.length > 0 && (
        <SidebarGroup className="group-data-[collapsible=icon]:hidden">
          <SidebarGroupLabel>{t('sidebar.history.chats')}</SidebarGroupLabel>
          <SidebarMenu className="gap-1">
            {chats.map((chat) => (
              <NavItems
                chat={chat}
                key={chat.id}
                onToggleFavorite={toggleFavorite}
              />
            ))}
          </SidebarMenu>
        </SidebarGroup>
      )}
    </section>
  )
}
