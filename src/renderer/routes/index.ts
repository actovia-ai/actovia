import { createHashRouter } from 'react-router'

import { RouteErrorBoundary } from '@/components/app/error-boundary'
import { Artifacts } from '@/containers/artifacts'
import { ChatDetail } from '@/containers/chat-detail'
import { Home } from '@/containers/home'
import { Layout as ChatLayout } from '@/layouts/chat-layout'

// Settings + Philharmonic are large feature surfaces (Monaco, recharts)
// that the user may never open. Defer them via React Router's `lazy` so chat —
// the default landing route — doesn't pay for their dependencies on cold start.
// HydrateFallback is required when the user lands directly on one of these
// hash routes; without it React Router warns and renders nothing.
const LazyRouteFallback = () => null

export const router = createHashRouter([
  {
    path: '/settings',
    HydrateFallback: LazyRouteFallback,
    ErrorBoundary: RouteErrorBoundary,
    lazy: () =>
      import('@/layouts/settings-layout').then((m) => ({
        Component: m.SettingsLayout
      }))
  },
  {
    // `/philharmonic`, `/philharmonic/groups/:id`, `/philharmonic/workforce`,
    // `/philharmonic/dashboard`: the page and the group are in the URL, so the
    // header's arrows step through them.
    path: '/philharmonic/*',
    HydrateFallback: LazyRouteFallback,
    ErrorBoundary: RouteErrorBoundary,
    lazy: () =>
      import('@/layouts/philharmonic-layout').then((m) => ({
        Component: m.PhilharmonicLayout
      }))
  },

  {
    Component: ChatLayout,
    ErrorBoundary: RouteErrorBoundary,
    children: [
      { path: '/', Component: Home },
      { path: '/artifacts', Component: Artifacts },
      {
        path: '/scheduled',
        lazy: () =>
          import('@/containers/scheduled').then((m) => ({
            Component: m.Scheduled
          }))
      },
      {
        path: '/chat/:id',
        Component: ChatDetail,
        ErrorBoundary: RouteErrorBoundary
      }
    ]
  }
])
