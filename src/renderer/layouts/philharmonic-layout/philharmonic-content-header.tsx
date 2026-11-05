import { IS_WEB_CLIENT } from '@actovia/shared/constants/systems'
import {
  createContext,
  useContext,
  useState,
  type ReactNode,
  type CSSProperties
} from 'react'
import { createPortal } from 'react-dom'

import { HeaderSidebarTrigger } from '@/components/app/update-ready'
import { NewGroupButton } from '@/components/philharmonic/chat/new-group-button'
import { useSidebar } from '@/components/ui/sidebar'
import { useIsFullscreen } from '@/hooks/use-is-full-screen'
import { cn } from '@/lib/utils'

/** Group configuration toolbar; empty pages retain only a transparent drag region.
 * Controls are no-drag and return to this bar when the sidebar is closed.
 */
export function PhilharmonicContentHeader({
  children,
  className,
  onCreateGroup,
  empty = false
}: {
  children?: ReactNode
  className?: string
  empty?: boolean
  /** New group, beside the toggle while the sidebar is away (as its top row has it). */
  onCreateGroup: () => void
}) {
  const { open } = useSidebar()
  const isFullscreen = useIsFullscreen()

  if (empty && open) {
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
        'draggable absolute inset-x-0 top-0 z-30 flex h-11 shrink-0 items-center gap-1 pt-0.5 pr-3 transition-[padding] duration-200 ease-out',
        empty ? 'bg-transparent' : 'bg-card/70 backdrop-blur-xl',
        open ? 'pl-1' : IS_WEB_CLIENT || isFullscreen ? 'pl-4' : 'pl-23',
        className
      )}
    >
      {!open && (
        <>
          <HeaderSidebarTrigger />
          <NewGroupButton onCreate={onCreateGroup} />
        </>
      )}
      {children}
    </header>
  )
}

const HeaderSlotContext = createContext<HTMLElement | null>(null)

/**
 * The config pages' (Workforce, Dashboard) bar, with a slot a page fills
 * through `PhilharmonicHeaderSlot` — the page keeps its title and buttons
 * with its own state, and they show in the one bar instead of a second
 * header under it.
 */
export function PhilharmonicSlottedHeader({
  children,
  onCreateGroup,
  empty = false
}: {
  children: ReactNode
  onCreateGroup: () => void
  empty?: boolean
}) {
  const [slot, setSlot] = useState<HTMLElement | null>(null)
  const { open } = useSidebar()
  return (
    <HeaderSlotContext.Provider value={slot}>
      <div
        className="relative flex min-h-0 flex-1 flex-col"
        style={
          {
            '--philharmonic-header-inset': empty && open ? '0rem' : '2.75rem'
          } as CSSProperties
        }
      >
        <PhilharmonicContentHeader onCreateGroup={onCreateGroup} empty={empty}>
          <div
            ref={setSlot}
            className="flex min-w-0 flex-1 items-center gap-2 self-stretch"
          />
        </PhilharmonicContentHeader>
        {children}
      </div>
    </HeaderSlotContext.Provider>
  )
}

/** Renders its children into the content header's slot (nothing outside a `PhilharmonicSlottedHeader`). */
export function PhilharmonicHeaderSlot({ children }: { children: ReactNode }) {
  const slot = useContext(HeaderSlotContext)
  return slot ? createPortal(children, slot) : null
}
