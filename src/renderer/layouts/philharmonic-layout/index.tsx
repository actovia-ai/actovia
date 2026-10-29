import { useCallback } from 'react'
import { useLocation, useNavigate } from 'react-router'

import { SidebarProvider } from '@/components/ui/sidebar'
import { Toaster } from '@/components/ui/toast'
import { PhilharmonicContainer } from '@/containers/philharmonic'
import { useRouteHistoryRecorder } from '@/hooks/use-route-history'

export type PhilharmonicPage = 'chat' | 'workforce' | 'dashboard'

/** The page and the group a Philharmonic path names (`/philharmonic/groups/:id`, `/philharmonic/workforce`…). */
export function parsePhilharmonicPath(pathname: string): {
  page: PhilharmonicPage
  groupId: string | null
} {
  const [, , section, id] = pathname.split('/')
  if (section === 'workforce' || section === 'dashboard') {
    return { page: section, groupId: null }
  }
  return { page: 'chat', groupId: section === 'groups' && id ? id : null }
}

export function PhilharmonicLayout() {
  // Philharmonic is a page of the arrows' history too, now that its bars
  // carry them as Chat's do: each page and group is its own entry.
  useRouteHistoryRecorder()
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const { page, groupId } = parsePhilharmonicPath(pathname)

  const openPage = useCallback(
    (next: Exclude<PhilharmonicPage, 'chat'>) =>
      navigate(`/philharmonic/${next}`),
    [navigate]
  )
  const openGroup = useCallback(
    (id: string | null, options?: { replace?: boolean }) =>
      navigate(id ? `/philharmonic/groups/${id}` : '/philharmonic', options),
    [navigate]
  )

  return (
    // The tone is the conversation's (globals.css, "Where the tone stops"):
    // Philharmonic's pages are neutral, a group's transcript and composer
    // take it back (group-chat.tsx).
    <SidebarProvider
      className="h-screen overflow-hidden"
      data-tone-scope="neutral"
    >
      <PhilharmonicContainer
        activePage={page}
        groupId={groupId}
        onOpenPage={openPage}
        onOpenGroup={openGroup}
      />
      <Toaster />
    </SidebarProvider>
  )
}
