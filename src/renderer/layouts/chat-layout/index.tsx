import { IS_WEB_CLIENT } from '@actovia/shared/constants/systems'
import type { CSSProperties } from 'react'
import { Outlet, useMatch } from 'react-router'

import { HeaderSidebarTrigger } from '@/components/app/update-ready'
import { ChatHeader } from '@/components/chat/header/chat-header'
import { HistoryArrows } from '@/components/chat/header/history-arrows'
import { ChatPanel } from '@/components/chat/panel/chat-panel'
import { DeepResearchProcess } from '@/components/deep-research'
import {
  SidebarInset,
  SidebarProvider,
  useSidebar
} from '@/components/ui/sidebar'
import { Toaster } from '@/components/ui/toast'
import { useIsFullscreen } from '@/hooks/use-is-full-screen'
import { useKeyboardShortcuts } from '@/hooks/use-keyboard-shortcuts'
import { useRouteHistoryRecorder } from '@/hooks/use-route-history'
import { ResizableSidebarShell } from '@/layouts/shared/resizable-sidebar'
import { cn } from '@/lib/utils'

import { AppSidebar } from './app-sidebar'
import { ChatDeletionConfirmationDialog } from './chat-deletion-confirmation-dialog'
import { RenameChatDialog } from './rename-chat-dialog'
import { SearchDialog } from './search-dialog'

function ContentHeader({ chat }: { chat: boolean }) {
  const { open } = useSidebar()
  const isFullscreen = useIsFullscreen()
  if (!chat && open) {
    return (
      <div
        aria-hidden
        className="draggable absolute inset-x-0 top-0 z-10 h-6"
      />
    )
  }
  return (
    <header
      className={cn(
        // Chat content scrolls behind the material. Pages without toolbar
        // content retain only the controls needed when their sidebar is closed.
        'draggable z-30 flex h-11 shrink-0 items-center gap-1 pt-0.5 pr-3 transition-[padding] duration-200 ease-out',
        chat
          ? 'bg-card/70 absolute inset-x-0 top-0 backdrop-blur-xl'
          : 'relative bg-transparent',
        open ? 'pl-1' : IS_WEB_CLIENT || isFullscreen ? 'pl-4' : 'pl-23'
      )}
    >
      {/* While the sidebar is open its toggle and the history arrows sit in
          the sidebar's own top row, by the traffic lights (as Notes and
          ChatGPT keep the toggle); they come here only once the sidebar is
          away, so it can be brought back. The header stays a drag region:
          every control in it is `no-drag`. */}
      {!open && (
        <>
          <HeaderSidebarTrigger />
          <HistoryArrows />
        </>
      )}
      {chat && <ChatHeader />}
    </header>
  )
}

function InsertedSidebar() {
  const chat = useMatch('/chat/:id') !== null
  return (
    <SidebarInset
      className="relative flex h-full min-w-0 flex-col overflow-hidden"
      style={
        { '--chat-header-inset': chat ? '2.75rem' : '0rem' } as CSSProperties
      }
    >
      <ContentHeader chat={chat} />
      <Outlet />
      <Toaster />
      <SearchDialog />
      <RenameChatDialog />
      <ChatDeletionConfirmationDialog />
    </SidebarInset>
  )
}

function ChatWorkspace() {
  return (
    <ResizableSidebarShell id="chat" sidebar={<AppSidebar />}>
      <InsertedSidebar />
    </ResizableSidebarShell>
  )
}

export function Layout() {
  // The pages shown, for the header's arrows; and the central keyboard
  // shortcuts (Mod+N, Mod+W, Mod+[, Mod+], Mod+,, Mod+Shift+F, Escape, etc.).
  useRouteHistoryRecorder()
  useKeyboardShortcuts()

  return (
    <SidebarProvider className="h-screen overflow-hidden">
      <ChatWorkspace />
      <DeepResearchProcess />
      <ChatPanel />
    </SidebarProvider>
  )
}
