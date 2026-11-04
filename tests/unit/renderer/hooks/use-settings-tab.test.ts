import { describe, expect, it } from 'vitest'

import { SettingsLabel } from '@/components/settings/settings-menu'
import {
  SETTINGS_TAB_SLUGS,
  settingsTabFromSlug,
  settingsTabHref
} from '@/hooks/use-settings-tab'

describe('settings tab slugs', () => {
  it('has a slug for every SettingsLabel', () => {
    for (const label of Object.values(SettingsLabel)) {
      expect(
        SETTINGS_TAB_SLUGS[label],
        `missing slug for ${label}`
      ).toBeTruthy()
    }
  })

  it('slugs are unique and url-safe', () => {
    const slugs = Object.values(SETTINGS_TAB_SLUGS)
    expect(new Set(slugs).size).toBe(slugs.length)
    for (const s of slugs) expect(s).toMatch(/^[a-z0-9-]+$/)
  })
})

describe('settingsTabFromSlug', () => {
  it('resolves a known slug to its page', () => {
    expect(settingsTabFromSlug('mcp-servers')).toBe(SettingsLabel.McpServers)
    expect(settingsTabFromSlug('ai-providers')).toBe(SettingsLabel.AiProviders)
  })

  it('falls back to General for unknown, empty, or missing slugs', () => {
    expect(settingsTabFromSlug('nope')).toBe(SettingsLabel.General)
    expect(settingsTabFromSlug('')).toBe(SettingsLabel.General)
    expect(settingsTabFromSlug(null)).toBe(SettingsLabel.General)
    expect(settingsTabFromSlug(undefined)).toBe(SettingsLabel.General)
  })

  it('round-trips with SETTINGS_TAB_SLUGS', () => {
    for (const label of Object.values(SettingsLabel)) {
      expect(settingsTabFromSlug(SETTINGS_TAB_SLUGS[label])).toBe(
        label === SettingsLabel.Agents ? SettingsLabel.Philharmonic : label
      )
    }
  })
})

describe('settingsTabHref', () => {
  it('builds a hash-router deep link', () => {
    expect(settingsTabHref(SettingsLabel.McpServers)).toBe(
      '#/settings?tab=mcp-servers'
    )
    expect(settingsTabHref(SettingsLabel.General)).toBe(
      '#/settings?tab=general'
    )
  })
})
