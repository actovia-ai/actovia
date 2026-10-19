/**
 * Skills: the on-disk install record (shared with `the Actovia CLI`, which writes
 * the same `~/.exodus/skills/.lock.json`) and the skills.sh registry shapes
 * the main process proxies to the renderer through `/api/v1/skills`.
 */

export interface InstalledSkill {
  slug: string
  displayName: string
  version: string
  isActive: boolean
  installPath: string
  installedAt: number
  /** Registry id (`owner/repo/slug`) — lets the app reopen the detail page. */
  registryId?: string
  /**
   * Registry the skill came from (`"skills.sh"`). Absent on entries written
   * by the ClawHub-era app or by hand — shown as "Legacy" in the UI.
   */
  source?: string
}

export interface SkillsLockfile {
  skills: Record<string, Omit<InstalledSkill, 'slug'>>
}

export type SkillsView = 'all-time' | 'trending' | 'hot'

/** One row of the registry list / search results. `id` is `owner/repo/slug`. */
export interface SkillListItem {
  id: string
  slug: string
  name: string
  source: string
  installs: number
  sourceType: string
  installUrl: string
  url: string
  /** Only on the `hot` / `trending` views. */
  installsYesterday?: number
  change?: number
}

export interface SkillListResponse {
  data: SkillListItem[]
  pagination: { page: number; perPage: number; total: number; hasMore: boolean }
}

/**
 * One publisher on the registry's curated list — a company or project that
 * maintains its own skills — with every skill it publishes.
 */
export interface SkillCuratedOwner {
  owner: string
  totalInstalls: number
  featuredRepo: string
  /** The slug of the skill the registry features for this owner. */
  featuredSkill: string
  skills: SkillListItem[]
}

export interface SkillCuratedResponse {
  data: SkillCuratedOwner[]
  totalOwners: number
  totalSkills: number
  generatedAt: string
}

export interface SkillSearchResponse {
  data: SkillListItem[]
  query: string
  searchType: 'fuzzy' | 'semantic'
  count: number
  durationMs: number
}

export type SkillAuditStatus = 'pass' | 'warn' | 'fail'

export interface SkillAuditEntry {
  provider: string
  slug: string
  status: SkillAuditStatus
  summary: string
  auditedAt: string
  riskLevel?: string
  categories?: string[]
}

export interface SkillAuditResponse {
  id: string
  source: string
  slug: string
  audits: SkillAuditEntry[]
}

export interface SkillFile {
  path: string
  contents: string
}

export interface SkillDetail {
  id: string
  source: string
  slug: string
  installs: number
  hash: string
  files: SkillFile[]
}
