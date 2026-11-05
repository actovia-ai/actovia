import '@/assets/stylesheets/globals.css'
import type { Settings } from '@actovia/shared/schemas/settings-schema'
import type { PlanDto } from '@actovia/shared/types/philharmonic'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createRoot } from 'react-dom/client'
import { useForm } from 'react-hook-form'
import { I18nextProvider } from 'react-i18next'

import { ThemeProvider } from '@/components/app/theme-provider'
import { ArtifactCard } from '@/components/calling-tools/artifact/artifact-card'
import { WorkspaceFilePreview } from '@/components/calling-tools/workspace-file/workspace-file-preview'
import { MonitorCharts } from '@/components/philharmonic/dashboard/monitor-charts'
import { ComputerUse } from '@/components/settings/settings-form/computer-use'
import { WebAccessSettings } from '@/components/settings/settings-form/web-access'
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
              ) : location.search.includes('artifact') ? (
                <ArtifactCard
                  chatId="fixture"
                  toolResult={{
                    type: 'artifact',
                    title: 'Untrusted source',
                    artifactId: 'fixture',
                    code: '<script>window.__unsafeArtifact = true</script><h1>Source only</h1>'
                  }}
                />
              ) : (
                <WebAccessSettings />
              )}
            </div>
          </main>
        </ThemeProvider>
      </I18nextProvider>
    </QueryClientProvider>
  )
)
