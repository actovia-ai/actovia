import { useCallback } from 'react'
import { useSearchParams } from 'react-router'

import { SettingsLabel } from '@/components/settings/settings-menu'

/**
 * `?tab=` slug ⇆ settings page. Slugs are the stable deep-link contract
 * (`#/settings?tab=mcp-servers`) — once shipped, never rename one.
 */
export const SETTINGS_TAB_SLUGS: Record<SettingsLabel, string> = {
  [SettingsLabel.General]: 'general',
  [SettingsLabel.Profile]: 'profile',
  [SettingsLabel.Personality]: 'personality',
  [SettingsLabel.Memory]: 'memory',
  [SettingsLabel.Discover]: 'discover',
  [SettingsLabel.Voice]: 'voice',
  [SettingsLabel.KeyboardShortcuts]: 'keyboard-shortcuts',
  [SettingsLabel.AiProviders]: 'ai-providers',
  [SettingsLabel.BuiltinTools]: 'builtin-tools',
  [SettingsLabel.DeepResearch]: 'deep-research',
  [SettingsLabel.FullTextSearch]: 'full-text-search',
  [SettingsLabel.KnowledgeBase]: 'knowledge-base',
  [SettingsLabel.ComputerUse]: 'computer-use',
  [SettingsLabel.Agents]: 'agents',
  [SettingsLabel.McpServers]: 'mcp-servers',
  [SettingsLabel.SkillsMarket]: 'skills-market',
  [SettingsLabel.DataControls]: 'data-controls',
  [SettingsLabel.AmazonS3]: 's3',
  [SettingsLabel.Logger]: 'logger',
  [SettingsLabel.ChatAudit]: 'chat-audit',
  [SettingsLabel.Devices]: 'devices',
  [SettingsLabel.AboutExodus]: 'about'
}

const SLUG_TO_LABEL = Object.fromEntries(
  Object.entries(SETTINGS_TAB_SLUGS).map(([label, slug]) => [slug, label])
) as Record<string, SettingsLabel>

/** Resolve a `?tab=` slug to a settings page; unknown or missing → General. */
export function settingsTabFromSlug(
  slug: string | null | undefined
): SettingsLabel {
  return (slug && SLUG_TO_LABEL[slug]) || SettingsLabel.General
}

/** Hash-router href that deep-links straight to a settings tab. */
export function settingsTabHref(label: SettingsLabel): string {
  return `#/settings?tab=${SETTINGS_TAB_SLUGS[label]}`
}

/**
 * The active settings tab, sourced from `?tab=` in the URL (so a link can land
 * on any tab). `setTab` replaces the history entry rather than pushing —
 * tab-hopping shouldn't stack up in history, and the sidebar's "Back to app"
 * must still exit Settings in one step.
 */
export function useSettingsTab(): [
  SettingsLabel,
  (label: SettingsLabel) => void
] {
  const [params, setParams] = useSearchParams()
  const active = settingsTabFromSlug(params.get('tab'))

  const setTab = useCallback(
    (label: SettingsLabel) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          next.set('tab', SETTINGS_TAB_SLUGS[label])
          return next
        },
        { replace: true }
      )
    },
    [setParams]
  )

  return [active, setTab]
}
