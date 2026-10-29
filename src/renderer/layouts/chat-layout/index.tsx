import { Outlet } from 'react-router'

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

function ContentHeader() {
  const { open } = useSidebar()
  const isFullscreen = useIsFullscreen()
  return (
    <header
      className={cn(
        // 44 px, the sidebar's own top row's height, so the toggle sits at the
        // same spot in both (Claude's bar is this low). No rule under it: the
        // page dissolves into the header's colour as it scrolls under — a
        // strip of that colour fading to nothing, as Claude's, not a dark
        // shadow (owner, 2026-10-08).
        // `pt-0.5` and `pl-23` put the toggle where the sidebar's own row has
        // it (app-sidebar.tsx: the header's `p-2` with `pt-2.25`, the row's
        // `pl-21` and `h-7`): 92 px in, centred 23 px down — level with the
        // traffic lights (window.ts, y 16) and 20 px clear of them.
        'draggable bg-card/80 relative z-10 flex h-11 shrink-0 items-center gap-1 rounded-tl-xl pt-0.5 pr-3 backdrop-blur-sm transition-[padding] duration-200 ease-out',
        'after:pointer-events-none after:absolute after:inset-x-0 after:top-full after:h-5 after:bg-linear-to-b after:from-card after:to-transparent',
        open ? 'pl-1' : isFullscreen ? 'pl-4' : 'pl-23'
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
      <ChatHeader />
    </header>
  )
}

function InsertedSidebar() {
  return (
    <SidebarInset className="flex h-full min-w-0 flex-col overflow-hidden">
      <ContentHeader />
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
