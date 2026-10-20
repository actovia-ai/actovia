import { ErrorCode } from '@actovia/shared/constants/error-codes'
import {
  isAppError,
  NotFoundError,
  ServiceError,
  ValidationError
} from '@actovia/shared/errors/app-error'
import type { AnalyticsStatus } from '@actovia/shared/types/analytics'
import { Hono } from 'hono'
import { z } from 'zod'

import {
  DuckDBUnavailableError,
  duckdbVersion,
  runQuery
} from '../../analytics/duckdb'
import {
  buildSnapshot,
  readSnapshotMeta,
  snapshotExists
} from '../../analytics/snapshot'
import { logger } from '../../logger'
import { getAnalyticsDbPath } from '../../paths'
import type { Variables } from '../types'
import { successResponse } from '../utils'

/** `/api/v1/analytics` — the DuckDB chat-audit snapshot and read-only console. */
const analyticsRouter = new Hono<{ Variables: Variables }>()

const QuerySchema = z.object({ sql: z.string().trim().min(1).max(20_000) })

function toAnalyticsError(err: unknown): never {
  if (isAppError(err)) throw err
  if (err instanceof DuckDBUnavailableError) {
    logger.error('analytics', 'duckdb unavailable', { error: err })
    throw new ServiceError(ErrorCode.ANALYTICS_UNAVAILABLE)
  }
  // DuckDB's own message names the offending column / token — show it.
  throw new ValidationError(
    ErrorCode.VALIDATION_FAILED,
    err instanceof Error ? err.message : String(err)
  )
}

// GET /status — engine availability + snapshot meta
analyticsRouter.get('/status', async (c) => {
  const snapshot = await readSnapshotMeta()
  const base = { snapshot, path: getAnalyticsDbPath() }
  try {
    const version = await duckdbVersion()
    return successResponse(c, {
      ...base,
      available: true,
      version
    } satisfies AnalyticsStatus)
  } catch (err) {
    logger.error('analytics', 'duckdb unavailable', { error: err })
    return successResponse(c, {
      ...base,
      available: false,
      error: err instanceof Error ? err.message : String(err)
    } satisfies AnalyticsStatus)
  }
})

// POST /snapshot — (re)build from PGlite
analyticsRouter.post('/snapshot', async (c) => {
  try {
    return successResponse(c, await buildSnapshot())
  } catch (err) {
    toAnalyticsError(err)
  }
})

// POST /query { sql } — read-only, capped at MAX_RESULT_ROWS
analyticsRouter.post('/query', async (c) => {
  const parsed = QuerySchema.safeParse(await c.req.json().catch(() => ({})))
  if (!parsed.success) {
    throw new ValidationError(ErrorCode.VALIDATION_MISSING_FIELD, undefined, {
      field: 'sql'
    })
  }
  if (!snapshotExists()) {
    throw new NotFoundError(ErrorCode.ANALYTICS_SNAPSHOT_MISSING)
  }
  try {
    return successResponse(c, await runQuery(parsed.data.sql))
  } catch (err) {
    toAnalyticsError(err)
  }
})

export default analyticsRouter
