import type {
  InstalledSkill,
  SkillAuditResponse,
  SkillCuratedResponse,
  SkillDetail,
  SkillListResponse,
  SkillSearchResponse,
  SkillsView
} from '@exodus/shared/types/skills'
import { fetcher } from '@exodus/shared/utils/http'

const BASE = '/api/v1/skills'

export const REGISTRY_PAGE_SIZE = 24

export const INSTALLED_SKILLS_URL = `${BASE}/installed`
export const CURATED_URL = `${BASE}/curated`

export function registryUrl(view: SkillsView, page: number): string {
  return `${BASE}/registry?view=${view}&page=${page}&per_page=${REGISTRY_PAGE_SIZE}`
}

export function searchUrl(query: string): string {
  return `${BASE}/search?q=${encodeURIComponent(query)}&limit=40`
}

export function detailUrl(id: string): string {
  return `${BASE}/detail?id=${encodeURIComponent(id)}`
}

export function auditUrl(id: string): string {
  return `${BASE}/audit?id=${encodeURIComponent(id)}`
}

export type { InstalledSkill, SkillAuditResponse, SkillDetail }
export type { SkillListResponse, SkillSearchResponse }

export const getSkillsRegistry = (view: SkillsView, page: number) =>
  fetcher<SkillListResponse>(registryUrl(view, page))

export const searchSkills = (query: string) =>
  fetcher<SkillSearchResponse>(searchUrl(query))

export const getSkillDetail = (id: string) =>
  fetcher<SkillDetail>(detailUrl(id))

/** `null` when the registry has no audit for the skill. */
export const getSkillAudit = (id: string) =>
  fetcher<SkillAuditResponse | null>(auditUrl(id))

export const getCuratedSkills = () => fetcher<SkillCuratedResponse>(CURATED_URL)

export const getInstalledSkills = () =>
  fetcher<InstalledSkill[]>(INSTALLED_SKILLS_URL)

export const installSkill = (id: string) =>
  fetcher<InstalledSkill>(`${BASE}/install`, { method: 'POST', body: { id } })

export const uninstallSkill = (slug: string) =>
  fetcher<{ success: true }>(`${BASE}/${encodeURIComponent(slug)}`, {
    method: 'DELETE'
  })

export const toggleSkill = (slug: string, isActive: boolean) =>
  fetcher<{ success: true }>(`${BASE}/${encodeURIComponent(slug)}/toggle`, {
    method: 'PATCH',
    body: { isActive }
  })

/** The actovia-cli equivalent of the Install button, shown on every detail page. */
export function cliInstallCommand(id: string): string {
  return `actovia skills install ${id}`
}
