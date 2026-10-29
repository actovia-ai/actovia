import type { CSSProperties } from 'react'

import { SettingsForm } from '@/components/settings/settings-form'
import { SettingsSidebar } from '@/components/settings/settings-sidebar'
import { SidebarProvider } from '@/components/ui/sidebar'
import { Toaster } from '@/components/ui/toast'
import { SIDEBAR_WIDTH } from '@/layouts/shared/resizable-sidebar'

export function SettingsLayout() {
  return (
    // As wide as Chat's sidebar (ISSUE-269); it does not resize.
    <SidebarProvider
      className="h-screen overflow-hidden"
      style={{ '--sidebar-width': SIDEBAR_WIDTH } as CSSProperties}
    >
      <SettingsSidebar />
      <main className="bg-background flex min-h-0 flex-1 flex-col overflow-hidden">
        {/* Frameless-window drag strip in place of a titlebar. */}
        <div className="draggable h-16 shrink-0" />
        <div className="relative flex-1 overflow-y-auto px-8 pb-10">
          <SettingsForm />
        </div>
      </main>
      <Toaster />
    </SidebarProvider>
  )
}
