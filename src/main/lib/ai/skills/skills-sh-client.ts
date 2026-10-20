import { SKILLS_SH_BFF_URL } from '@actovia/shared/constants/external-urls'
import type {
  SkillAuditResponse,
  SkillCuratedResponse,
  SkillDetail,
  SkillListResponse,
  SkillSearchResponse,
  SkillsView
} from '@actovia/shared/types/skills'

/**
 * skills.sh registry client — a thin fetch wrapper around the BFF relay that
 * actovia-cli already talks to (same endpoints, same shapes). Kept free of
 * Electron/DB imports so it is unit-testable with a mocked `fetch`.
 */

export function resolveSkillsBffUrl(): string {
  return process.env.ACTOVIA_SKILLS_BFF_URL || SKILLS_SH_BFF_URL
}

export class SkillsApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.name = 'SkillsApiError'
    this.status = status
  }
}

async function request<T>(url: URL): Promise<T> {
  const res = await fetch(url)
  if (res.status === 404) throw new SkillsApiError(404, 'Not found')
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as {
      message?: string
    } | null
    throw new SkillsApiError(
      res.status,
      body?.message ?? `Request failed: ${res.status}`
    )
  }
  return (await res.json()) as T
}

export async function listSkills(
  opts: { view?: SkillsView; page?: number; perPage?: number } = {}
): Promise<SkillListResponse> {
  const url = new URL('/api/v1/skills', resolveSkillsBffUrl())
  if (opts.view) url.searchParams.set('view', opts.view)
  if (opts.page !== undefined) url.searchParams.set('page', String(opts.page))
  if (opts.perPage !== undefined)
    url.searchParams.set('per_page', String(opts.perPage))
  return request<SkillListResponse>(url)
}

export async function searchSkills(
  query: string,
  opts: { owner?: string; limit?: number } = {}
): Promise<SkillSearchResponse> {
  const url = new URL('/api/v1/skills/search', resolveSkillsBffUrl())
  url.searchParams.set('q', query)
  if (opts.owner) url.searchParams.set('owner', opts.owner)
  if (opts.limit !== undefined)
    url.searchParams.set('limit', String(opts.limit))
  return request<SkillSearchResponse>(url)
}

/** The curated publishers list. No parameters; ~2 MB, every skill of every owner. */
export async function listCuratedSkills(): Promise<SkillCuratedResponse> {
  const url = new URL('/api/v1/skills/curated', resolveSkillsBffUrl())
  return request<SkillCuratedResponse>(url)
}

/** `id` is `owner/repo/slug` — three path segments on the BFF. */
export async function getSkillDetail(id: string): Promise<SkillDetail> {
  const url = new URL(`/api/v1/skills/${id}`, resolveSkillsBffUrl())
  return request<SkillDetail>(url)
}

/** `null` when the registry has no audit for the skill (a 404 upstream). */
export async function getSkillAudit(
  id: string
): Promise<SkillAuditResponse | null> {
  const url = new URL(`/api/v1/skills/audit/${id}`, resolveSkillsBffUrl())
  try {
    return await request<SkillAuditResponse>(url)
  } catch (err) {
    if (err instanceof SkillsApiError && err.status === 404) return null
    throw err
  }
}
