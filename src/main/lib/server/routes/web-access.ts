import { Hono } from 'hono'

import {
  configureWebAccess,
  webAccessState,
  webTerminals
} from '../../web-access'
import { WebAccessConfigSchema } from '../../web-access/config'
import { desktopOnly } from '../middlewares/desktop-only'
import type { Variables } from '../types'
import { successResponse, validateSchema } from '../utils'

const router = new Hono<{ Variables: Variables }>()
router.use('*', desktopOnly)
router.get('/', (c) => successResponse(c, webAccessState()))
router.put('/', async (c) => {
  const config = validateSchema(
    WebAccessConfigSchema,
    await c.req.json(),
    'Invalid Web access configuration'
  )
  await configureWebAccess(config)
  return successResponse(c, webAccessState())
})
router.post('/pairing', (c) => {
  const state = webAccessState()
  if (!state.enabled || !state.running)
    return c.json(
      {
        type: 'error',
        error: {
          code: 'WEB_ACCESS_DISABLED',
          message: 'Enable Web access first.'
        }
      },
      409
    )
  webTerminals.pairing.open()
  return successResponse(c, webAccessState())
})
router.delete('/pairing', (c) => {
  webTerminals.pairing.close()
  return successResponse(c, webAccessState())
})
export default router
