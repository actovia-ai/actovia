import {
  CloudIcon,
  CogIcon,
  DatabaseIcon,
  HammerIcon,
  InformationCircleIcon,
  KeyboardIcon,
  NetworkIcon,
  Scroll01Icon,
  ShoppingBagIcon,
  TelescopeIcon,
  UserIcon,
  Wrench01Icon,
  MousePointer2,
  CircleUserRound,
  MicIcon,
  CompassIcon,
  MonitorSmartphoneIcon,
  SparklesIcon,
  BrainCircuitIcon,
  CodeIcon
} from '@hugeicons/core-free-icons'
import type { ParseKeys } from 'i18next'

export enum SettingsLabel {
  Profile = 'Profile',
  General = 'General',
  Personality = 'Personality',
  AiProviders = 'AI Providers',
  AmazonS3 = 'AWS S3',
  McpServers = 'MCP Servers',
  SkillsMarket = 'Skills Market',
  KnowledgeBase = 'Knowledge Base',
  BuiltinTools = 'Built-in Tools',
  Memory = 'Memory',
  Discover = 'Discover',
  Voice = 'Voice',
  DeepResearch = 'Deep Research',
  ComputerUse = 'Computer Use',
  Agents = 'Agents',
  DataControls = 'Data Controls',
  Logger = 'Logger',
  ChatAudit = 'Chat Audit',
  Devices = 'Devices',
  KeyboardShortcuts = 'Keyboard Shortcuts',
  AboutExodus = 'About Exodus'
}

export type SettingsPage = SettingsLabel

/**
 * i18n key for each tab's display title, keyed by the same stable
 * `SettingsLabel` identifier already used for comparisons and deep-link
 * slugs (`SETTINGS_TAB_SLUGS` in `use-settings-tab.ts`). `SettingsLabel`'s
 * own string VALUES stay English display text used only as internal
 * comparison identifiers (`activeTitle === SettingsLabel.Profile` etc,
 * throughout the settings tree) — they are never rendered directly;
 * `settings-form.tsx` and `settings-sidebar.tsx` render
 * `t(NAV_TITLE_KEYS[label])` instead. `as const satisfies Record<...>`
 * keeps every value's exact literal key type (so
 * `t(NAV_TITLE_KEYS[x])` type-checks with no cast) while still forcing a
 * compile error if a member is missing or a key doesn't exist in the
 * catalog.
 */
export const NAV_TITLE_KEYS = {
  [SettingsLabel.Profile]: 'nav.profile.title',
  [SettingsLabel.General]: 'nav.general.title',
  [SettingsLabel.Personality]: 'nav.personality.title',
  [SettingsLabel.AiProviders]: 'nav.aiProviders.title',
  [SettingsLabel.AmazonS3]: 'nav.amazonS3.title',
  [SettingsLabel.McpServers]: 'nav.mcpServers.title',
  [SettingsLabel.SkillsMarket]: 'nav.skillsMarket.title',
  [SettingsLabel.KnowledgeBase]: 'nav.knowledgeBase.title',
  [SettingsLabel.BuiltinTools]: 'nav.builtinTools.title',
  [SettingsLabel.Memory]: 'nav.memory.title',
  [SettingsLabel.Discover]: 'nav.discover.title',
  [SettingsLabel.Voice]: 'nav.voice.title',
  [SettingsLabel.DeepResearch]: 'nav.deepResearch.title',
  [SettingsLabel.ComputerUse]: 'nav.computerUse.title',
  [SettingsLabel.Agents]: 'nav.agents.title',
  [SettingsLabel.DataControls]: 'nav.dataControls.title',
  [SettingsLabel.Logger]: 'nav.logger.title',
  [SettingsLabel.ChatAudit]: 'nav.chatAudit.title',
  [SettingsLabel.Devices]: 'nav.devices.title',
  [SettingsLabel.KeyboardShortcuts]: 'nav.keyboardShortcuts.title',
  [SettingsLabel.AboutExodus]: 'nav.about.title'
} as const satisfies Record<SettingsLabel, ParseKeys<'settings'>>

// Flat menu — every entry is a top-level page. The content-side Cards provide
// the visual grouping, so the sidebar has no expandable second level. The final
// group has no label — it holds "About", pinned to the bottom.
// `label` holds a settings.json key path (empty string for the unlabeled
// group), not display text — settings-sidebar.tsx renders `t(group.label)`.
export const menus = {
  navMain: [
    {
      label: 'nav.group.personal',
      items: [
        { title: SettingsLabel.General, icon: CogIcon },
        { title: SettingsLabel.Profile, icon: CircleUserRound },
        { title: SettingsLabel.Personality, icon: UserIcon },
        { title: SettingsLabel.Memory, icon: BrainCircuitIcon },
        { title: SettingsLabel.Discover, icon: CompassIcon },
        { title: SettingsLabel.Voice, icon: MicIcon },
        { title: SettingsLabel.KeyboardShortcuts, icon: KeyboardIcon }
      ]
    },
    {
      label: 'nav.group.aiTools',
      items: [
        { title: SettingsLabel.AiProviders, icon: SparklesIcon },
        { title: SettingsLabel.BuiltinTools, icon: Wrench01Icon },
        { title: SettingsLabel.DeepResearch, icon: TelescopeIcon }
      ]
    },
    {
      // External, connection-backed capabilities: the knowledge base, the
      // computer-use sandbox, MCP connectors, the skills marketplace — and
      // the devices allowed to connect to this one.
      label: 'nav.group.integrations',
      items: [
        { title: SettingsLabel.KnowledgeBase, icon: NetworkIcon },
        { title: SettingsLabel.ComputerUse, icon: MousePointer2 },
        { title: SettingsLabel.Agents, icon: CodeIcon },
        { title: SettingsLabel.McpServers, icon: HammerIcon },
        { title: SettingsLabel.SkillsMarket, icon: ShoppingBagIcon },
        { title: SettingsLabel.Devices, icon: MonitorSmartphoneIcon }
      ]
    },
    {
      // Where the user's data lives and how it moves in and out.
      label: 'nav.group.storage',
      items: [
        { title: SettingsLabel.DataControls, icon: DatabaseIcon },
        { title: SettingsLabel.AmazonS3, icon: CloudIcon }
      ]
    },
    {
      label: 'nav.group.developer',
      items: [
        { title: SettingsLabel.Logger, icon: Scroll01Icon },
        { title: SettingsLabel.ChatAudit, icon: DatabaseIcon }
      ]
    },
    {
      label: '',
      items: [{ title: SettingsLabel.AboutExodus, icon: InformationCircleIcon }]
    }
  ]
} as const
