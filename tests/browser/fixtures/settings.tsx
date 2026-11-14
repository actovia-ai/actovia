import '@/assets/stylesheets/globals.css'
import type { Settings } from '@actovia/shared/schemas/settings-schema'
import type { PlanDto } from '@actovia/shared/types/philharmonic'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createRoot } from 'react-dom/client'
import { useForm } from 'react-hook-form'
import { I18nextProvider } from 'react-i18next'
import { BrowserRouter } from 'react-router'

import { ThemeProvider } from '@/components/app/theme-provider'
import { ArtifactCard } from '@/components/calling-tools/artifact/artifact-card'
import { WorkspaceFilePreview } from '@/components/calling-tools/workspace-file/workspace-file-preview'
import { LibraryPreview } from '@/components/library/library-preview'
import { MonitorCharts } from '@/components/philharmonic/dashboard/monitor-charts'
import { ComputerUse } from '@/components/settings/settings-form/computer-use'
import { General } from '@/components/settings/settings-form/generals'
import { WebAccessSettings } from '@/components/settings/settings-form/web-access'
import { SettingsSidebar } from '@/components/settings/settings-sidebar'
import { Button } from '@/components/ui/button'
import { SidebarProvider } from '@/components/ui/sidebar'
import { i18n, i18nReady } from '@/lib/i18n'
const client = new QueryClient({
  defaultOptions: { queries: { retry: false } }
})

// Real Settings controls, with example values isolated from the owner's app.
function ComputerUseExample() {
  const form = useForm<Settings>({
    defaultValues: {
      computerUse: {
        enabled: true,
        targetAllowlist: ['Notes', 'Calendar'],
        maxSteps: 25,
        browser: { enabled: true, headed: false, maxSteps: 100 }
      }
    }
  })
  return (
    <div className="flex flex-col gap-8">
      <h1 className="text-xl font-semibold">Computer &amp; Browser Use</h1>
      <ComputerUse form={form} />
    </div>
  )
}

// Real General settings and navigation; the form is local to this fixture.
function ColorToneExample() {
  const form = useForm<Settings>({
    defaultValues: { colorTone: 'neutral', language: 'auto' }
  })
  return (
    <BrowserRouter>
      <SidebarProvider className="h-screen">
        <SettingsSidebar />
        <main className="bg-background text-foreground h-screen min-w-0 flex-1 overflow-auto px-12 py-16">
          <div className="mx-auto flex max-w-3xl flex-col gap-8">
            <h1 className="text-xl font-semibold">General</h1>
            <General form={form} />
            <div className="flex items-center gap-4">
              <Button>Save changes</Button>
              <Button variant="outline">Cancel</Button>
              <Button variant="link">Learn more</Button>
            </div>
            <div className="bg-bubble ml-auto max-w-md rounded-2xl px-4 py-3 text-sm">
              The accent stays in the conversation. Cards and page backgrounds
              stay neutral.
            </div>
          </div>
        </main>
      </SidebarProvider>
    </BrowserRouter>
  )
}

const plans: PlanDto[] = ['completed', 'active', 'aborted'].map(
  (status, index) => ({
    id: String(index),
    conversationId: 'demo',
    summary: 'Example plan',
    status: status as PlanDto['status'],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    steps: []
  })
)
void i18nReady.then(() =>
  createRoot(document.getElementById('root')!).render(
    <QueryClientProvider client={client}>
      <I18nextProvider i18n={i18n}>
        <ThemeProvider connected={false}>
          {location.search.includes('color-tone') ? (
            <ColorToneExample />
          ) : (
            <main className="bg-background text-foreground min-h-screen p-8">
              <div className="mx-auto max-w-3xl">
                {location.search.includes('computer-use') ? (
                  <ComputerUseExample />
                ) : location.search.includes('dashboard') ? (
                  <MonitorCharts
                    plans={location.search.includes('empty') ? [] : plans}
                  />
                ) : location.search.includes('workspace') ? (
                  <WorkspaceFilePreview
                    path="notes.md"
                    chatId="fixture-chat"
                    open
                    onOpenChange={() => {}}
                  />
                ) : location.search.includes('library') ? (
                  <LibraryPreview
                    chatId="fixture"
                    artifactId="fixture"
                    title="Library artifact"
                  />
                ) : location.search.includes('artifact') ? (
                  <ArtifactCard
                    chatId="fixture"
                    toolResult={{
                      type: 'artifact',
                      title: 'Untrusted source',
                      artifactId: 'fixture',
                      code: `import React, { useState } from 'react'
export default function Artifact() {
  const [count, setCount] = useState(0)
  let isolated = false
  try { void window.parent.document } catch { isolated = true }
  return <main><h1>Interactive artifact</h1><p>{isolated ? 'Parent isolated' : 'Unsafe parent'}</p><button onClick={() => setCount(count + 1)}>Count {count}</button></main>
}`
                    }}
                  />
                ) : (
                  <WebAccessSettings />
                )}
              </div>
            </main>
          )}
        </ThemeProvider>
      </I18nextProvider>
    </QueryClientProvider>
  )
)
