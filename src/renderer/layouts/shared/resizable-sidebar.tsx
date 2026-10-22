import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { PanelImperativeHandle } from 'react-resizable-panels'

import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup
} from '@/components/ui/resizable'
import { useSidebar } from '@/components/ui/sidebar'

// Initial + minimum sidebar width; matches SIDEBAR_WIDTH in
// components/ui/sidebar.tsx (the shadcn `--sidebar-width` CSS var).
const SIDEBAR_WIDTH = '16rem'
const SIDEBAR_MAX_WIDTH = '30rem'
/** How long a toggle (Cmd+B, the trigger) takes to slide the sidebar. */
const TOGGLE_MS = 200

/**
 * The resizable `[ sidebar | content ]` shell shared by the Chat and
 * Philharmonic surfaces, driven by `react-resizable-panels`.
 *
 * The sidebar panel's collapsed state is mirrored onto the `SidebarProvider`
 * context so Cmd+B and `SidebarTrigger` keep working: Cmd+B flips `open` and
 * the effect collapses/expands the panel; a drag past the min width collapses
 * the panel and `onResize` flips `open` back.
 *
 * `id` namespaces the two panels as `<id>-sidebar` / `<id>-content` — keep it
 * stable; `#chat-sidebar` is asserted by `tests/e2e/sidebar.spec.ts`.
 */
export function ResizableSidebarShell({
  id,
  sidebar,
  children
}: {
  id: string
  sidebar: ReactNode
  children: ReactNode
}) {
  const { open, setOpen } = useSidebar()
  const sidebarPanel = useRef<PanelImperativeHandle>(null)
  const wasCollapsed = useRef(false)
  // True only for the length of a toggle. The library sizes the panels with
  // an inline flex-grow, so a transition on that property slides the sidebar
  // — but only while toggling: during a drag the pointer sets the width and a
  // transition would lag behind it. flex-grow is a layout property, the one
  // deliberate exception here: the alternative is a 16rem teleport.
  const [toggling, setToggling] = useState(false)

  useEffect(() => {
    const panel = sidebarPanel.current
    if (!panel) return
    const collapsed = panel.isCollapsed()
    if (open === !collapsed) return
    setToggling(true)
    // The attribute must be on the element before the size changes, or the
    // first frame jumps; React commits the state before this effect's
    // sibling effects run, so defer the resize by a frame.
    const frame = requestAnimationFrame(() => {
      if (open) panel.expand()
      else panel.collapse()
    })
    const done = setTimeout(() => setToggling(false), TOGGLE_MS + 50)
    return () => {
      cancelAnimationFrame(frame)
      clearTimeout(done)
    }
  }, [open])

  return (
    <div className="h-full w-full overflow-hidden">
      {/* Both panels transition, or the content would snap to its new share
          while the sidebar was still on its way. */}
      <ResizablePanelGroup
        orientation="horizontal"
        data-toggling={toggling || undefined}
        className="data-toggling:[&>[data-panel]]:transition-[flex-grow] data-toggling:[&>[data-panel]]:duration-200 data-toggling:[&>[data-panel]]:ease-out motion-reduce:[&>[data-panel]]:transition-none"
      >
        <ResizablePanel
          id={`${id}-sidebar`}
          panelRef={sidebarPanel}
          collapsible
          collapsedSize={0}
          defaultSize={SIDEBAR_WIDTH}
          minSize={SIDEBAR_WIDTH}
          maxSize={SIDEBAR_MAX_WIDTH}
          groupResizeBehavior="preserve-pixel-size"
          onResize={(size) => {
            // Mirror a drag-collapse / drag-open onto the sidebar context.
            const collapsed = size.asPercentage === 0
            if (collapsed === wasCollapsed.current) return
            wasCollapsed.current = collapsed
            setOpen(!collapsed)
          }}
        >
          {sidebar}
        </ResizablePanel>
        {/* In dark the border token reads as a bright hairline between the sidebar's material and the pane
            (owner, 2026-10-22); light keeps the token. */}
        <ResizableHandle className="dark:bg-white/[0.06]" />
        <ResizablePanel id={`${id}-content`}>{children}</ResizablePanel>
      </ResizablePanelGroup>
    </div>
  )
}
