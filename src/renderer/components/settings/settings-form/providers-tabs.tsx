import { UseFormReturnType } from '@actovia/shared/schemas/settings-schema'
import { AiProviders } from '@actovia/shared/types/ai'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

import { SettingsSection } from '../settings-row'
import { ProviderConfig } from './provider-config'
import { AnthropicClaude } from './providers/anthropic-claude'
import { AzureOpenAi } from './providers/azure-openai'
import { GoogleGemini } from './providers/google-gemini'
import { Ollama } from './providers/ollama'
import { OpenAiGpt } from './providers/openai-gpt'
import { XaiGrok } from './providers/xai-grok'

const PROVIDER_TABS = [
  { value: 'openai', label: 'OpenAI', Component: OpenAiGpt },
  { value: 'azure', label: 'Azure', Component: AzureOpenAi },
  { value: 'claude', label: 'Claude', Component: AnthropicClaude },
  { value: 'gemini', label: 'Gemini', Component: GoogleGemini },
  { value: 'grok', label: 'Grok', Component: XaiGrok },
  { value: 'ollama', label: 'Ollama', Component: Ollama }
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
          <TabsList className="w-full">
            {PROVIDER_TABS.map((t) => (
              <TabsTrigger key={t.value} value={t.value}>
                {t.label}
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
