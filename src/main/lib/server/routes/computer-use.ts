import type { InstalledApp } from '@actovia/shared/types/computer-use'
import { Hono } from 'hono'

import { listDesktopApps } from '../../automation/runtime'
import { computerAskRegistry } from '../../computer/ask-registry'
import { liveness } from '../../computer/liveness'
import { isSelfTarget } from '../../computer/self'
import { Variables } from '../types'
import { successResponse } from '../utils'

const router = new Hono<{ Variables: Variables }>()

// Briefly cache the upstream running-app inventory for the Settings picker.
const APPS_TTL_MS = 5_000
let appsCache: { at: number; apps: InstalledApp[] } | null = null

// GET /api/v1/computer-use/apps — running applications for the allowlist picker.
router.get('/apps', async (c) => {
  if (!appsCache || Date.now() - appsCache.at > APPS_TTL_MS) {
    // Actovia itself is never a Computer Use target (computer/self.ts).
    const apps = await listDesktopApps()
    appsCache = {
      at: Date.now(),
      apps: apps.filter((a) => !isSelfTarget({ bundleId: a.bundleId }))
    }
  }
  return successResponse(c, { apps: appsCache.apps })
})

// POST /api/v1/computer-use/abort — the Stop button. Aborts every live session
// (same effect as the global ⌥⇧⎋ hotkey, with reason 'user').
router.post('/abort', (c) => {
  liveness.abortAll('user')
  return successResponse(c, { ok: true })
})

// POST /api/v1/computer-use/answer — { sessionId, answer }. Unblocks a session
// parked on an `askHuman` action. Permissive for V0: a missing/blank sessionId
// (or no pending question) is a silent no-op, still { ok: true }.
router.post('/answer', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    sessionId?: unknown
    answer?: unknown
  }
  const sessionId =
    typeof body.sessionId === 'string' ? body.sessionId.trim() : ''
  if (sessionId) {
    computerAskRegistry.resolve(sessionId, String(body.answer ?? ''))
  }
  return successResponse(c, { ok: true })
})

export default router
