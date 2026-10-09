import { SettingsSchema } from '@exodus/shared/schemas/settings-schema'
import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import { useSettings } from '@/hooks/use-settings'
import { useSettingsAutosave } from '@/hooks/use-settings-autosave'
import { useSettingsTab } from '@/hooks/use-settings-tab'
import { cn } from '@/lib/utils'

import { Agents } from './settings-form/agents'
import { ChatAudit } from './settings-form/chat-audit'
import { ComputerUse } from './settings-form/computer-use'
import { DataControls } from './settings-form/data-controls'
import { DeepResearch } from './settings-form/deep-research'
import { Devices } from './settings-form/devices'
import { Discover } from './settings-form/discover'
import { FullTextSearch } from './settings-form/full-text-search'
import { General } from './settings-form/generals'
import { KeyboardShortcuts } from './settings-form/keyboard-shortcuts'
import { KnowledgeBase } from './settings-form/knowledge-base'
import { Logger } from './settings-form/logger'
import { McpServers } from './settings-form/mcp-servers'
import { MemorySettings } from './settings-form/memory'
import { Personality } from './settings-form/personality'
import { Profile } from './settings-form/profile'
import { ProvidersTabs } from './settings-form/providers-tabs'
import { S3 } from './settings-form/s3'
import { SkillsMarketSetting } from './settings-form/skills-market'
import { SystemInfo } from './settings-form/system-info'
import { Tools } from './settings-form/tools'
import { Voice } from './settings-form/voice'
import { PAGE_ENTER } from './settings-kit'
import { NAV_TITLE_KEYS, SettingsLabel } from './settings-menu'

export function SettingsForm() {
  const { t } = useTranslation('settings')
  const { data: settings } = useSettings()
  const [activeTitle] = useSettingsTab()

  const form = useForm({
    resolver: zodResolver(SettingsSchema),
    values: settings,
    resetOptions: { keepDirtyValues: true }
  })

  // Per-field autosave. `flushNow` fires the pending save immediately so a text
  // input persists the instant focus leaves it (`onBlur` bubbles from any
  // input/textarea in the form); Switch/Select changes settle on their own.
  const { flushNow } = useSettingsAutosave(form)

  return (
    <form
      className="mx-auto flex w-full max-w-3xl flex-1 flex-col"
      onBlur={(e) => {
        const el = e.target as HTMLElement
        if (
          el.tagName === 'INPUT' ||
          el.tagName === 'TEXTAREA' ||
          el.isContentEditable
        ) {
          flushNow()
        }
      }}
    >
      {/* Keyed by tab, so each page arrives rather than cutting in. */}
      <div
        key={activeTitle}
        className={cn('flex flex-1 flex-col gap-8', PAGE_ENTER)}
      >
        <h1 className="text-xl">{t(NAV_TITLE_KEYS[activeTitle])}</h1>

        {activeTitle === SettingsLabel.Profile && <Profile form={form} />}

        {activeTitle === SettingsLabel.General && <General form={form} />}

        {activeTitle === SettingsLabel.Personality && (
          <Personality form={form} />
        )}

        {activeTitle === SettingsLabel.AiProviders && (
          <ProvidersTabs form={form} />
        )}

        {activeTitle === SettingsLabel.AmazonS3 && <S3 form={form} />}

        {activeTitle === SettingsLabel.Voice && <Voice form={form} />}

        {activeTitle === SettingsLabel.DeepResearch && (
          <DeepResearch form={form} />
        )}

        {activeTitle === SettingsLabel.Memory && <MemorySettings form={form} />}

        {activeTitle === SettingsLabel.Discover && <Discover form={form} />}

        {activeTitle === SettingsLabel.BuiltinTools && <Tools form={form} />}

        {activeTitle === SettingsLabel.SkillsMarket && <SkillsMarketSetting />}

        {activeTitle === SettingsLabel.McpServers && <McpServers />}

        {activeTitle === SettingsLabel.FullTextSearch && (
          <FullTextSearch form={form} />
        )}

        {activeTitle === SettingsLabel.KnowledgeBase && (
          <KnowledgeBase form={form} />
        )}

        {activeTitle === SettingsLabel.Agents && <Agents form={form} />}

        {activeTitle === SettingsLabel.ComputerUse && (
          <ComputerUse form={form} />
        )}

        {activeTitle === SettingsLabel.DataControls && <DataControls />}

        {activeTitle === SettingsLabel.Logger && <Logger />}

        {activeTitle === SettingsLabel.ChatAudit && <ChatAudit />}
        {activeTitle === SettingsLabel.Devices && <Devices />}

        {activeTitle === SettingsLabel.KeyboardShortcuts && (
          <KeyboardShortcuts />
        )}

        {activeTitle === SettingsLabel.AboutExodus && (
          <SystemInfo form={form} />
        )}
      </div>
    </form>
  )
}
