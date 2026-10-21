import { UseFormReturnType } from '@actovia/shared/schemas/settings-schema'
import { AiProviders } from '@actovia/shared/types/ai'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

import { SettingsSection } from '../settings-row'
import { PROVIDER_LABELS, ProviderConfig } from './provider-config'
import { AnthropicClaude } from './providers/anthropic-claude'
import { AzureOpenAi } from './providers/azure-openai'
import { GoogleGemini } from './providers/google-gemini'
import { Ollama } from './providers/ollama'
import { OpenAiGpt } from './providers/openai-gpt'
import { XaiGrok } from './providers/xai-grok'

const PROVIDER_TABS = [
  { value: 'openai', provider: AiProviders.OpenAiGpt, Component: OpenAiGpt },
  { value: 'azure', provider: AiProviders.AzureOpenAi, Component: AzureOpenAi },
  {
    value: 'claude',
    provider: AiProviders.AnthropicClaude,
    Component: AnthropicClaude
  },
  {
    value: 'gemini',
    provider: AiProviders.GoogleGemini,
    Component: GoogleGemini
  },
  { value: 'grok', provider: AiProviders.XaiGrok, Component: XaiGrok },
  { value: 'ollama', provider: AiProviders.Ollama, Component: Ollama }
] as const

type ProviderTab = (typeof PROVIDER_TABS)[number]['value']

/**
 * Maps the "Provider" dropdown selection (an `AiProviders` enum value) onto
 * the matching "Provider keys" tab, so picking a provider above jumps the
 * tabs below straight to its key fields.
 */
const PROVIDER_TO_TAB: Record<AiProviders, ProviderTab> = {
  [AiProviders.OpenAiGpt]: 'openai',
  [AiProviders.AzureOpenAi]: 'azure',
  [AiProviders.AnthropicClaude]: 'claude',
  [AiProviders.GoogleGemini]: 'gemini',
  [AiProviders.XaiGrok]: 'grok',
  [AiProviders.Ollama]: 'ollama'
}

export function ProvidersTabs({ form }: { form: UseFormReturnType }) {
  const { t } = useTranslation('settings')
  const provider = form.watch('providerConfig.provider')
  const [tab, setTab] = useState<ProviderTab>(
    () => PROVIDER_TO_TAB[provider as AiProviders] ?? 'openai'
  )

  // Follow the Provider dropdown: selecting a provider above jumps the key
  // tabs to it. Manual tab clicks still work — this only reacts when the
  // dropdown value itself changes.
  useEffect(() => {
    const next = PROVIDER_TO_TAB[provider as AiProviders]
    if (next) setTab(next)
  }, [provider])

  return (
    <div className="flex flex-col gap-8">
      <ProviderConfig form={form} />

      <SettingsSection title={t('providers.keys.sectionTitle')} plain>
        <Tabs
          value={tab}
          onValueChange={(value) => setTab(value as ProviderTab)}
          className="gap-5"
        >
          <p className="text-muted-foreground px-1 text-sm">
            {t('providers.keys.description')}
          </p>
          <TabsList className="w-full">
            {PROVIDER_TABS.map((tab) => (
              <TabsTrigger key={tab.value} value={tab.value}>
                {PROVIDER_LABELS[tab.provider]}
                {tab.provider === provider && (
                  <>
                    <span
                      aria-hidden="true"
                      title={t('providers.keys.inUse')}
                      className="bg-primary-ink size-1.5 shrink-0 rounded-full"
                    />
                    <span className="sr-only">{t('providers.keys.inUse')}</span>
                  </>
                )}
              </TabsTrigger>
            ))}
          </TabsList>
          {PROVIDER_TABS.map(({ value, Component }) => (
            <TabsContent
              key={value}
              value={value}
              className="flex flex-col gap-5"
            >
              <Component form={form} />
            </TabsContent>
          ))}
        </Tabs>
      </SettingsSection>
    </div>
  )
}
