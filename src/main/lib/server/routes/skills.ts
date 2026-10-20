import { ErrorCode } from '@actovia/shared/constants/error-codes'
import {
  isAppError,
  NotFoundError,
  RateLimitError,
  ServiceError,
  ValidationError
} from '@actovia/shared/errors/app-error'
import type { SkillsView } from '@actovia/shared/types/skills'
import { Hono } from 'hono'
import { z } from 'zod'

import {
  getSkillAudit,
  getSkillDetail,
  listCuratedSkills,
  listSkills,
  searchSkills,
  SkillsApiError
} from '../../ai/skills/skills-sh-client'
import {
  installSkill,
  listInstalledSkills,
  toggleSkillActive,
  uninstallSkill
} from '../../ai/skills/skills-store'
import { logger } from '../../logger'
import type { Variables } from '../types'
import { successResponse } from '../utils'

/**
 * `/api/v1/skills` — the skills.sh marketplace (browse / search / curated /
 * detail / audit) plus the local install store. Skill ids are `owner/repo/slug`, so
 * the registry endpoints take them as `?id=` rather than a path segment.
 */
const skillsRouter = new Hono<{ Variables: Variables }>()

const VIEWS: SkillsView[] = ['all-time', 'trending', 'hot']

const IdSchema = z.object({ id: z.string().trim().min(1) })
const ToggleSchema = z.object({ isActive: z.boolean() })

/** Upstream failures → typed AppErrors the renderer can translate. */
function toRegistryError(err: unknown): never {
  if (isAppError(err)) throw err
  if (err instanceof SkillsApiError) {
    if (err.status === 404) throw new NotFoundError(ErrorCode.SKILL_NOT_FOUND)
    if (err.status === 429)
      throw new RateLimitError(ErrorCode.RATE_LIMIT_SKILLS)
    throw new ServiceError(
      ErrorCode.SERVICE_SKILLS_REGISTRY_FAILED,
      err.message
    )
  }
  logger.warn('skills', 'registry request failed', { error: err })
  throw new ServiceError(ErrorCode.SERVICE_SKILLS_REGISTRY_FAILED)
}

function parseIntParam(value: string | undefined, fallback: number): number {
  const n = Number.parseInt(value ?? '', 10)
  return Number.isFinite(n) && n >= 0 ? n : fallback
}

function requireId(raw: string | undefined): string {
  const parsed = IdSchema.safeParse({ id: raw })
  if (!parsed.success) {
    throw new ValidationError(ErrorCode.VALIDATION_MISSING_FIELD, undefined, {
      field: 'id'
    })
  }
  return parsed.data.id
}

// GET /registry?view=all-time|trending|hot&page=0&per_page=24
skillsRouter.get('/registry', async (c) => {
  const rawView = c.req.query('view')
  const view = VIEWS.includes(rawView as SkillsView)
    ? (rawView as SkillsView)
    : 'all-time'
  const page = parseIntParam(c.req.query('page'), 0)
  const perPage = Math.min(parseIntParam(c.req.query('per_page'), 24), 100)
  try {
    return successResponse(c, await listSkills({ view, page, perPage }))
  } catch (err) {
    toRegistryError(err)
  }
})

// GET /search?q=react&limit=40
skillsRouter.get('/search', async (c) => {
  const q = (c.req.query('q') ?? '').trim()
  if (!q) {
    throw new ValidationError(ErrorCode.VALIDATION_MISSING_FIELD, undefined, {
      field: 'q'
    })
  }
  const limit = Math.min(parseIntParam(c.req.query('limit'), 40), 100)
  try {
    return successResponse(c, await searchSkills(q, { limit }))
  } catch (err) {
    toRegistryError(err)
  }
})

// GET /curated — publishers with every skill they maintain
skillsRouter.get('/curated', async (c) => {
  try {
    return successResponse(c, await listCuratedSkills())
  } catch (err) {
    toRegistryError(err)
  }
})

// GET /detail?id=owner/repo/slug
skillsRouter.get('/detail', async (c) => {
  const id = requireId(c.req.query('id'))
  try {
    return successResponse(c, await getSkillDetail(id))
  } catch (err) {
    toRegistryError(err)
  }
})

// GET /audit?id=owner/repo/slug — `null` when no audit exists
skillsRouter.get('/audit', async (c) => {
  const id = requireId(c.req.query('id'))
  try {
    return successResponse(c, await getSkillAudit(id))
  } catch (err) {
    toRegistryError(err)
  }
})

// GET /installed — the lockfile, as a list
skillsRouter.get('/installed', async (c) => {
  return successResponse(c, await listInstalledSkills())
})

// POST /install { id } — fetch the files from the registry and write them
skillsRouter.post('/install', async (c) => {
  const parsed = IdSchema.safeParse(await c.req.json().catch(() => ({})))
  if (!parsed.success) {
    throw new ValidationError(ErrorCode.VALIDATION_MISSING_FIELD, undefined, {
      field: 'id'
    })
  }
  let detail
  try {
    detail = await getSkillDetail(parsed.data.id)
  } catch (err) {
    toRegistryError(err)
  }
  const installed = await installSkill(detail)
  logger.info('skills', 'installed', {
    slug: installed.slug,
    version: installed.version
  })
  return successResponse(c, installed, 201)
})

// DELETE /:slug
skillsRouter.delete('/:slug', async (c) => {
  const slug = c.req.param('slug')
  await uninstallSkill(slug)
  logger.info('skills', 'uninstalled', { slug })
  return successResponse(c, { success: true })
})

// PATCH /:slug/toggle { isActive }
skillsRouter.patch('/:slug/toggle', async (c) => {
  const slug = c.req.param('slug')
  const parsed = ToggleSchema.safeParse(await c.req.json().catch(() => ({})))
  if (!parsed.success) {
    throw new ValidationError(ErrorCode.VALIDATION_MISSING_FIELD, undefined, {
      field: 'isActive'
    })
  }
  await toggleSkillActive(slug, parsed.data.isActive)
  return successResponse(c, { success: true })
})

export default skillsRouter
