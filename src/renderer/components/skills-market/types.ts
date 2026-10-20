import type {
  InstalledSkill,
  SkillListItem,
  SkillsView
} from '@actovia/shared/types/skills'

/** The registry's leaderboard views, plus its curated publishers list. */
export type BrowseView = SkillsView | 'curated'
export const BROWSE_VIEWS: BrowseView[] = [
  'all-time',
  'trending',
  'hot',
  'curated'
]

/**
 * What the detail page needs before the registry answers: the id (to fetch),
 * the name and source (to paint the header immediately). Built from a list
 * row on Discover, or from a lockfile entry on Installed.
 */
export interface SkillRef {
  id: string
  name: string
  source: string
  installs?: number
  url?: string
  installUrl?: string
}

export function refFromListItem(item: SkillListItem): SkillRef {
  return {
    id: item.id,
    name: item.name,
    source: item.source,
    installs: item.installs,
    url: item.url,
    installUrl: item.installUrl
  }
}

/** `null` for entries the CLI-era or ClawHub-era lockfile wrote without an id. */
export function refFromInstalled(skill: InstalledSkill): SkillRef | null {
  if (!skill.registryId) return null
  return {
    id: skill.registryId,
    name: skill.displayName,
    source: skill.registryId.split('/').slice(0, 2).join('/')
  }
}

/** The lockfile keys skills by slug — the last segment of `owner/repo/slug`. */
export function slugOf(id: string): string {
  return id.split('/').pop() ?? id
}
