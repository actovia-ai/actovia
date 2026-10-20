import type { DiscoverFeedDto } from '@actovia/shared/types/discover'
import { Hono } from 'hono'

import { getDiscoverFeed, setDiscoverFeed } from '../../db/discover-queries'
import { getSettings } from '../../db/queries'
import type { DiscoverFeedRow } from '../../db/schema'
import { enqueueAndProcess, logEnqueueFailure } from '../../jobs/worker'
import { Variables } from '../types'
import { successResponse } from '../utils'

const router = new Hono<{ Variables: Variables }>()

const REFRESH_COOLDOWN_MS = 5 * 60 * 1000

function toDto(row: DiscoverFeedRow): DiscoverFeedDto {
  return {
    groups: row.groups,
    generatedAt: row.generatedAt ? row.generatedAt.toISOString() : null,
    status: row.status,
    error: row.error
  }
}

router.get('/', async (c) => {
  const row = await getDiscoverFeed()
  return successResponse(c, toDto(row))
})

router.post('/refresh', async (c) => {
  const [row, settings] = await Promise.all([getDiscoverFeed(), getSettings()])

  // Guard mirrors runDiscoverRefresh's own early-return checks (disabled, no
  // Brave key). Without this, a refresh triggered in either state would flip
  // status to 'refreshing' here and then never flip back — the job itself
  // returns before ever calling setDiscoverFeed again in both cases, leaving
  // the row stuck at 'refreshing' permanently.
  if (!settings.discover?.enabled || !settings.webSearch?.braveApiKey) {
    return successResponse(c, toDto(row))
  }

  if (row.status === 'refreshing') {
    return successResponse(c, toDto(row))
  }
  if (
    row.generatedAt &&
    Date.now() - row.generatedAt.getTime() < REFRESH_COOLDOWN_MS
  ) {
    return successResponse(c, toDto(row))
  }

  await setDiscoverFeed({ status: 'refreshing' })
  await enqueueAndProcess('discover-refresh', { force: true }).catch((e) =>
    logEnqueueFailure('discover-refresh', e)
  )
  return successResponse(c, toDto({ ...row, status: 'refreshing' }))
})

export default router
