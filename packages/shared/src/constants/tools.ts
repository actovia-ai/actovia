import type { ParseKeys } from 'i18next'

import { TOOL_NAMES } from './tool-names'

export interface ToolMeta {
  key: string
  labelKey: ParseKeys<'settings'>
  descriptionKey: ParseKeys<'settings'>
  group: ToolGroup
}

export type ToolGroup = 'Web' | 'File System' | 'AI & Data' | 'Maps'

export const TOOL_REGISTRY: ToolMeta[] = [
  // Web
  {
    key: TOOL_NAMES.weather,
    labelKey: 'tools.registry.weather.label',
    descriptionKey: 'tools.registry.weather.description',
    group: 'Web'
  },
  {
    key: TOOL_NAMES.webSearch,
    labelKey: 'tools.registry.webSearch.label',
    descriptionKey: 'tools.registry.webSearch.description',
    group: 'Web'
  },
  {
    key: TOOL_NAMES.webFetch,
    labelKey: 'tools.registry.webFetch.label',
    descriptionKey: 'tools.registry.webFetch.description',
    group: 'Web'
  },

  // File System
  {
    key: TOOL_NAMES.terminal,
    labelKey: 'tools.registry.terminal.label',
    descriptionKey: 'tools.registry.terminal.description',
    group: 'File System'
  },
  {
    key: TOOL_NAMES.readFile,
    labelKey: 'tools.registry.readFile.label',
    descriptionKey: 'tools.registry.readFile.description',
    group: 'File System'
  },
  {
    key: TOOL_NAMES.writeFile,
    labelKey: 'tools.registry.writeFile.label',
    descriptionKey: 'tools.registry.writeFile.description',
    group: 'File System'
  },
  {
    key: TOOL_NAMES.editFile,
    labelKey: 'tools.registry.editFile.label',
    descriptionKey: 'tools.registry.editFile.description',
    group: 'File System'
  },
  {
    key: TOOL_NAMES.listDirectory,
    labelKey: 'tools.registry.listDirectory.label',
    descriptionKey: 'tools.registry.listDirectory.description',
    group: 'File System'
  },
  {
    key: TOOL_NAMES.findFiles,
    labelKey: 'tools.registry.findFiles.label',
    descriptionKey: 'tools.registry.findFiles.description',
    group: 'File System'
  },
  {
    key: TOOL_NAMES.grep,
    labelKey: 'tools.registry.grep.label',
    descriptionKey: 'tools.registry.grep.description',
    group: 'File System'
  },

  // AI & Data
  {
    key: TOOL_NAMES.imageGeneration,
    labelKey: 'tools.registry.imageGeneration.label',
    descriptionKey: 'tools.registry.imageGeneration.description',
    group: 'AI & Data'
  },
  {
    key: TOOL_NAMES.searchKnowledgeBase,
    labelKey: 'tools.registry.searchKnowledgeBase.label',
    descriptionKey: 'tools.registry.searchKnowledgeBase.description',
    group: 'AI & Data'
  },
  {
    key: TOOL_NAMES.updateMemory,
    labelKey: 'tools.registry.updateMemory.label',
    descriptionKey: 'tools.registry.updateMemory.description',
    group: 'AI & Data'
  },
  {
    key: TOOL_NAMES.recall,
    labelKey: 'tools.registry.recall.label',
    descriptionKey: 'tools.registry.recall.description',
    group: 'AI & Data'
  },

  {
    key: TOOL_NAMES.manageSchedule,
    labelKey: 'tools.registry.manageSchedule.label',
    descriptionKey: 'tools.registry.manageSchedule.description',
    group: 'AI & Data'
  },

  // Maps
  {
    key: TOOL_NAMES.mapItinerary,
    labelKey: 'tools.registry.mapItinerary.label',
    descriptionKey: 'tools.registry.mapItinerary.description',
    group: 'Maps'
  }
]

export const TOOL_GROUPS: ToolGroup[] = [
  'Web',
  'File System',
  'AI & Data',
  'Maps'
]

/**
 * i18n key for each group's section title, keyed by `ToolGroup` the same
 * way `settings-menu.ts`'s `NAV_TITLE_KEYS` keys off `SettingsLabel` —
 * `as const satisfies Record<...>` keeps each value's exact literal key
 * type so `t(GROUP_TITLE_KEYS[group])` type-checks with no cast.
 */
export const GROUP_TITLE_KEYS = {
  Web: 'tools.groups.web',
  'File System': 'tools.groups.fileSystem',
  'AI & Data': 'tools.groups.aiData',
  Maps: 'tools.groups.maps'
} as const satisfies Record<ToolGroup, ParseKeys<'settings'>>
