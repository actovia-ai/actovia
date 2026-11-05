import { NotFoundError } from '@actovia/shared/errors/app-error'
import type { GroupCompactResult } from '@actovia/shared/types/philharmonic'
import { Hono } from 'hono'
import { z } from 'zod'

import {
  readGroupBrief,
  saveGroupBrief
} from '../../ai/philharmonic/group-brief'
import { PhilharmonicLcm } from '../../ai/philharmonic/lcm'
import { pmRunRegistry } from '../../ai/philharmonic/pm-run-registry'
import { trustedContextWindow } from '../../ai/providers/resolve-model'
import { getModelFromProvider } from '../../ai/utils/chat-message-util'
import { getConversationById } from '../../db/conversation-queries'
import { getSettings } from '../../db/queries'
import type { Variables } from '../types'
import { successResponse, validateSchema } from '../utils'

const router = new Hono<{ Variables: Variables }>()
async function existing(id: string) {
  if (!(await getConversationById(id))) throw new NotFoundError()
}
router.get('/conversations/:id/brief', async (c) => {
  const id = c.req.param('id')
  await existing(id)
  return successResponse(c, await readGroupBrief(id))
})
router.put('/conversations/:id/brief', async (c) => {
  const id = c.req.param('id')
  await existing(id)
  const body = validateSchema(
    z.object({ content: z.string().max(16000), revision: z.string().min(1) }),
    await c.req.json(),
    'Invalid Group brief'
  )
  try {
    return successResponse(
      c,
      await saveGroupBrief(id, body.content, body.revision)
    )
  } catch (error) {
    if ((error as Error).message === 'BRIEF_CONFLICT')
      return c.json(
        {
          type: 'error',
          error: {
            code: 'BRIEF_CONFLICT',
            message: 'The brief changed. Reload it before saving.'
          }
        },
        409
      )
    throw error
  }
})
router.post('/conversations/:id/compact', async (c) => {
  const id = c.req.param('id')
  await existing(id)
  if (pmRunRegistry.has(id))
    return c.json(
      {
        type: 'error',
        error: {
          code: 'GROUP_BUSY',
          message: 'Wait for the current PM round to finish before compacting.'
        }
      },
      409
    )
  const setting = await getSettings()
  if (setting.memory?.lcmEnabled === false)
    return c.json(
      {
        type: 'error',
        error: {
          code: 'CONTEXT_COMPACTION_DISABLED',
          message: 'Enable context management in Settings before compacting.'
        }
      },
      409
    )
  let result: GroupCompactResult | undefined
  await pmRunRegistry.run(
    id,
    async (signal) => {
      signal.throwIfAborted()
      const { model, apiKey } = getModelFromProvider(setting)
      const lcm = new PhilharmonicLcm(id, model, apiKey, {
        freshTailSize: 6,
        contextWindow: trustedContextWindow(model) || 128000
      })
      result = await lcm.compactNow(signal)
    },
    true
  )
  if (!result)
    return c.json(
      {
        type: 'error',
        error: {
          code: 'COMPACTION_CANCELLED',
          message: 'Compaction was cancelled.'
        }
      },
      409
    )
  return successResponse(c, result)
})
export default router
